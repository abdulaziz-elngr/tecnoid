import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { BusinessRuleError, NotFoundError, created, handleApiError, readJson } from "@/lib/api";
import { evaluateCapacity, getGroupStudentCount } from "@/lib/capacity";

const SCOPE = "groups.students";

const enrollSchema = z.object({
  studentId: z.string().uuid(),
  isPrimary: z.boolean().default(false)
});

/**
 * Enrolls a student into a group (spec item 5: this is what makes the
 * "real number of registered students" real — see src/lib/capacity.ts).
 * The classroom's real capacity is checked before writing the row; the
 * database trigger `enforce_group_capacity` (see the Phase 2 migration)
 * is the non-bypassable backstop if this check is ever skipped.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.groups.manage");
    const group = await db.group.findFirst({
      where: { id: params.id, deletedAt: null, branch: { center: { organizationId: ctx.organizationId } } },
      include: { room: { select: { id: true, name: true, capacity: true } } }
    });
    if (!group) throw new NotFoundError("Group not found.");
    resolveBranchScope(ctx, group.branchId);

    const input = await readJson(request, enrollSchema);

    const student = await db.student.findFirst({
      where: { id: input.studentId, organizationId: ctx.organizationId, deletedAt: null }
    });
    if (!student) throw new NotFoundError("Student not found.");
    resolveBranchScope(ctx, student.branchId);

    const existingLink = await db.groupStudent.findUnique({
      where: { groupId_studentId: { groupId: group.id, studentId: student.id } }
    });
    if (existingLink) {
      throw new BusinessRuleError("This student is already enrolled in this group.", { status: 409 });
    }

    const currentCount = await getGroupStudentCount(group.id);
    const evaluation = evaluateCapacity(currentCount + 1, group.room?.capacity ?? null);
    if (evaluation.status === "EXCEEDED") {
      throw new BusinessRuleError(
        `The selected classroom capacity (${group.room?.capacity}) is smaller than the number of students this would put in the group (${currentCount + 1}).`,
        { status: 422, code: "CLASSROOM_CAPACITY_EXCEEDED", details: evaluation }
      );
    }

    if (input.isPrimary) {
      // Rule (see GroupStudent doc comment in schema.prisma): a student
      // may have at most one isPrimary=true row per subject.
      const conflictingPrimary = await db.groupStudent.findFirst({
        where: { studentId: student.id, isPrimary: true, group: { subjectId: group.subjectId } }
      });
      if (conflictingPrimary) {
        throw new BusinessRuleError(
          "This student already has a primary group for this subject. Unset it first.",
          { status: 409 }
        );
      }
    }

    const link = await db.groupStudent.create({
      data: { groupId: group.id, studentId: student.id, isPrimary: input.isPrimary },
      include: { student: { select: { id: true, fullName: true, studentCode: true } } }
    });

    if (input.isPrimary) {
      await db.student.update({ where: { id: student.id }, data: { primaryGroupId: group.id } });
    }

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "ENROLL_STUDENT_IN_GROUP",
      entityType: "GroupStudent",
      entityId: link.id,
      afterValue: { groupId: group.id, studentId: student.id, isPrimary: input.isPrimary }
    });

    return created({
      ...link,
      groupStudentCount: currentCount + 1,
      capacityStatus: evaluation
    });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
