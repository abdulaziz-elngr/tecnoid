"use client";

import { buildWhatsAppLink, type ParentWhatsAppTarget } from "@/lib/whatsapp-link";

/**
 * Centralized "Send WhatsApp" button (spec items 9–12): every screen
 * that offers a manual WhatsApp send (Payments, Subscriptions, Exams,
 * Announcements, Attendance) renders through this one component so the
 * link-building, phone-normalization and "no valid number" states are
 * never duplicated or re-implemented per page.
 */
export function WhatsAppButton({
  target,
  message,
  label = "Send WhatsApp",
  className = ""
}: {
  target: ParentWhatsAppTarget;
  message: string;
  label?: string;
  className?: string;
}) {
  if (!target.phone) {
    return (
      <span
        title={target.reason}
        className={`inline-flex cursor-not-allowed items-center gap-1 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs font-medium text-black/35 dark:border-white/10 dark:text-white/35 ${className}`}
      >
        {label}
      </span>
    );
  }

  const href = buildWhatsAppLink(target.phone, message);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 rounded-lg bg-[#25D366]/10 px-2.5 py-1.5 text-xs font-medium text-[#128C7E] transition hover:bg-[#25D366]/20 dark:text-[#25D366] ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
        <path d="M12.04 2c-5.52 0-10 4.48-10 10 0 1.77.46 3.45 1.27 4.9L2 22l5.25-1.38A9.94 9.94 0 0012.04 22c5.52 0 10-4.48 10-10s-4.48-10-10-10zm0 18.2c-1.63 0-3.15-.46-4.44-1.26l-.32-.19-3.11.82.83-3.03-.2-.31A8.17 8.17 0 013.84 12c0-4.53 3.68-8.2 8.2-8.2s8.2 3.67 8.2 8.2-3.68 8.2-8.2 8.2zm4.5-6.13c-.25-.12-1.45-.71-1.67-.79-.22-.08-.39-.12-.55.12-.16.25-.63.79-.78.95-.14.16-.29.18-.53.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.41-.55-.42h-.47c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.04 0 1.2.88 2.36 1 2.53.12.16 1.72 2.62 4.16 3.68.58.25 1.04.4 1.39.51.58.19 1.11.16 1.53.1.47-.07 1.45-.59 1.65-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.47-.28z" />
      </svg>
      {label}
    </a>
  );
}
