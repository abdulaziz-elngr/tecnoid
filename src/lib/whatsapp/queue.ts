import { db } from "../db";
import {
  isWhatsAppConfigured,
  sendTemplate,
  sendText,
  normalizePhone,
  isValidPhone
} from "./provider";

/**
 * Durable outbox for WhatsApp messages (spec §21).
 *
 * Requests NEVER block on the provider: API routes only INSERT a
 * WhatsAppMessage row with status QUEUED and return immediately. The
 * worker below drains the queue — run it from BullMQ/a cron/a Vercel
 * scheduled function hitting POST /api/whatsapp/worker.
 *
 * Retries use exponential backoff and stop after MAX_ATTEMPTS, leaving
 * the row in FAILED with the provider's error text for the Failed
 * Messages screen.
 */

const MAX_ATTEMPTS = Number(process.env.WHATSAPP_MAX_ATTEMPTS || 5);
const BASE_BACKOFF_SECONDS = Number(process.env.WHATSAPP_BACKOFF_SECONDS || 60);

export interface EnqueueParams {
  organizationId: string;
  toNumber: string;
  body: string;
  locale?: string;
  templateKey?: string;
  studentId?: string;
  parentId?: string;
  createdById?: string;
}

export async function enqueueWhatsAppMessage(params: EnqueueParams) {
  if (!isValidPhone(params.toNumber)) {
    throw new Error("Invalid WhatsApp number.");
  }

  return db.whatsAppMessage.create({
    data: {
      organizationId: params.organizationId,
      toNumber: normalizePhone(params.toNumber),
      body: params.body,
      locale: params.locale ?? "ar",
      templateKey: params.templateKey,
      studentId: params.studentId,
      parentId: params.parentId,
      createdById: params.createdById,
      status: "QUEUED",
      nextAttemptAt: new Date()
    }
  });
}

export interface WorkerResult {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  configured: boolean;
}

export async function processWhatsAppQueue(limit = 25): Promise<WorkerResult> {
  if (!isWhatsAppConfigured()) {
    // Honest no-op: messages stay QUEUED until credentials exist.
    return { processed: 0, sent: 0, failed: 0, skipped: 0, configured: false };
  }

  const now = new Date();
  const batch = await db.whatsAppMessage.findMany({
    where: {
      status: { in: ["QUEUED", "SENDING"] },
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }]
    },
    orderBy: { createdAt: "asc" },
    take: limit
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const message of batch) {
    // Claim the row so a second worker instance doesn't double-send.
    const claimed = await db.whatsAppMessage.updateMany({
      where: { id: message.id, status: message.status, attempts: message.attempts },
      data: { status: "SENDING", attempts: message.attempts + 1 }
    });
    if (claimed.count === 0) {
      skipped += 1;
      continue;
    }

    let template: { providerTemplateName: string | null } | null = null;
    if (message.templateKey) {
      template = await db.notificationTemplate.findFirst({
        where: {
          organizationId: message.organizationId,
          key: message.templateKey,
          locale: message.locale,
          channel: "WHATSAPP"
        },
        select: { providerTemplateName: true }
      });
    }

    const result =
      template?.providerTemplateName
        ? await sendTemplate({
            to: message.toNumber,
            templateName: template.providerTemplateName,
            languageCode: message.locale === "ar" ? "ar" : "en",
            parameters: [message.body]
          })
        : await sendText({ to: message.toNumber, body: message.body });

    if (result.success) {
      sent += 1;
      await db.whatsAppMessage.update({
        where: { id: message.id },
        data: {
          status: "SENT",
          providerMessageId: result.providerMessageId,
          sentAt: new Date(),
          errorMessage: null,
          nextAttemptAt: null
        }
      });
      continue;
    }

    const attemptsUsed = message.attempts + 1;
    const giveUp = !result.retryable || attemptsUsed >= MAX_ATTEMPTS;
    failed += giveUp ? 1 : 0;

    await db.whatsAppMessage.update({
      where: { id: message.id },
      data: {
        status: giveUp ? "FAILED" : "QUEUED",
        errorMessage: result.error?.slice(0, 500),
        nextAttemptAt: giveUp
          ? null
          : new Date(Date.now() + BASE_BACKOFF_SECONDS * 2 ** (attemptsUsed - 1) * 1000)
      }
    });
  }

  return { processed: batch.length, sent, failed, skipped, configured: true };
}

/** Puts a FAILED message back in the queue (Retry Queue screen). */
export async function retryWhatsAppMessage(organizationId: string, id: string) {
  return db.whatsAppMessage.updateMany({
    where: { id, organizationId, status: "FAILED" },
    data: { status: "QUEUED", attempts: 0, nextAttemptAt: new Date(), errorMessage: null }
  });
}
