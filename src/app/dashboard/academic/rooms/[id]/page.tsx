"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/client";
import { Badge, ErrorNotice, PageHeader, StatCard, useToast } from "@/components/ui";

interface RoomGroupDetail {
  id: string;
  name: string;
  isActive: boolean;
  subject: { id: string; name: string } | null;
  academicLevel: { id: string; name: string } | null;
  academicGrade: { id: string; name: string } | null;
  teacher: { id: string; fullName: string } | null;
  studentCount: number;
  capacityStatus: {
    status: "AVAILABLE" | "FULL" | "EXCEEDED" | "UNLIMITED";
    availableSeats: number | null;
    message: string;
  };
}

interface RoomDetail {
  id: string;
  name: string;
  number: string | null;
  capacity: number;
  isActive: boolean;
  branch: { id: string; name: string } | null;
  groups: RoomGroupDetail[];
  currentStudents: number;
  totalStudentsAcrossGroups: number;
  capacityStatus: {
    status: "AVAILABLE" | "FULL" | "EXCEEDED" | "UNLIMITED";
    studentCount: number;
    capacity: number | null;
    availableSeats: number | null;
    message: string;
  };
}

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "AVAILABLE") return "success";
  if (status === "FULL") return "warning";
  if (status === "EXCEEDED") return "danger";
  return "neutral";
}

export default function RoomDetailPage() {
  const { t } = useI18n();
  useToast();
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const { data, loading, error } = useApi<RoomDetail>(`/api/rooms/${params.id}`);

  if (loading || !data) {
    return (
      <div className="space-y-5">
        <PageHeader title={t("rooms.detailTitle")} />
        <ErrorNotice message={error} />
        {loading && <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>}
      </div>
    );
  }

  const { capacityStatus } = data;

  return (
    <div className="space-y-5">
      <PageHeader
        title={data.name}
        description={data.number ? `#${data.number}` : undefined}
        actions={
          <button type="button" className="btn-secondary" onClick={() => router.push("/dashboard/academic/rooms")}>
            {t("common.back")}
          </button>
        }
      />

      <ErrorNotice message={error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("common.capacity")} value={data.capacity} />
        <StatCard
          label={t("rooms.currentStudents")}
          value={data.currentStudents}
          tone={capacityStatus.status === "EXCEEDED" ? "negative" : "default"}
        />
        <StatCard
          label={t("rooms.availableSeats")}
          value={capacityStatus.availableSeats !== null && capacityStatus.availableSeats >= 0 ? capacityStatus.availableSeats : "—"}
          tone={capacityStatus.status === "EXCEEDED" ? "negative" : "positive"}
        />
        <StatCard label={t("rooms.location")} value={data.branch?.name ?? "—"} />
      </div>

      <div className="flex items-center gap-2">
        <Badge tone={statusTone(capacityStatus.status)}>{capacityStatus.message}</Badge>
        <Badge tone={data.isActive ? "success" : "neutral"}>{data.isActive ? t("common.active") : t("common.inactive")}</Badge>
      </div>

      <div className="card overflow-x-auto">
        <p className="p-4 pb-0 text-sm font-semibold">{t("rooms.assignedGroups")}</p>
        <table className="w-full min-w-[640px] text-start text-sm">
          <thead className="border-b border-black/5 text-black/60 dark:border-white/10 dark:text-white/60">
            <tr>
              <th className="p-3 text-start font-medium">{t("groups.title")}</th>
              <th className="p-3 text-start font-medium">{t("common.subject")}</th>
              <th className="p-3 text-start font-medium">{t("common.stage")}</th>
              <th className="p-3 text-start font-medium">{t("common.grade")}</th>
              <th className="p-3 text-start font-medium">{t("common.teacher")}</th>
              <th className="p-3 text-start font-medium">{t("common.students")}</th>
              <th className="p-3 text-start font-medium">{t("rooms.status")}</th>
            </tr>
          </thead>
          <tbody>
            {data.groups.length === 0 && (
              <tr>
                <td className="p-6 text-center text-black/50 dark:text-white/50" colSpan={7}>
                  {t("rooms.noGroups")}
                </td>
              </tr>
            )}
            {data.groups.map((g) => (
              <tr key={g.id} className="border-b border-black/5 dark:border-white/5">
                <td className="p-3 font-medium">
                  <Link href={`/dashboard/academic/groups/${g.id}`} className="hover:underline">
                    {g.name}
                  </Link>
                </td>
                <td className="p-3">{g.subject?.name ?? "—"}</td>
                <td className="p-3">{g.academicLevel?.name ?? "—"}</td>
                <td className="p-3">{g.academicGrade?.name ?? "—"}</td>
                <td className="p-3">{g.teacher?.fullName ?? "—"}</td>
                <td className="p-3">{g.studentCount}</td>
                <td className="p-3">
                  <Badge tone={statusTone(g.capacityStatus.status)}>{g.capacityStatus.message}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
