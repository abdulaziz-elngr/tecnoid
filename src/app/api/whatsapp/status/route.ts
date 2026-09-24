import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { isWhatsAppConfigured } from "@/lib/whatsapp/provider";

/**
 * Integration health (spec §71): the UI shows "Integration not
 * configured" plus the configuration path instead of pretending to work.
 */
export async function GET() {
  try {
    const ctx = await requirePermission("whatsapp.view");
    const configured = isWhatsAppConfigured();

    const [queued, failed, sent] = await Promise.all([
      db.whatsAppMessage.count({ where: { organizationId: ctx.organizationId, status: "QUEUED" } }),
      db.whatsAppMessage.count({ where: { organizationId: ctx.organizationId, status: "FAILED" } }),
      db.whatsAppMessage.count({
        where: { organizationId: ctx.organizationId, status: { in: ["SENT", "DELIVERED", "READ"] } }
      })
    ]);

    return ok({
      configured,
      provider: configured ? "meta_cloud" : null,
      configurationPath: "/dashboard/settings#whatsapp",
      requiredEnvVars: ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN"],
      queue: { queued, failed, sent }
    });
  } catch (err) {
    return handleApiError("whatsapp.status", err);
  }
}
