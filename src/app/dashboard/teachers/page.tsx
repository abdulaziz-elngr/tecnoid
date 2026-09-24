"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

interface TeacherRow {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  isAssistant: boolean;
  isActive: boolean;
  branch: { id: string; name: string };
  _count: { groupsAsTeacher: number; groupsAsAssistant: number };
}

interface ListResponse {
  data: TeacherRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export default function TeachersPage() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (search.trim()) params.set("search", search.trim());

    const controller = new AbortController();
    fetch(`/api/teachers?${params.toString()}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to load teachers.");
        }
        return r.json();
      })
      .then(setResult)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [search, page]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">{t("teachers.title")}</h1>
        <button className="btn-primary">{t("teachers.add")}</button>
      </div>

      <input
        className="input mb-4 max-w-sm"
        placeholder={t("teachers.search")}
        value={search}
        onChange={(e) => {
          setPage(1);
          setSearch(e.target.value);
        }}
      />

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-start text-sm">
          <thead className="border-b border-black/5 text-black/60 dark:border-white/10 dark:text-white/60">
            <tr>
              <th className="p-3 text-start">{t("teachers.title")}</th>
              <th className="p-3 text-start">Role</th>
              <th className="p-3 text-start">Branch</th>
              <th className="p-3 text-start">Phone</th>
              <th className="p-3 text-start">Groups</th>
              <th className="p-3 text-start">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-black/5 dark:border-white/5">
                  <td className="p-3" colSpan={6}>
                    <span className="block h-4 w-full animate-pulse rounded bg-black/10 dark:bg-white/10" />
                  </td>
                </tr>
              ))}

            {!loading && result?.data.length === 0 && (
              <tr>
                <td className="p-6 text-center text-black/50 dark:text-white/50" colSpan={6}>
                  {t("teachers.empty")}
                </td>
              </tr>
            )}

            {!loading &&
              result?.data.map((tch) => (
                <tr key={tch.id} className="border-b border-black/5 dark:border-white/5">
                  <td className="p-3 font-medium">{tch.fullName}</td>
                  <td className="p-3">{tch.isAssistant ? t("teachers.assistant") : t("teachers.teacher")}</td>
                  <td className="p-3">{tch.branch.name}</td>
                  <td className="p-3">{tch.phone ?? "—"}</td>
                  <td className="p-3">{tch._count.groupsAsTeacher + tch._count.groupsAsAssistant}</td>
                  <td className="p-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        tch.isActive
                          ? "bg-tecno-gold/15 text-tecno-gold-dark dark:text-tecno-gold"
                          : "bg-black/10 text-black/50 dark:bg-white/10 dark:text-white/50"
                      }`}
                    >
                      {tch.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {result && result.pagination.totalPages > 1 && (
        <div className="mt-4 flex items-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/10"
          >
            ‹
          </button>
          <span className="text-sm">
            {result.pagination.page} / {result.pagination.totalPages}
          </span>
          <button
            disabled={page >= result.pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/10"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
