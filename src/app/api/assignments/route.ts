import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok, created, readJson, readQuery, paginationSchema, BusinessRuleError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

const listSchema = paginationSchema.extend({
  groupId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  open: z.enum(["true", "false"]).optional()
});

const createSchema = z.object({
  groupId: z.string().uuid(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  dueDate: z.string().datetime(),
  maxScore: z.number().positive().max(10000),
  /** Pre-create a PENDING submission row for every enrolled student. */
  createSubmissions: z.boolean().default(true)
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("assignments.view");
    const query = readQuery(request, listSchema);
    const branchIds = resolveBranchScope(ctx, query.branchId);

    const where = {
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
      ...(query.groupId ? { groupId: query.groupId } : {}),
      ...(query.open === "true" ? { dueDate: { gte: new Date() } } : {})
    };

    const [total, rows] = await Promise.all([
      db.assignment.count({ where }),
      db.assignment.findMany({
        where,
        orderBy: { dueDate: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          title: true,
          dueDate: true,
          maxScore: true,
          group: { select: { id: true, name: true, subject: { select: { name: true } } } },
          _count: { select: { submissions: true } }
        }
      })
    ]);

    return ok({
      assignments: rows.map((a) => ({ ...a, maxScore: Number(a.maxScore) })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize))
      }
    });
  } catch (err) {
    return handleApiError("assignments.list", err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("assignments.manage");
    const input = await readJson(request, createSchema);

    const group = await db.group.findFirst({
      where: {
        id: input.groupId,
        deletedAt: null,
        branch: { deletedAt: null, center: { organizationId: ctx.organizationId } }
      },
      select: {
        id: true,
        branchId: true,
        subjectId: true,
        groupStudents: { select: { studentId: true } }
      }
    });
    if (!group) throw new BusinessRuleError("Invalid group.", { status: 400 });
    resolveBranchScope(ctx, group.branchId);

    const assignment = await db.$transaction(async (tx) => {
      const row = await tx.assignment.create({
        data: {
          organizationId: ctx.organizationId,
          branchId: group.branchId,
          groupId: group.id,
          subjectId: group.subjectId,
          title: input.title,
          description: input.description,
          dueDate: new Date(input.dueDate),
          maxScore: input.maxScore,
          createdById: ctx.userId
        }
      });

      if (input.createSubmissions && group.groupStudents.length > 0) {
        await tx.assignmentSubmission.createMany({
          data: group.groupStudents.map((gs) => ({
            assignmentId: row.id,
            studentId: gs.studentId,
            status: "PENDING" as const
          })),
          skipDuplicates: true
        });
      }

      return row;
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_ASSIGNMENT",
      entityType: "Assignment",
      entityId: assignment.id,
      afterValue: assignment
    });

    return created({ ...assignment, maxScore: Number(assignment.maxScore) });
  } catch (err) {
    return handleApiError("assignments.create", err);
  }
}
