"use client";

import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/client";
import { ErrorNotice, PageHeader } from "@/components/ui";

interface ProfileData {
  student: {
    id: string;
    studentCode: string;
    fullName: string;
    photoUrl: string | null;
    branch: { name: string };
    academicLevel: { name: string } | null;
    primaryGroup: { name: string } | null;
  };
}

export default function StudentCardPage() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { data, loading, error } = useApi<ProfileData>(`/api/students/${params.id}/profile`);

  if (loading || !data) {
    return (
      <div className="space-y-5">
        <PageHeader title={t("students.card")} />
        <ErrorNotice message={error} />
        {loading && <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>}
      </div>
    );
  }

  const { student } = data;

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <PageHeader title={t("students.card")} />
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => router.push(`/dashboard/students/${student.id}`)}>
            {t("common.back")}
          </button>
          <button type="button" className="btn-primary" onClick={() => window.print()}>
            {t("common.print")}
          </button>
        </div>
      </div>

      <ErrorNotice message={error} />

      <div className="print-sheet card mx-auto flex w-full max-w-sm flex-col items-center gap-3 border-2 border-tecno-gold p-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-tecno-gold-dark dark:text-tecno-gold">
          TecnoID
        </p>

        {student.photoUrl ? (
          <Image
            src={student.photoUrl}
            alt={student.fullName}
            width={96}
            height={96}
            className="rounded-full border-2 border-black/10 object-cover dark:border-white/10"
            unoptimized
          />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-black/5 text-2xl font-bold dark:bg-white/10">
            {student.fullName.slice(0, 1)}
          </div>
        )}

        <div>
          <p className="text-lg font-bold">{student.fullName}</p>
          <p className="font-mono text-sm text-black/60 dark:text-white/60">{student.studentCode}</p>
        </div>

        <div className="grid w-full grid-cols-2 gap-1 text-xs text-black/60 dark:text-white/60">
          <span>{student.branch.name}</span>
          <span>{student.academicLevel?.name ?? "—"}</span>
        </div>

        {student.primaryGroup && <p className="text-xs text-black/50 dark:text-white/50">{student.primaryGroup.name}</p>}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/students/${student.id}/qr`} alt="Attendance QR code" width={160} height={160} className="mt-2" />
      </div>
    </div>
  );
}
