import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { NotFoundError, handleApiError, ok } from "@/lib/api";

const SCOPE = "announcements.detail";

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("notifications.send");

    const announcement = await db.announcement.findFirst({
      where: { id: params.id, organizationId: ctx.organizationId },
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
                  select: {
                    relationship: true,
                    parent: { select: { fullName: true, phone: true, whatsappNumber: true } }
                  }
                }
              }
            }
          }
        }
      }
    });
    if (!announcement) throw new NotFoundError("Announcement not found.");
    if (announcement.branchId) resolveBranchScope(ctx, announcement.branchId);

    return ok({
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
        primaryParent: r.student.parents[0]
          ? { relationship: r.student.parents[0].relationship, ...r.student.parents[0].parent }
          : null
      }))
    });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
