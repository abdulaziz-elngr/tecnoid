"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { apiDelete, apiPost, qs, useApi } from "@/lib/client";
import { Badge, ErrorNotice, Field, PageHeader, StatCard, useToast } from "@/components/ui";

interface GroupDetail {
  id: string;
  name: string;
  capacity: number;
  isActive: boolean;
  subject: { id: string; name: string } | null;
  academicLevel: { id: string; name: string } | null;
  academicGrade: { id: string; name: string } | null;
  room: { id: string; name: string; capacity: number } | null;
  teacher: { id: string; fullName: string } | null;
  assistant: { id: string; fullName: string } | null;
  studentCount: number;
  capacityStatus: { status: string; availableSeats: number | null; message: string };
  students: {
    id: string;
    fullName: string;
    studentCode: string;
    primaryParent: { fullName: string; phone: string | null; whatsappNumber: string | null } | null;
  }[];
}

interface StudentSearchResult {
  id: string;
  fullName: string;
  studentCode: string;
}

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "AVAILABLE") return "success";
  if (status === "FULL") return "warning";
  if (status === "EXCEEDED") return "danger";
  return "neutral";
}

export default function GroupDetailPage() {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const groupId = params.id;

  const { data, loading, error, reload } = useApi<GroupDetail>(`/api/groups/${groupId}`);

  const [studentQuery, setStudentQuery] = useState("");
  const [studentOptions, setStudentOptions] = useState<StudentSearchResult[]>([]);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    const term = studentQuery.trim();
    if (term.length < 2) {
      setStudentOptions([]);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      fetch(`/api/search${qs({ q: term })}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((body) => setStudentOptions(body.data?.students ?? []))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [studentQuery]);

  async function handleEnroll(studentId: string) {
    setEnrolling(true);
    setEnrollError(null);
    try {
      await apiPost(`/api/groups/${groupId}/students`, { studentId });
      toast.success(t("common.saved"));
      setStudentQuery("");
      setStudentOptions([]);
      reload();
    } catch (err) {
      // Surfaces the exact "classroom capacity is smaller than the number
      // of students in this group" message from the API (spec item 5)
      // rather than a generic failure.
      setEnrollError(err instanceof Error ? err.message : "Failed to enroll student.");
    } finally {
      setEnrolling(false);
    }
  }

  async function handleUnenroll(studentId: string) {
    setRemovingId(studentId);
    try {
      await apiDelete(`/api/groups/${groupId}/students/${studentId}`);
      toast.success(t("common.deleted"));
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove student.");
    } finally {
      setRemovingId(null);
    }
  }

  if (loading || !data) {
    return (
      <div className="space-y-5">
        <PageHeader title={t("groups.title")} />
        <ErrorNotice message={error} />
        {loading && <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>}
      </div>
    );
  }

  const enrolledIds = new Set(data.students.map((s) => s.id));

  return (
    <div className="space-y-5">
      <PageHeader
        title={data.name}
        description={[data.academicLevel?.name, data.academicGrade?.name, data.subject?.name].filter(Boolean).join(" · ")}
        actions={
          <button type="button" className="btn-secondary" onClick={() => router.push("/dashboard/academic/groups")}>
            {t("common.back")}
          </button>
        }
      />

      <ErrorNotice message={error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("common.students")} value={data.studentCount} />
        <StatCard label={t("common.classroom")} value={data.room?.name ?? "—"} />
        <StatCard label={t("common.capacity")} value={data.room?.capacity ?? data.capacity} />
        <StatCard label={t("common.teacher")} value={data.teacher?.fullName ?? "—"} />
      </div>

      <Badge tone={statusTone(data.capacityStatus.status)}>{data.capacityStatus.message}</Badge>

      <div className="card space-y-3 p-4">
        <p className="text-sm font-semibold">{t("groups.enrollStudent")}</p>
        <ErrorNotice message={enrollError} />
        <Field label={t("common.student")}>
          {(id) => (
            <div className="relative">
              <input
                id={id}
                className="input"
                placeholder="Search by name, code or phone"
                value={studentQuery}
                onChange={(e) => setStudentQuery(e.target.value)}
                disabled={enrolling}
              />
              {studentOptions.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded-lg border border-black/10 bg-white text-sm shadow-lg dark:border-white/10 dark:bg-surface-dark-muted">
                  {studentOptions.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        disabled={enrolledIds.has(s.id) || enrolling}
                        className="block w-full px-3 py-2 text-start hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
                        onClick={() => handleEnroll(s.id)}
                      >
                        {s.fullName} <span className="font-mono text-xs opacity-60">{s.studentCode}</span>
                        {enrolledIds.has(s.id) && <span className="ms-2 text-xs">✓</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Field>
      </div>

      <div className="card overflow-x-auto">
        <p className="p-4 pb-0 text-sm font-semibold">{t("groups.studentsTab")}</p>
        <table className="w-full min-w-[560px] text-start text-sm">
          <thead className="border-b border-black/5 text-black/60 dark:border-white/10 dark:text-white/60">
            <tr>
              <th className="p-3 text-start font-medium">{t("common.student")}</th>
              <th className="p-3 text-start font-medium">Parent WhatsApp</th>
              <th className="p-3 text-start font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {data.students.length === 0 && (
              <tr>
                <td className="p-6 text-center text-black/50 dark:text-white/50" colSpan={3}>
                  {t("common.noResults")}
                </td>
              </tr>
            )}
            {data.students.map((s) => (
              <tr key={s.id} className="border-b border-black/5 dark:border-white/5">
                <td className="p-3">
                  <span className="font-medium">{s.fullName}</span>
                  <span className="ms-2 font-mono text-xs text-black/45 dark:text-white/45">{s.studentCode}</span>
                </td>
                <td className="p-3 text-xs">{s.primaryParent?.whatsappNumber || s.primaryParent?.phone || "—"}</td>
                <td className="p-3">
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline disabled:opacity-40 dark:text-red-400"
                    disabled={removingId === s.id}
                    onClick={() => handleUnenroll(s.id)}
                  >
                    {t("groups.unenroll")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
