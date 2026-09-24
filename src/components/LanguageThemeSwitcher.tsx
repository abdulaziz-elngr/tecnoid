"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { useI18n } from "@/lib/i18n";

/**
 * Small dependency-free SVG icon set for the theme switcher, sized to
 * inherit `currentColor` so it follows text color in both light and
 * dark mode without any extra props.
 */
function SunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.75" />
      <path
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        d="M12 2.5v2.25M12 19.25v2.25M4.22 4.22l1.6 1.6M18.18 18.18l1.6 1.6M2.5 12h2.25M19.25 12h2.25M4.22 19.78l1.6-1.6M18.18 5.82l1.6-1.6"
      />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M20.5 14.4A8.5 8.5 0 0 1 9.6 3.5a.75.75 0 0 0-.9-.98A9.5 9.5 0 1 0 21.48 15.3a.75.75 0 0 0-.98-.9Z"
      />
    </svg>
  );
}

function SystemIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.75" />
      <path stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" d="M8.5 20h7M12 16.5V20" />
    </svg>
  );
}

type ThemeOption = "light" | "dark" | "system";

const THEME_ICONS: Record<ThemeOption, (props: { className?: string }) => ReactNode> = {
  light: SunIcon,
  dark: MoonIcon,
  system: SystemIcon
};

export function LanguageThemeSwitcher() {
  const { locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const options: { value: ThemeOption; label: string }[] = [
    { value: "light", label: locale === "ar" ? "فاتح" : "Light" },
    { value: "dark", label: locale === "ar" ? "داكن" : "Dark" },
    { value: "system", label: locale === "ar" ? "النظام" : "System" }
  ];

  const current = (theme as ThemeOption) ?? "system";
  const CurrentIcon = THEME_ICONS[current] ?? SystemIcon;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Language"
        value={locale}
        onChange={(e) => setLocale(e.target.value as "ar" | "en")}
        className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/10"
      >
        <option value="ar">العربية</option>
        <option value="en">English</option>
      </select>

      <div className="relative" ref={rootRef}>
        <button
          type="button"
          aria-label="Theme"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
        >
          <CurrentIcon className="h-4 w-4" />
          <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3 opacity-60" aria-hidden="true">
            <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {open && (
          <ul
            role="listbox"
            aria-label="Theme"
            className="absolute end-0 z-50 mt-1 w-32 overflow-hidden rounded-lg border border-black/10 bg-white py-1 shadow-card dark:border-white/10 dark:bg-surface-dark-muted"
          >
            {options.map(({ value, label }) => {
              const Icon = THEME_ICONS[value];
              const selected = current === value;
              return (
                <li key={value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => {
                      setTheme(value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm hover:bg-black/5 dark:hover:bg-white/10 ${
                      selected ? "text-tecno-gold-dark dark:text-tecno-gold" : ""
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
