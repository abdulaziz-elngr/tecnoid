import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, readJson, BusinessRuleError } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { enqueueWhatsAppMessage } from "@/lib/whatsapp/queue";
import { isWhatsAppConfigured } from "@/lib/whatsapp/provider";
import { renderTemplate } from "@/lib/templates";
import { writeAuditLog } from "@/lib/audit";
import { getCenterProfile } from "@/lib/settings";

/**
 * Queues one or many WhatsApp messages. The request returns as soon as
 * the rows are written — delivery happens in the background worker, so
 * a slow provider can never slow down the UI (spec §21).
 */

const schema = z.object({
  /** Either explicit numbers, or student ids whose parents get messaged. */
  toNumbers: z.array(z.string().trim().min(6).max(20)).max(200).optional(),
  studentIds: z.array(z.string().uuid()).max(500).optional(),
  templateKey: z.string().trim().max(100).optional(),
  message: z.string().trim().min(1).max(1000).optional(),
  locale: z.enum(["ar", "en"]).default("ar")
});

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("whatsapp.send");

    const limit = checkRateLimit(`whatsapp:${ctx.organizationId}`, 20, 60 * 1000);
    if (!limit.allowed) {
      throw new BusinessRuleError("Too many WhatsApp requests. Please wait a moment.", {
        status: 429
      });
    }

    const input = await readJson(request, schema);
    if (!input.message && !input.templateKey) {
      throw new BusinessRuleError("Provide a message or a template key.");
    }
    if (!input.toNumbers?.length && !input.studentIds?.length) {
      throw new BusinessRuleError("Provide at least one recipient.");
    }

    const center = await getCenterProfile(ctx.organizationId);

    let body = input.message ?? "";
    if (input.templateKey) {
      const template = await db.notificationTemplate.findFirst({
        where: {
          organizationId: ctx.organizationId,
          key: input.templateKey,
          locale: input.locale,
          isActive: true
        }
      });
      if (!template) throw new BusinessRuleError("Template not found for this language.");
      body = template.body;
    }

    const recipients: { number: string; studentId?: string; parentId?: string; vars: Record<string, string> }[] = [];

    for (const number of input.toNumbers ?? []) {
      recipients.push({ number, vars: { center_name: center.name, message: input.message ?? "" } });
    }

    if (input.studentIds?.length) {
      const links = await db.studentParent.findMany({
        where: {
          studentId: { in: input.studentIds },
          student: {
            organizationId: ctx.organizationId,
            deletedAt: null,
            ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
          }
        },
        include: {
          parent: true,
          student: { select: { id: true, fullName: true } }
        }
      });
      for (const link of links) {
        if (!link.parent.notificationsEnabled) continue;
        const number = link.parent.whatsappNumber || link.parent.phone;
        if (!number) continue;
        recipients.push({
          number,
          studentId: link.studentId,
          parentId: link.parentId,
          vars: {
            center_name: center.name,
            student_name: link.student.fullName,
            message: input.message ?? ""
          }
        });
      }
    }

    let queued = 0;
    const errors: string[] = [];
    for (const recipient of recipients) {
      try {
        await enqueueWhatsAppMessage({
          organizationId: ctx.organizationId,
          toNumber: recipient.number,
          body: renderTemplate(body, recipient.vars),
          locale: input.locale,
          templateKey: input.templateKey,
          studentId: recipient.studentId,
          parentId: recipient.parentId,
          createdById: ctx.userId
        });
        queued += 1;
      } catch (err) {
        errors.push(`${recipient.number}: ${(err as Error).message}`);
      }
    }

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "QUEUE_WHATSAPP",
      entityType: "WhatsAppMessage",
      afterValue: { queued, failed: errors.length, templateKey: input.templateKey }
    });

    return ok({
      queued,
      rejected: errors.length,
      errors: errors.slice(0, 20),
      integrationConfigured: isWhatsAppConfigured(),
      note: isWhatsAppConfigured()
        ? "Messages are queued and will be delivered by the background worker."
        : "WhatsApp is not configured yet. Messages stay queued until credentials are added in Settings → WhatsApp."
    });
  } catch (err) {
    return handleApiError("whatsapp.send", err);
  }
}
