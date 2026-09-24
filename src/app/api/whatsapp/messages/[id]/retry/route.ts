import { type NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, BusinessRuleError } from "@/lib/api";
import { retryWhatsAppMessage } from "@/lib/whatsapp/queue";
import { writeAuditLog } from "@/lib/audit";

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("whatsapp.send");
    const result = await retryWhatsAppMessage(ctx.organizationId, params.id);
    if (result.count === 0) {
      throw new BusinessRuleError("Only failed messages can be retried.");
    }

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "RETRY_WHATSAPP",
      entityType: "WhatsAppMessage",
      entityId: params.id
    });

    return ok({ requeued: result.count });
  } catch (err) {
    return handleApiError("whatsapp.retry", err);
  }
}
