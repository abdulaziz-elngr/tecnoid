/**
 * Manual "click-to-chat" WhatsApp links.
 *
 * This is intentionally separate from `src/lib/whatsapp/*` (the
 * provider-backed queue used for automated notifications such as
 * payment reminders). Nothing here calls any API or stores anything —
 * it only builds a `https://wa.me/...` URL that the staff member opens
 * themselves, and they press Send inside WhatsApp. Used by the session
 * attendance screen for the absence/payment/exam/announcement buttons.
 */

/**
 * Normalizes an Egyptian phone number to the digits-only international
 * form wa.me expects (no "+", no spaces, no leading 0).
 *
 * "01012345678"      -> "201012345678"
 * "+20 101 234 5678"  -> "201012345678"
 * "20101 2345678"     -> "201012345678"
 *
 * Returns null if the input doesn't look like a usable Egyptian mobile
 * number, so callers can show "no valid WhatsApp number" instead of a
 * broken link.
 */
export function normalizeEgyptianPhone(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;

  let national: string;
  if (digits.startsWith("20")) {
    national = digits.slice(2);
  } else if (digits.startsWith("0")) {
    national = digits.slice(1);
  } else {
    national = digits;
  }

  // Egyptian mobile numbers are 10 digits after the leading 0/country code,
  // starting with 1 (010/011/012/015).
  if (!/^1[0125]\d{8}$/.test(national)) return null;

  return `20${national}`;
}

export function buildWhatsAppLink(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export type WhatsAppTemplateType =
  | "ABSENCE"
  | "PAYMENT"
  | "EXAM"
  | "ANNOUNCEMENT"
  | "OTHER";

export interface WhatsAppTemplateVariables {
  studentName?: string;
  parentName?: string;
  subjectName?: string;
  groupName?: string;
  stageName?: string;
  gradeName?: string;
  date?: string;
  time?: string;
  teacherName?: string;
  amount?: string;
  examName?: string;
  examDate?: string;
  examTime?: string;
  /** Free-form body for ANNOUNCEMENT — the text a staff member composed. */
  message?: string;
  [key: string]: string | undefined;
}

const TEMPLATES: Record<
  WhatsAppTemplateType,
  (v: WhatsAppTemplateVariables) => string
> = {
  ABSENCE: (v) =>
    `السلام عليكم، نود إبلاغ حضرتكم بأن الطالب ${v.studentName ?? ""} لم يحضر حصة ${v.subjectName ?? ""} بتاريخ ${v.date ?? ""}${
      v.groupName ? ` في مجموعة ${v.groupName}` : ""
    }. نرجو متابعة سبب الغياب. شكرًا لكم.`,
  // Payment reminder (spec item 9) — filled with the student's real name
  // and the real outstanding amount, never hard-coded.
  PAYMENT: (v) =>
    `السلام عليكم، نود تذكير حضرتكم بأن قيمة الرسوم المستحقة للطالب ${v.studentName ?? ""} هي ${v.amount ?? ""} جنيه. نرجو التكرم بالسداد. شكرًا لكم.`,
  // Exam notice (spec item 10).
  EXAM: (v) =>
    `السلام عليكم، نود إبلاغ حضرتكم بأن امتحان ${v.examName ?? ""} لمادة ${v.subjectName ?? ""} للطالب ${v.studentName ?? ""} سيكون يوم ${v.examDate ?? ""}${
      v.examTime ? ` الساعة ${v.examTime}` : ""
    }. بالتوفيق.`,
  // Announcement (spec item 11) — the staff-composed body (`message`) is
  // wrapped with a short greeting and the recipient's name when known.
  ANNOUNCEMENT: (v) =>
    `السلام عليكم${v.parentName ? ` ${v.parentName}` : ""}${v.studentName ? `، بخصوص الطالب ${v.studentName}` : ""}:\n${v.message ?? ""}`,
  OTHER: (v) => v.message ?? v.amount ?? "",
};

/** Renders one of the built-in message types, ready to URL-encode. */
export function renderWhatsAppTemplate(
  type: WhatsAppTemplateType,
  variables: WhatsAppTemplateVariables,
): string {
  return TEMPLATES[type](variables);
}

export interface ParentWhatsAppTarget {
  /** Normalized `20XXXXXXXXXX` number, or null if none usable exists. */
  phone: string | null;
  /** Set when `phone` is null — shown to the staff member instead of a broken link. */
  reason?: string;
}

/**
 * Resolves the WhatsApp number to message for a parent record (spec item
 * 14): prefers the dedicated `whatsappNumber` field, falls back to the
 * general `phone`, and never returns a broken/unusable link — callers
 * check `.phone` and show `.reason` instead of rendering a button.
 */
export function resolveParentWhatsApp(
  parent:
    | { phone?: string | null; whatsappNumber?: string | null }
    | null
    | undefined,
): ParentWhatsAppTarget {
  if (!parent) {
    return { phone: null, reason: "لا يوجد ولي أمر مسجل لهذا الطالب." };
  }
  const phone = normalizeEgyptianPhone(parent.whatsappNumber || parent.phone);
  if (!phone) {
    return {
      phone: null,
      reason: "رقم واتساب ولي الأمر غير متاح أو غير صحيح.",
    };
  }
  return { phone };
}
