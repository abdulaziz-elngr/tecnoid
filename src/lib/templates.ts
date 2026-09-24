/**
 * Message template rendering for notifications and WhatsApp.
 *
 * Placeholders use {{snake_case}} and are HTML-free plain text. Any
 * placeholder with no supplied value renders as an empty string rather
 * than leaking the raw token to a parent's phone.
 */

export type TemplateVariables = Record<string, string | number | null | undefined>;

export function renderTemplate(body: string, variables: TemplateVariables): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

export function extractPlaceholders(body: string): string[] {
  const found = new Set<string>();
  const regex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

/** Seeded default templates — Arabic and English, per event (spec §21). */
export const DEFAULT_TEMPLATES: {
  key: string;
  type: "ATTENDANCE" | "PAYMENT" | "EXAM" | "ACADEMIC" | "ADMINISTRATIVE" | "SYSTEM";
  name: string;
  ar: string;
  en: string;
}[] = [
  {
    key: "attendance.absent",
    type: "ATTENDANCE",
    name: "Absence notification",
    ar: "السادة ولي أمر الطالب {{student_name}},\nنحيطكم علماً بغياب الطالب عن حصة {{subject_name}} بتاريخ {{date}}.\nمع تحيات {{center_name}}.",
    en: "Dear Parent,\nWe would like to inform you that your child {{student_name}} was absent from the {{subject_name}} session on {{date}}.\nThank you — {{center_name}}."
  },
  {
    key: "attendance.late",
    type: "ATTENDANCE",
    name: "Late arrival notification",
    ar: "السادة ولي أمر الطالب {{student_name}},\nنحيطكم علماً بتأخر الطالب عن حصة {{subject_name}} بتاريخ {{date}} بمقدار {{late_minutes}} دقيقة.\nمع تحيات {{center_name}}.",
    en: "Dear Parent,\nYour child {{student_name}} arrived {{late_minutes}} minutes late to the {{subject_name}} session on {{date}}.\nThank you — {{center_name}}."
  },
  {
    key: "payment.reminder",
    type: "PAYMENT",
    name: "Payment reminder",
    ar: "السادة ولي أمر الطالب {{student_name}},\nنذكركم بأن اشتراك شهر {{period}} بمبلغ {{amount}} لم يتم سداده حتى الآن.\nمع تحيات {{center_name}}.",
    en: "Dear Parent,\nThis is a reminder that the {{period}} tuition payment of {{amount}} for {{student_name}} is currently outstanding.\nThank you — {{center_name}}."
  },
  {
    key: "payment.received",
    type: "PAYMENT",
    name: "Payment confirmation",
    ar: "السادة ولي أمر الطالب {{student_name}},\nتم استلام مبلغ {{amount}} بإيصال رقم {{receipt_number}}.\nشكراً لكم — {{center_name}}.",
    en: "Dear Parent,\nWe have received a payment of {{amount}} for {{student_name}} (receipt {{receipt_number}}).\nThank you — {{center_name}}."
  },
  {
    key: "exam.result",
    type: "EXAM",
    name: "Exam result",
    ar: "السادة ولي أمر الطالب {{student_name}},\nنتيجة اختبار {{exam_name}} في مادة {{subject_name}}: {{score}} من {{max_score}} ({{percentage}}%).\nمع تحيات {{center_name}}.",
    en: "Dear Parent,\n{{student_name}} scored {{score}} out of {{max_score}} ({{percentage}}%) in the {{exam_name}} {{subject_name}} exam.\nThank you — {{center_name}}."
  },
  {
    key: "general.announcement",
    type: "ADMINISTRATIVE",
    name: "General announcement",
    ar: "{{message}}\n\n{{center_name}}",
    en: "{{message}}\n\n{{center_name}}"
  }
];
