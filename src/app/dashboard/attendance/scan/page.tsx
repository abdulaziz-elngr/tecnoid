"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { apiPost, formatDateTime, todayISO, useApi } from "@/lib/client";
import { Badge, ErrorNotice, Field, PageHeader } from "@/components/ui";

/**
 * Attendance scanner (spec §17, §51).
 *
 * Built around a single always-focused input so a USB/Bluetooth barcode
 * gun works with zero clicks: the gun types the code and sends Enter.
 * The whole decision — student lookup, duplicate check, make-up
 * eligibility, recording — happens in one POST so the operator sees the
 * result immediately. Large touch targets keep it usable on a tablet.
 */

interface SessionRow {
  id: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  status: string;
  group: {
    id: string;
    name: string;
    capacity: number;
    subject: { id: string; name: string };
    teacher: { id: string; fullName: string } | null;
    room: { id: string; name: string } | null;
  };
  _count: { attendances: number };
}

interface ScanResult {
  status: "ACCEPTED" | "REJECTED";
  code: string;
  message: string;
  student?: { id: string; fullName: string; studentCode: string; photoUrl: string | null };
  session?: { id: string; groupName: string; subjectName: string; roomName: string | null };
  attendance?: { id: string; type: string; recordedAt: string };
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export default function ScannerPage() {
  const { t } = useI18n();
  const today = todayISO();

  const { data, loading, error, reload } = useApi<{ sessions: SessionRow[] }>(
    `/api/sessions?from=${today}&to=${today}&pageSize=100`
  );
  const sessions = useMemo(() => data?.sessions ?? [], [data]);

  const [sessionId, setSessionId] = useState("");
  const [autoPick, setAutoPick] = useState(true);
  const [code, setCode] = useState("");
  const [makeUpReason, setMakeUpReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [history, setHistory] = useState<ScanResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pick whichever session is running right now, so the operator can
  // usually start scanning without touching anything.
  useEffect(() => {
    if (!autoPick || sessions.length === 0) return;
    const current = nowMinutes();
    const live =
      sessions.find((s) => s.startMinutes - 15 <= current && current <= s.endMinutes + 15) ??
      sessions[0];
    if (live) setSessionId(live.id);
  }, [autoPick, sessions]);

  const refocus = useCallback(() => inputRef.current?.focus(), []);

  useEffect(() => {
    refocus();
  }, [refocus, sessionId]);

  const selected = sessions.find((s) => s.id === sessionId) ?? null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || !sessionId || busy) return;

    setBusy(true);
    setScanError(null);
    try {
      const response = await apiPost<ScanResult>("/api/attendance/scan", {
        code: trimmed,
        sessionId,
        makeUpReason: makeUpReason.trim() || undefined,
        deviceInfo: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : undefined
      });
      setResult(response);
      setHistory((list) => [response, ...list].slice(0, 12));
      if (response.status === "ACCEPTED") {
        setMakeUpReason("");
        reload();
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Scan failed.");
      setResult(null);
    } finally {
      setCode("");
      setBusy(false);
      refocus();
    }
  }

  const accepted = result?.status === "ACCEPTED";

  return (
    <div className="space-y-5">
      <PageHeader title={t("scanner.title")} description={t("scanner.subtitle")} />

      <ErrorNotice message={error} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="card p-4">
            <Field label={t("scanner.session")} required>
              {(id) => (
                <select
                  id={id}
                  className="input text-base"
                  value={sessionId}
                  disabled={loading}
                  onChange={(e) => {
                    setAutoPick(false);
                    setSessionId(e.target.value);
                  }}
                >
                  <option value="">{loading ? t("common.loading") : "—"}</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {minutesToTime(s.startMinutes)}–{minutesToTime(s.endMinutes)} · {s.group.subject.name} ·{" "}
                      {s.group.name} ({s._count.attendances}/{s.group.capacity})
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoPick}
                onChange={(e) => setAutoPick(e.target.checked)}
                className="h-4 w-4"
              />
              {t("scanner.autoSession")}
            </label>

            {sessions.length === 0 && !loading && (
              <p className="mt-3 text-sm text-black/55 dark:text-white/55">{t("sessions.empty")}</p>
            )}
          </div>

          <form onSubmit={submit} className="card p-4">
            <Field label={t("scanner.placeholder")} required>
              {(id) => (
                <input
                  id={id}
                  ref={inputRef}
                  className="input py-4 text-center font-mono text-xl tracking-widest"
                  value={code}
                  autoComplete="off"
                  autoFocus
                  inputMode="text"
                  disabled={!sessionId || busy}
                  onChange={(e) => setCode(e.target.value)}
                  onBlur={() => setTimeout(refocus, 80)}
                  placeholder={t("scanner.placeholder")}
                />
              )}
            </Field>

            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-black/60 dark:text-white/60">
                {t("scanner.makeup")}
              </summary>
              <div className="mt-2">
                <input
                  className="input"
                  value={makeUpReason}
                  onChange={(e) => setMakeUpReason(e.target.value)}
                  placeholder={t("common.reason")}
                />
                <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                  A reason is required to authorise make-up attendance, and it is stored with the record.
                </p>
              </div>
            </details>

            <button type="submit" className="btn-primary mt-4 w-full py-3 text-base" disabled={!sessionId || busy}>
              {busy ? t("common.loading") : t("common.confirm")}
            </button>
          </form>

          <ErrorNotice message={scanError} />

          {result && (
            <div
              className={`card border-2 p-5 ${
                accepted ? "border-emerald-500/60" : "border-red-500/60"
              }`}
              role="status"
              aria-live="assertive"
            >
              <div className="flex items-center gap-4">
                <span className={`text-4xl ${accepted ? "text-emerald-500" : "text-red-500"}`}>
                  {accepted ? "✓" : "✕"}
                </span>
                <div className="min-w-0">
                  <p className="text-lg font-bold">
                    {accepted ? t("scanner.recorded") : result.message}
                  </p>
                  {result.student && (
                    <p className="truncate text-base">
                      {result.student.fullName}{" "}
                      <span className="font-mono text-xs text-black/50 dark:text-white/50">
                        {result.student.studentCode}
                      </span>
                    </p>
                  )}
                  {result.session && (
                    <p className="text-sm text-black/60 dark:text-white/60">
                      {result.session.subjectName} · {result.session.groupName}
                      {result.session.roomName ? ` · ${result.session.roomName}` : ""}
                    </p>
                  )}
                  {result.attendance && (
                    <p className="mt-1 flex items-center gap-2 text-sm">
                      <Badge tone={result.attendance.type === "LATE" ? "warning" : "success"}>
                        {result.attendance.type}
                      </Badge>
                      {formatDateTime(result.attendance.recordedAt)}
                    </p>
                  )}
                  {!accepted && (
                    <p className="mt-1 font-mono text-xs text-black/50 dark:text-white/50">{result.code}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          {selected && (
            <div className="card p-4">
              <h3 className="mb-2 font-semibold">{selected.group.name}</h3>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-black/55 dark:text-white/55">{t("common.subject")}</dt>
                  <dd>{selected.group.subject.name}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-black/55 dark:text-white/55">{t("common.teacher")}</dt>
                  <dd>{selected.group.teacher?.fullName ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-black/55 dark:text-white/55">Room</dt>
                  <dd>{selected.group.room?.name ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-black/55 dark:text-white/55">Attendance</dt>
                  <dd>
                    {selected._count.attendances} / {selected.group.capacity}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-black/55 dark:text-white/55">{t("common.status")}</dt>
                  <dd>
                    <Badge tone={selected.status === "OPEN" ? "success" : "neutral"}>{selected.status}</Badge>
                  </dd>
                </div>
              </dl>
            </div>
          )}

          <div className="card p-4">
            <h3 className="mb-2 font-semibold">{t("scanner.recent")}</h3>
            {history.length === 0 ? (
              <p className="text-sm text-black/55 dark:text-white/55">—</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {history.map((entry, index) => (
                  <li key={`${entry.attendance?.id ?? entry.code}-${index}`} className="flex items-center gap-2">
                    <span className={entry.status === "ACCEPTED" ? "text-emerald-500" : "text-red-500"}>
                      {entry.status === "ACCEPTED" ? "✓" : "✕"}
                    </span>
                    <span className="truncate">{entry.student?.fullName ?? entry.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
