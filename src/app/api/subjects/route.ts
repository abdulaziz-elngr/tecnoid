import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { BusinessRuleError, created, handleApiError, ok, readJson, readQuery } from "@/lib/api";
import { assertGradeBelongsToLevel, assertStageExists } from "@/lib/academic";

const SCOPE = "subjects";

const listQuerySchema = z.object({
  academicLevelId: z.string().uuid().optional(),
  academicGradeId: z.string().uuid().optional(),
  /** Include only subjects that still have no Stage/Grade assigned (legacy rows). */
  unassignedOnly: z.coerce.boolean().optional()
});

// Stage + Grade are required for every new/edited Subject going forward.
// The database columns stay nullable (see the Phase 2 migration) purely
// to tolerate subjects created before this phase — this Zod schema is
// what actually enforces "required" for anything written from now on.
const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  academicLevelId: z.string().uuid({ message: "Select a stage." }),
  academicGradeId: z.string().uuid({ message: "Select a grade." })
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("academic.subjects.manage");
    const query = readQuery(request, listQuerySchema);

    const subjects = await db.subject.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...(query.academicLevelId ? { academicLevelId: query.academicLevelId } : {}),
        ...(query.academicGradeId ? { academicGradeId: query.academicGradeId } : {}),
        ...(query.unassignedOnly ? { academicGradeId: null } : {})
      },
      orderBy: [{ academicLevel: { order: "asc" } }, { name: "asc" }],
      include: {
        academicLevel: { select: { id: true, name: true } },
        academicGrade: { select: { id: true, name: true } },
        _count: { select: { groups: true, exams: true } }
      }
    });
    return ok(subjects);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("academic.subjects.manage");
    const input = await readJson(request, createSchema);

    await assertStageExists(ctx.organizationId, input.academicLevelId);
    await assertGradeBelongsToLevel(ctx.organizationId, input.academicLevelId, input.academicGradeId);

    const existing = await db.subject.findFirst({
      where: {
        organizationId: ctx.organizationId,
        academicGradeId: input.academicGradeId,
        name: input.name,
        deletedAt: null
      }
    });
    if (existing) {
      throw new BusinessRuleError("A subject with this name already exists for this grade.", { status: 409 });
    }

    const subject = await db.subject.create({
      data: {
        organizationId: ctx.organizationId,
        name: input.name,
        academicLevelId: input.academicLevelId,
        academicGradeId: input.academicGradeId
      },
      include: {
        academicLevel: { select: { id: true, name: true } },
        academicGrade: { select: { id: true, name: true } }
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_SUBJECT",
      entityType: "Subject",
      entityId: subject.id,
      afterValue: subject
    });

    return created(subject);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
