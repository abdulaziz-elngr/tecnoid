import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { NotFoundError, handleApiError, ok } from "@/lib/api";
import { getGroupStudentCount } from "@/lib/capacity";

const SCOPE = "groups.students.detail";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; studentId: string } }
) {
  try {
    const ctx = await requirePermission("academic.groups.manage");
    const group = await db.group.findFirst({
      where: { id: params.id, deletedAt: null, branch: { center: { organizationId: ctx.organizationId } } }
    });
    if (!group) throw new NotFoundError("Group not found.");
    resolveBranchScope(ctx, group.branchId);

    const link = await db.groupStudent.findUnique({
      where: { groupId_studentId: { groupId: params.id, studentId: params.studentId } }
    });
    if (!link) throw new NotFoundError("This student is not enrolled in this group.");

    await db.groupStudent.delete({ where: { id: link.id } });

    // Clear the convenience pointer on Student if this was their primary group.
    await db.student.updateMany({
      where: { id: params.studentId, primaryGroupId: params.id },
      data: { primaryGroupId: null }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UNENROLL_STUDENT_FROM_GROUP",
      entityType: "GroupStudent",
      entityId: link.id,
      beforeValue: { groupId: params.id, studentId: params.studentId, isPrimary: link.isPrimary }
    });

    const studentCount = await getGroupStudentCount(params.id);

    return ok({ id: link.id, deleted: true, groupStudentCount: studentCount });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
