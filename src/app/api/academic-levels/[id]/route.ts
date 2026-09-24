import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { BusinessRuleError, NotFoundError, handleApiError, ok, readJson } from "@/lib/api";

const SCOPE = "academic-levels.detail";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  order: z.number().int().min(0).max(999).optional(),
  addGrade: z.string().trim().min(1).max(100).optional(),
  removeGradeId: z.string().uuid().optional()
});

async function loadLevel(organizationId: string, id: string) {
  const level = await db.academicLevel.findFirst({
    where: { id, organizationId },
    include: { grades: true, _count: { select: { students: true, groups: true } } }
  });
  if (!level) throw new NotFoundError("Academic level not found.");
  return level;
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.levels.manage");
    return ok(await loadLevel(ctx.organizationId, params.id));
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.levels.manage");
    const level = await loadLevel(ctx.organizationId, params.id);
    const input = await readJson(request, updateSchema);

    if (input.removeGradeId) {
      const grade = level.grades.find((g) => g.id === input.removeGradeId);
      if (!grade) throw new NotFoundError("Grade not found in this level.");
      await db.academicGrade.delete({ where: { id: grade.id } });
    }

    if (input.addGrade) {
      const duplicate = level.grades.some((g) => g.name === input.addGrade);
      if (duplicate) throw new BusinessRuleError("This grade already exists in the level.", { status: 409 });
      await db.academicGrade.create({
        data: { levelId: level.id, name: input.addGrade, order: level.grades.length }
      });
    }

    if (input.name !== undefined || input.order !== undefined) {
      await db.academicLevel.update({
        where: { id: level.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.order !== undefined ? { order: input.order } : {})
        }
      });
    }

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPDATE_ACADEMIC_LEVEL",
      entityType: "AcademicLevel",
      entityId: level.id,
      beforeValue: { name: level.name, order: level.order },
      afterValue: input
    });

    return ok(await loadLevel(ctx.organizationId, params.id));
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.levels.manage");
    const level = await loadLevel(ctx.organizationId, params.id);

    if (level._count.students > 0 || level._count.groups > 0) {
      throw new BusinessRuleError(
        "This level is still referenced by students or groups and cannot be removed."
      );
    }

    await db.academicGrade.deleteMany({ where: { levelId: level.id } });
    await db.academicLevel.delete({ where: { id: level.id } });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "DELETE_ACADEMIC_LEVEL",
      entityType: "AcademicLevel",
      entityId: level.id,
      beforeValue: { name: level.name }
    });

    return ok({ id: level.id, deleted: true });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
