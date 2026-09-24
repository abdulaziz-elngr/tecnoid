import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { BusinessRuleError, NotFoundError, handleApiError, ok, readJson } from "@/lib/api";
import { assertGradeBelongsToLevel, assertStageExists } from "@/lib/academic";

const SCOPE = "subjects.detail";

// Stage + Grade are required on every edit going forward, same as create —
// this keeps a legacy (pre-Phase-2) subject from being "saved" without an
// administrator finally assigning it a real Stage/Grade.
const updateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  academicLevelId: z.string().uuid({ message: "Select a stage." }),
  academicGradeId: z.string().uuid({ message: "Select a grade." })
});

async function loadSubject(organizationId: string, id: string) {
  const subject = await db.subject.findFirst({
    where: { id, organizationId, deletedAt: null },
    include: {
      academicLevel: { select: { id: true, name: true } },
      academicGrade: { select: { id: true, name: true } },
      _count: { select: { groups: true, exams: true } }
    }
  });
  if (!subject) throw new NotFoundError("Subject not found.");
  return subject;
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.subjects.manage");
    return ok(await loadSubject(ctx.organizationId, params.id));
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.subjects.manage");
    const subject = await loadSubject(ctx.organizationId, params.id);
    const input = await readJson(request, updateSchema);

    await assertStageExists(ctx.organizationId, input.academicLevelId);
    await assertGradeBelongsToLevel(ctx.organizationId, input.academicLevelId, input.academicGradeId);

    const duplicate = await db.subject.findFirst({
      where: {
        id: { not: subject.id },
        organizationId: ctx.organizationId,
        academicGradeId: input.academicGradeId,
        name: input.name,
        deletedAt: null
      }
    });
    if (duplicate) {
      throw new BusinessRuleError("A subject with this name already exists for this grade.", { status: 409 });
    }

    const updated = await db.subject.update({
      where: { id: subject.id },
      data: {
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
      action: "UPDATE_SUBJECT",
      entityType: "Subject",
      entityId: subject.id,
      beforeValue: { name: subject.name, academicLevelId: subject.academicLevelId, academicGradeId: subject.academicGradeId },
      afterValue: { name: updated.name, academicLevelId: updated.academicLevelId, academicGradeId: updated.academicGradeId }
    });

    return ok(updated);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.subjects.manage");
    const subject = await loadSubject(ctx.organizationId, params.id);

    if (subject._count.groups > 0) {
      throw new BusinessRuleError("This subject still has groups. Archive them before removing it.");
    }

    await db.subject.update({ where: { id: subject.id }, data: { deletedAt: new Date() } });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "DELETE_SUBJECT",
      entityType: "Subject",
      entityId: subject.id,
      beforeValue: { name: subject.name }
    });

    return ok({ id: subject.id, deleted: true });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
