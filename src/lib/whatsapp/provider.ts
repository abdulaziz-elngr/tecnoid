/**
 * WhatsApp provider abstraction (spec §21).
 *
 * Only OFFICIAL APIs are supported — the Meta WhatsApp Business
 * Platform (Cloud API) by default. Unofficial WhatsApp Web automation
 * is intentionally not implemented and will not be added: it violates
 * WhatsApp's terms and gets numbers banned.
 *
 * If credentials are absent the provider reports `configured: false`
 * and every send is REFUSED with a clear, honest error — we never fake
 * a successful delivery (spec §71).
 */

export interface WhatsAppConfig {
  provider: "meta_cloud";
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string;
  /** Optional shared secret used to validate provider status webhooks. */
  webhookVerifyToken?: string;
}

export interface SendTextParams {
  to: string;
  body: string;
}

export interface SendTemplateParams {
  to: string;
  templateName: string;
  languageCode: string;
  /** Positional body parameters, matching the approved template. */
  parameters: string[];
}

export interface SendResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
  /** True when the failure is transient and the job should be retried. */
  retryable?: boolean;
}

export class WhatsAppNotConfiguredError extends Error {
  constructor() {
    super(
      "WhatsApp integration is not configured. Add WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN, then configure it under Settings → WhatsApp."
    );
    this.name = "WhatsAppNotConfiguredError";
  }
}

export function getWhatsAppConfig(): WhatsAppConfig | null {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) return null;

  return {
    provider: "meta_cloud",
    phoneNumberId,
    accessToken,
    apiVersion: process.env.WHATSAPP_API_VERSION || "v20.0",
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
  };
}

export function isWhatsAppConfigured(): boolean {
  return getWhatsAppConfig() !== null;
}

/** E.164 normalization, defaulting to the configured country code. */
export function normalizePhone(raw: string, defaultCountryCode = process.env.DEFAULT_COUNTRY_CODE || "20"): string {
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = defaultCountryCode + digits.slice(1);
  return digits;
}

export function isValidPhone(raw: string): boolean {
  const normalized = normalizePhone(raw);
  return /^\d{8,15}$/.test(normalized);
}

async function callGraphApi(
  config: WhatsAppConfig,
  payload: Record<string, unknown>
): Promise<SendResult> {
  const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      // Never let a hanging provider hold a worker slot forever.
      signal: AbortSignal.timeout(15000)
    });

    const json = (await response.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number };
    };

    if (!response.ok) {
      return {
        success: false,
        error: json.error?.message ?? `Provider returned HTTP ${response.status}`,
        // 4xx (bad number, unapproved template) is permanent; 5xx/429 is transient.
        retryable: response.status >= 500 || response.status === 429
      };
    }

    return { success: true, providerMessageId: json.messages?.[0]?.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Network error contacting WhatsApp provider.",
      retryable: true
    };
  }
}

/**
 * Free-form text. Only deliverable inside the 24-hour customer service
 * window; outside it the provider rejects the message and we surface
 * that error rather than pretending it was sent.
 */
export async function sendText(params: SendTextParams): Promise<SendResult> {
  const config = getWhatsAppConfig();
  if (!config) throw new WhatsAppNotConfiguredError();

  return callGraphApi(config, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizePhone(params.to),
    type: "text",
    text: { preview_url: false, body: params.body }
  });
}

/** Pre-approved template message — the correct channel for proactive alerts. */
export async function sendTemplate(params: SendTemplateParams): Promise<SendResult> {
  const config = getWhatsAppConfig();
  if (!config) throw new WhatsAppNotConfiguredError();

  return callGraphApi(config, {
    messaging_product: "whatsapp",
    to: normalizePhone(params.to),
    type: "template",
    template: {
      name: params.templateName,
      language: { code: params.languageCode },
      components: params.parameters.length
        ? [
            {
              type: "body",
              parameters: params.parameters.map((text) => ({ type: "text", text }))
            }
          ]
        : []
    }
  });
}
