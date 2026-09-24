import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { BusinessRuleError, NotFoundError, created, handleApiError, ok, readJson, readQuery } from "@/lib/api";

const SCOPE = "announcements";

const listQuerySchema = z.object({
  branchId: z.string().uuid().optional()
});

// Recipients are resolved and materialized once, at creation time (spec
// item 11): a GROUP announcement snapshots the group's roster right now,
// so the recipient list stays a stable historical record even if
// students are later added to or removed from the group.
const createSchema = z
  .object({
    title: z.string().trim().min(1).max(150),
    message: z.string().trim().min(1).max(2000),
    audienceType: z.enum(["STUDENT", "GROUP", "SELECTED"]),
    studentId: z.string().uuid().optional(),
    groupId: z.string().uuid().optional(),
    studentIds: z.array(z.string().uuid()).min(1).max(300).optional()
  })
  .refine((v) => (v.audienceType === "STUDENT" ? Boolean(v.studentId) : true), {
    message: "studentId is required for a STUDENT announcement.",
    path: ["studentId"]
  })
  .refine((v) => (v.audienceType === "GROUP" ? Boolean(v.groupId) : true), {
    message: "groupId is required for a GROUP announcement.",
    path: ["groupId"]
  })
  .refine((v) => (v.audienceType === "SELECTED" ? Boolean(v.studentIds?.length) : true), {
    message: "studentIds is required for a SELECTED announcement.",
    path: ["studentIds"]
  });

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("notifications.send");
    const query = readQuery(request, listQuerySchema);
    const branchIds = resolveBranchScope(ctx, query.branchId);

    const announcements = await db.announcement.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(branchIds ? { branchId: { in: branchIds } } : {})
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        group: { select: { id: true, name: true } },
        _count: { select: { recipients: true } }
      }
    });

    return ok(
      announcements.map((a) => ({
        id: a.id,
        title: a.title,
        message: a.message,
        audienceType: a.audienceType,
        group: a.group,
        recipientCount: a._count.recipients,
        createdAt: a.createdAt
      }))
    );
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("notifications.send");
    const input = await readJson(request, createSchema);

    let branchId: string | null = null;
    let recipientStudentIds: string[] = [];
    let groupId: string | null = null;

    if (input.audienceType === "STUDENT") {
      const student = await db.student.findFirst({
        where: { id: input.studentId, organizationId: ctx.organizationId, deletedAt: null }
      });
      if (!student) throw new NotFoundError("Student not found.");
      resolveBranchScope(ctx, student.branchId);
      branchId = student.branchId;
      recipientStudentIds = [student.id];
    } else if (input.audienceType === "GROUP") {
      const group = await db.group.findFirst({
        where: { id: input.groupId, deletedAt: null, branch: { center: { organizationId: ctx.organizationId } } },
        include: { groupStudents: { select: { studentId: true } } }
      });
      if (!group) throw new NotFoundError("Group not found.");
      resolveBranchScope(ctx, group.branchId);
      branchId = group.branchId;
      groupId = group.id;
      recipientStudentIds = group.groupStudents.map((gs) => gs.studentId);
      if (recipientStudentIds.length === 0) {
        throw new BusinessRuleError("This group has no enrolled students yet.");
      }
    } else {
      const students = await db.student.findMany({
        where: { id: { in: input.studentIds }, organizationId: ctx.organizationId, deletedAt: null },
        select: { id: true, branchId: true }
      });
      if (students.length !== input.studentIds?.length) {
        throw new BusinessRuleError("Some selected students were not found.");
      }
      for (const s of students) resolveBranchScope(ctx, s.branchId);
      branchId = students[0]?.branchId ?? null;
      recipientStudentIds = students.map((s) => s.id);
    }

    const announcement = await db.announcement.create({
      data: {
        organizationId: ctx.organizationId,
        branchId,
        groupId,
        createdById: ctx.userId,
        title: input.title,
        message: input.message,
        audienceType: input.audienceType,
        recipients: { create: recipientStudentIds.map((studentId) => ({ studentId })) }
      },
      include: {
        group: { select: { id: true, name: true } },
        recipients: {
          include: {
            student: {
              select: {
                id: true,
                fullName: true,
                studentCode: true,
                parents: {
                  where: { isPrimary: true },
                  take: 1,
                  select: { parent: { select: { fullName: true, phone: true, whatsappNumber: true } } }
                }
              }
            }
          }
        }
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_ANNOUNCEMENT",
      entityType: "Announcement",
      entityId: announcement.id,
      afterValue: { title: announcement.title, audienceType: announcement.audienceType, recipientCount: recipientStudentIds.length }
    });

    return created({
      id: announcement.id,
      title: announcement.title,
      message: announcement.message,
      audienceType: announcement.audienceType,
      group: announcement.group,
      createdAt: announcement.createdAt,
      recipients: announcement.recipients.map((r) => ({
        id: r.student.id,
        fullName: r.student.fullName,
        studentCode: r.student.studentCode,
        primaryParent: r.student.parents[0]?.parent ?? null
      }))
    });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
