"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/client";
import { Badge, ErrorNotice, useToast } from "@/components/ui";
import { normalizeEgyptianPhone, buildWhatsAppLink, renderWhatsAppTemplate } from "@/lib/whatsapp-link";

type AttendanceType = "REGULAR" | "MAKE_UP" | "LATE" | "EXCUSED" | "ABSENT";

interface ParentLink {
  relationship: string;
  parent: { fullName: string; phone: string; whatsappNumber: string | null };
}

interface RosterStudent {
  id: string;
  fullName: string;
  studentCode: string;
  parents: ParentLink[];
}

interface RosterRow {
  student: RosterStudent;
  isPrimary: boolean;
  attendance: { id: string; type: AttendanceType; notes: string | null } | null;
}

interface SessionDetail {
  session: {
    id: string;
    date: string;
    startMinutes: number;
    endMinutes: number;
    status: string;
    group: {
      id: string;
      name: string;
      subject: { name: string };
      teacher: { fullName: string } | null;
      room: { name: string } | null;
    };
  };
  roster: RosterRow[];
  makeUpAttendees: RosterRow[];
  counts: Record<string, number>;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const MARK_TYPES: AttendanceType[] = ["REGULAR", "LATE", "ABSENT", "EXCUSED"];

export default function SessionDetailPage() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const toast = useToast();

  const [data, setData] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState<string | null>(null);

  function load() {
    fetch(`/api/sessions/${params.id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to load session.");
        return r.json();
      })
      .then((body) => setData(body.data))
      .catch((e) => setError(e.message));
  }

  useEffect(load, [params.id]);

  async function mark(studentId: string, type: AttendanceType) {
    if (!data) return;
    setMarking(studentId);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: data.session.id, studentId, type })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to record attendance.");
      toast.success(t("common.saved"));
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setMarking(null);
    }
  }

  function sendWhatsApp(student: RosterStudent) {
    if (!data) return;
    const primaryParent = student.parents[0]?.parent;
    const number = normalizeEgyptianPhone(primaryParent?.whatsappNumber || primaryParent?.phone);
    if (!number) {
      toast.error(t("sessions.noParentWhatsapp"));
      return;
    }
    const message = renderWhatsAppTemplate("ABSENCE", {
      studentName: student.fullName,
      subjectName: data.session.group.subject.name,
      groupName: data.session.group.name,
      date: formatDate(data.session.date),
      time: `${minutesToTime(data.session.startMinutes)}–${minutesToTime(data.session.endMinutes)}`,
      teacherName: data.session.group.teacher?.fullName ?? ""
    });
    window.open(buildWhatsAppLink(number, message), "_blank", "noopener,noreferrer");
  }

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <div className="h-32 w-full animate-pulse rounded-card bg-black/5 dark:bg-white/5" />;

  const { session, roster } = data;
  const present = roster.filter((r) => r.attendance && r.attendance.type !== "ABSENT");
  const absent = roster.filter((r) => r.attendance?.type === "ABSENT");
  const unmarked = roster.filter((r) => !r.attendance);

  return (
    <div className="space-y-5">
      <button onClick={() => router.back()} className="text-sm text-tecno-gold-dark dark:text-tecno-gold">
        ← {t("common.back")}
      </button>

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">{session.group.subject.name} — {session.group.name}</h1>
            <p className="mt-1 text-sm text-black/60 dark:text-white/60">
              {formatDate(session.date)} · {minutesToTime(session.startMinutes)}–{minutesToTime(session.endMinutes)} ·{" "}
              {session.group.room?.name ?? "—"} · {session.group.teacher?.fullName ?? "—"}
            </p>
          </div>
          <Badge tone={session.status === "COMPLETED" ? "success" : session.status === "CANCELLED" ? "danger" : "brand"}>
            {session.status}
          </Badge>
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <span>{t("common.student")}: {roster.length}</span>
          <span className="text-emerald-600 dark:text-emerald-400">{t("sessions.present")}: {present.length}</span>
          <span className="text-red-600 dark:text-red-400">{t("sessions.absent")}: {absent.length}</span>
          {unmarked.length > 0 && <span className="text-black/50 dark:text-white/50">{t("sessions.unmarked")}: {unmarked.length}</span>}
        </div>
      </div>

      {unmarked.length > 0 && (
        <div className="card p-5">
          <h2 className="mb-3 font-semibold">{t("sessions.unmarked")}</h2>
          <div className="space-y-2">
            {unmarked.map((r) => (
              <div key={r.student.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-black/5 p-3 dark:border-white/10">
                <div>
                  <p className="font-medium">{r.student.fullName}</p>
                  <p className="text-xs text-black/50 dark:text-white/50">{r.student.studentCode}</p>
                </div>
                <div className="flex gap-2">
                  {MARK_TYPES.map((type) => (
                    <button
                      key={type}
                      disabled={marking === r.student.id}
                      onClick={() => mark(r.student.id, type)}
                      className="rounded-lg border border-black/10 px-3 py-1.5 text-xs hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"
                    >
                      {t(`attendance.type.${type}`)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 font-semibold text-emerald-700 dark:text-emerald-400">{t("sessions.present")} ({present.length})</h2>
          {present.length === 0 ? (
            <p className="text-sm text-black/50 dark:text-white/50">{t("common.none")}</p>
          ) : (
            <ul className="space-y-2">
              {present.map((r) => (
                <li key={r.student.id} className="flex items-center justify-between rounded-lg border border-black/5 p-3 text-sm dark:border-white/10">
                  <span>{r.student.fullName}</span>
                  <Badge tone="success">{t(`attendance.type.${r.attendance!.type}`)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-5">
          <h2 className="mb-3 font-semibold text-red-700 dark:text-red-400">{t("sessions.absent")} ({absent.length})</h2>
          {absent.length === 0 ? (
            <p className="text-sm text-black/50 dark:text-white/50">{t("common.none")}</p>
          ) : (
            <ul className="space-y-3">
              {absent.map((r) => {
                const parentLink = r.student.parents[0];
                const hasNumber = Boolean(
                  normalizeEgyptianPhone(parentLink?.parent.whatsappNumber || parentLink?.parent.phone)
                );
                return (
                  <li key={r.student.id} className="rounded-lg border border-black/5 p-3 text-sm dark:border-white/10">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{r.student.fullName}</span>
                      <Badge tone="danger">{t("attendance.type.ABSENT")}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                      {parentLink ? `${parentLink.parent.fullName} · ${parentLink.parent.phone}` : t("sessions.noParentOnFile")}
                    </p>
                    <button
                      type="button"
                      disabled={!hasNumber}
                      onClick={() => sendWhatsApp(r.student)}
                      className="mt-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                      title={hasNumber ? undefined : t("sessions.noParentWhatsapp")}
                    >
                      {t("sessions.sendWhatsapp")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
