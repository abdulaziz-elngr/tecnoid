import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthContext, requirePermission, resolveBranchScope, ForbiddenError, UnauthorizedError } from "@/lib/rbac";
import { handleApiError, ok, NotFoundError, BusinessRuleError, readJson } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { assertGradeBelongsToLevel, assertStageExists, assertSubjectBelongsToGrade } from "@/lib/academic";
import { evaluateCapacity, getGroupStudentCount } from "@/lib/capacity";

const SCOPE = "groups.detail";

/**
 * Group detail + enrolled-student roster. Used wherever a screen needs
 * the full list of students in a group (exam grading, recitation entry,
 * manual WhatsApp exam reminders) rather than only the students who
 * already have a record.
 *
 * Gated on any permission that implies the caller may legitimately see a
 * group's roster (not just `academic.groups.manage`, which teachers never
 * hold — they still need this to grade their own group's exam).
 */
const ROSTER_PERMISSIONS = [
  "academic.groups.manage",
  "exams.view",
  "recitation.view",
  "assignments.view",
  "sessions.view",
  "payments.view"
];

const updateGroupSchema = z.object({
  subjectId: z.string().uuid().optional(),
  academicLevelId: z.string().uuid().optional(),
  academicGradeId: z.string().uuid().optional(),
  roomId: z.string().uuid().nullable().optional(),
  teacherId: z.string().uuid().nullable().optional(),
  assistantId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(100).optional(),
  capacity: z.number().int().min(1).max(500).optional(),
  isActive: z.boolean().optional()
});

async function loadGroupForRoster(organizationId: string, id: string) {
  return db.group.findFirst({
    where: {
      id,
      deletedAt: null,
      branch: { center: { organizationId } }
    },
    include: {
      subject: { select: { id: true, name: true, academicGradeId: true } },
      academicLevel: { select: { id: true, name: true } },
      academicGrade: { select: { id: true, name: true } },
      room: { select: { id: true, name: true, capacity: true } },
      teacher: { select: { id: true, fullName: true } },
      assistant: { select: { id: true, fullName: true } },
      groupStudents: {
        select: {
          student: {
            select: {
              id: true,
              fullName: true,
              studentCode: true,
              parents: {
                where: { isPrimary: true },
                take: 1,
                select: {
                  relationship: true,
                  parent: { select: { id: true, fullName: true, phone: true, whatsappNumber: true } }
                }
              }
            }
          }
        }
      }
    }
  });
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) throw new UnauthorizedError();
    if (!ROSTER_PERMISSIONS.some((key) => ctx.permissions.has(key))) {
      throw new ForbiddenError();
    }

    const group = await loadGroupForRoster(ctx.organizationId, params.id);
    if (!group) throw new NotFoundError("Group not found.");
    resolveBranchScope(ctx, group.branchId);

    const studentCount = group.groupStudents.length;

    return ok({
      id: group.id,
      name: group.name,
      capacity: group.capacity,
      isActive: group.isActive,
      subject: group.subject,
      academicLevel: group.academicLevel,
      academicGrade: group.academicGrade,
      room: group.room,
      teacher: group.teacher,
      assistant: group.assistant,
      studentCount,
      capacityStatus: evaluateCapacity(studentCount, group.room?.capacity ?? null),
      students: group.groupStudents.map((gs) => ({
        id: gs.student.id,
        fullName: gs.student.fullName,
        studentCode: gs.student.studentCode,
        primaryParent: gs.student.parents[0]
          ? {
              relationship: gs.student.parents[0].relationship,
              ...gs.student.parents[0].parent
            }
          : null
      }))
    });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.groups.manage");

    const existing = await db.group.findFirst({
      where: { id: params.id, deletedAt: null, branch: { center: { organizationId: ctx.organizationId } } }
    });
    if (!existing) throw new NotFoundError("Group not found.");
    resolveBranchScope(ctx, existing.branchId);

    const input = await readJson(request, updateGroupSchema);

    const nextAcademicLevelId = input.academicLevelId ?? existing.academicLevelId;
    const nextAcademicGradeId =
      input.academicGradeId !== undefined ? input.academicGradeId : existing.academicGradeId;
    const nextSubjectId = input.subjectId ?? existing.subjectId;

    if (input.academicLevelId) {
      await assertStageExists(ctx.organizationId, input.academicLevelId);
    }
    if (nextAcademicGradeId) {
      await assertGradeBelongsToLevel(ctx.organizationId, nextAcademicLevelId, nextAcademicGradeId);
      await assertSubjectBelongsToGrade(ctx.organizationId, nextSubjectId, nextAcademicGradeId);
    }

    // Real classroom-capacity check (spec item 5): if the classroom
    // assignment is changing, the group's *actual* enrolled headcount
    // must fit inside the new room. No existing "warning-only" rule
    // exists for this case (the pre-existing rule was already a hard
    // block on the declared capacity field), so Phase 2 blocks here too
    // and explains exactly why.
    if (input.roomId !== undefined && input.roomId !== existing.roomId) {
      if (input.roomId) {
        const room = await db.room.findFirst({
          where: { id: input.roomId, branchId: existing.branchId, deletedAt: null }
        });
        if (!room) throw new BusinessRuleError("Invalid room for this branch.", { status: 400 });

        const studentCount = await getGroupStudentCount(existing.id);
        const evaluation = evaluateCapacity(studentCount, room.capacity);
        if (evaluation.status === "EXCEEDED") {
          throw new BusinessRuleError(
            `The selected classroom capacity (${room.capacity}) is smaller than the number of students in this group (${studentCount}).`,
            { status: 422, code: "CLASSROOM_CAPACITY_EXCEEDED", details: evaluation }
          );
        }
      }
    }

    if (input.teacherId) {
      const teacher = await db.teacher.findFirst({ where: { id: input.teacherId, branchId: existing.branchId, deletedAt: null } });
      if (!teacher) throw new BusinessRuleError("Invalid teacher for this branch.", { status: 400 });
    }
    if (input.assistantId) {
      const assistant = await db.teacher.findFirst({ where: { id: input.assistantId, branchId: existing.branchId, deletedAt: null } });
      if (!assistant) throw new BusinessRuleError("Invalid assistant for this branch.", { status: 400 });
    }

    if (input.capacity !== undefined && (input.roomId ?? existing.roomId)) {
      const roomId = input.roomId ?? existing.roomId;
      const room = await db.room.findFirst({ where: { id: roomId as string } });
      if (room && input.capacity > room.capacity) {
        throw new BusinessRuleError(
          `Group capacity (${input.capacity}) exceeds classroom capacity (${room.capacity}).`,
          { status: 400 }
        );
      }
    }

    const updated = await db.group.update({
      where: { id: existing.id },
      data: {
        subjectId: input.subjectId,
        academicLevelId: input.academicLevelId,
        academicGradeId: input.academicGradeId,
        roomId: input.roomId === undefined ? undefined : input.roomId,
        teacherId: input.teacherId === undefined ? undefined : input.teacherId,
        assistantId: input.assistantId === undefined ? undefined : input.assistantId,
        name: input.name,
        capacity: input.capacity,
        isActive: input.isActive
      },
      include: {
        subject: { select: { id: true, name: true } },
        academicLevel: { select: { id: true, name: true } },
        academicGrade: { select: { id: true, name: true } },
        room: { select: { id: true, name: true, capacity: true } },
        teacher: { select: { id: true, fullName: true } },
        assistant: { select: { id: true, fullName: true } }
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPDATE_GROUP",
      entityType: "Group",
      entityId: existing.id,
      beforeValue: existing,
      afterValue: updated
    });

    const studentCount = await getGroupStudentCount(existing.id);

    return ok({
      ...updated,
      studentCount,
      capacityStatus: evaluateCapacity(studentCount, updated.room?.capacity ?? null)
    });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.groups.manage");
    const existing = await db.group.findFirst({
      where: { id: params.id, deletedAt: null, branch: { center: { organizationId: ctx.organizationId } } },
      include: { _count: { select: { groupStudents: true } } }
    });
    if (!existing) throw new NotFoundError("Group not found.");
    resolveBranchScope(ctx, existing.branchId);

    if (existing._count.groupStudents > 0) {
      throw new BusinessRuleError("This group still has enrolled students. Remove them before deleting the group.");
    }

    await db.group.update({ where: { id: existing.id }, data: { deletedAt: new Date(), isActive: false } });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "DELETE_GROUP",
      entityType: "Group",
      entityId: existing.id,
      beforeValue: { name: existing.name }
    });

    return ok({ id: existing.id, deleted: true });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
