"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { ErrorNotice, Field, Modal, useToast } from "@/components/ui";

interface StudentRow {
  id: string;
  studentCode: string;
  fullName: string;
  status: string;
  phone: string | null;
  branch: { id: string; name: string };
  academicLevel: { id: string; name: string } | null;
}

interface ListResponse {
  data: StudentRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

interface BranchOption {
  id: string;
  name: string;
}

interface AcademicLevelOption {
  id: string;
  name: string;
}

interface NewStudentForm {
  branchId: string;
  fullName: string;
  gender: "MALE" | "FEMALE" | "";
  dateOfBirth: string;
  phone: string;
  address: string;
  school: string;
  academicLevelId: string;
  notes: string;
  emergencyContact: string;
  parentFullName: string;
  parentPhone: string;
  parentRelationship: "Father" | "Mother" | "Guardian" | "";
}

const EMPTY_FORM: NewStudentForm = {
  branchId: "",
  fullName: "",
  gender: "",
  dateOfBirth: "",
  phone: "",
  address: "",
  school: "",
  academicLevelId: "",
  notes: "",
  emergencyContact: "",
  parentFullName: "",
  parentPhone: "",
  parentRelationship: ""
};

export default function StudentsPage() {
  const { t } = useI18n();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const [addOpen, setAddOpen] = useState(false);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [academicLevels, setAcademicLevels] = useState<AcademicLevelOption[]>([]);
  const [form, setForm] = useState<NewStudentForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Set once the student record itself is created, so that if linking the
  // parent afterwards fails, retrying only redoes the parent step instead
  // of creating a second, duplicate student.
  const [pendingStudentId, setPendingStudentId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (search.trim()) params.set("search", search.trim());

    const controller = new AbortController();
    fetch(`/api/students?${params.toString()}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to load students.");
        }
        return r.json();
      })
      .then(setResult)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [search, page, reloadKey]);

  function openAddModal() {
    setForm(EMPTY_FORM);
    setSaveError(null);
    setPendingStudentId(null);
    setAddOpen(true);

    // Branches gate on nothing beyond auth, but academic levels require
    // "academic.levels.manage" — some roles that can create students
    // (e.g. a receptionist) won't have it, so that fetch is best-effort
    // and the level field just stays hidden/optional if it fails.
    fetch("/api/branches")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((body) => setBranches(body.data ?? []))
      .catch(() => setBranches([]));

    fetch("/api/academic-levels")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((body) => setAcademicLevels(body.data ?? []))
      .catch(() => setAcademicLevels([]));
  }

  async function linkParent(studentId: string) {
    const res = await fetch("/api/parents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId,
        fullName: form.parentFullName.trim(),
        phone: form.parentPhone.trim(),
        whatsappNumber: form.parentPhone.trim(),
        relationship: form.parentRelationship,
        isPrimary: true
      })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? "Failed to save the parent's details.");
  }

  async function submitNewStudent() {
    if (pendingStudentId) {
      // The student was already created on a previous attempt — only the
      // parent link failed, so just retry that step.
      setSaving(true);
      setSaveError(null);
      try {
        await linkParent(pendingStudentId);
        toast.success(t("common.created"));
        setAddOpen(false);
        setPage(1);
        setReloadKey((k) => k + 1);
      } catch (e) {
        setSaveError((e as Error).message);
      } finally {
        setSaving(false);
      }
      return;
    }

    if (
      !form.branchId ||
      !form.fullName.trim() ||
      !form.gender ||
      !form.parentFullName.trim() ||
      !form.parentPhone.trim() ||
      !form.parentRelationship
    ) {
      setSaveError("Please fill in the required fields.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: form.branchId,
          fullName: form.fullName.trim(),
          gender: form.gender,
          dateOfBirth: form.dateOfBirth ? new Date(form.dateOfBirth).toISOString() : undefined,
          phone: form.phone.trim() || undefined,
          address: form.address.trim() || undefined,
          school: form.school.trim() || undefined,
          academicLevelId: form.academicLevelId || undefined,
          notes: form.notes.trim() || undefined,
          emergencyContact: form.emergencyContact.trim() || undefined
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to create student.");

      const newStudentId = body.data.id as string;
      setPendingStudentId(newStudentId);

      await linkParent(newStudentId);

      toast.success(t("common.created"));
      setAddOpen(false);
      setPage(1);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">{t("students.title")}</h1>
        <button type="button" onClick={openAddModal} className="btn-primary">
          {t("students.add")}
        </button>
      </div>

      <input
        className="input mb-4 max-w-sm"
        placeholder={t("students.search")}
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
              <th className="p-3 text-start">Student ID</th>
              <th className="p-3 text-start">{t("students.title")}</th>
              <th className="p-3 text-start">Branch</th>
              <th className="p-3 text-start">Level</th>
              <th className="p-3 text-start">Phone</th>
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
                  {t("students.empty")}
                </td>
              </tr>
            )}

            {!loading &&
              result?.data.map((s) => (
                <tr
                  key={s.id}
                  className="cursor-pointer border-b border-black/5 hover:bg-black/[0.02] dark:border-white/5 dark:hover:bg-white/[0.02]"
                >
                  <td className="p-3 font-mono text-xs">
                    <Link href={`/dashboard/students/${s.id}`} className="hover:underline">
                      {s.studentCode}
                    </Link>
                  </td>
                  <td className="p-3 font-medium">
                    <Link href={`/dashboard/students/${s.id}`} className="hover:underline">
                      {s.fullName}
                    </Link>
                  </td>
                  <td className="p-3">{s.branch.name}</td>
                  <td className="p-3">{s.academicLevel?.name ?? "—"}</td>
                  <td className="p-3">{s.phone ?? "—"}</td>
                  <td className="p-3">
                    <span className="rounded-full bg-tecno-gold/15 px-2 py-0.5 text-xs text-tecno-gold-dark dark:text-tecno-gold">
                      {s.status}
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

      <Modal
        open={addOpen}
        title={t("students.addTitle")}
        onClose={() => setAddOpen(false)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="rounded-lg border border-black/10 px-4 py-2 text-sm dark:border-white/10"
            >
              {t("common.cancel")}
            </button>
            <button type="button" disabled={saving} onClick={submitNewStudent} className="btn-primary disabled:opacity-50">
              {saving ? t("common.loading") : t("common.create")}
            </button>
          </>
        }
      >
        <ErrorNotice message={saveError} />

        <fieldset disabled={!!pendingStudentId} className="contents">
          <Field label={t("common.branch")} required>
            {(id) => (
              <select
                id={id}
                className="input"
                value={form.branchId}
                onChange={(e) => setForm({ ...form, branchId: e.target.value })}
              >
                <option value="">—</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label={t("common.student")} required>
            {(id) => (
              <input
                id={id}
                className="input"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            )}
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("common.gender")} required>
              {(id) => (
                <select
                  id={id}
                  className="input"
                  value={form.gender}
                  onChange={(e) => setForm({ ...form, gender: e.target.value as NewStudentForm["gender"] })}
                >
                  <option value="">—</option>
                  <option value="MALE">{t("common.male")}</option>
                  <option value="FEMALE">{t("common.female")}</option>
                </select>
              )}
            </Field>

            <Field label={t("common.dateOfBirth")}>
              {(id) => (
                <input
                  id={id}
                  type="date"
                  className="input"
                  value={form.dateOfBirth}
                  onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                />
              )}
            </Field>
          </div>

          {academicLevels.length > 0 && (
            <Field label={t("student.profile.academicLevel")}>
              {(id) => (
                <select
                  id={id}
                  className="input"
                  value={form.academicLevelId}
                  onChange={(e) => setForm({ ...form, academicLevelId: e.target.value })}
                >
                  <option value="">—</option>
                  {academicLevels.map((lvl) => (
                    <option key={lvl.id} value={lvl.id}>
                      {lvl.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("student.profile.phone")}>
              {(id) => (
                <input
                  id={id}
                  className="input"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              )}
            </Field>

            <Field label={t("student.profile.emergencyContact")}>
              {(id) => (
                <input
                  id={id}
                  className="input"
                  value={form.emergencyContact}
                  onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })}
                />
              )}
            </Field>
          </div>

          <Field label={t("student.profile.address")}>
            {(id) => (
              <input
                id={id}
                className="input"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            )}
          </Field>

          <Field label={t("student.profile.school")}>
            {(id) => (
              <input
                id={id}
                className="input"
                value={form.school}
                onChange={(e) => setForm({ ...form, school: e.target.value })}
              />
            )}
          </Field>

          <Field label={t("common.notes")}>
            {(id) => (
              <textarea
                id={id}
                className="input min-h-[70px]"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            )}
          </Field>
        </fieldset>

        <hr className="border-black/5 dark:border-white/10" />

        <p className="text-sm font-semibold">{t("student.profile.parents")}</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("student.profile.parentName")} required>
            {(id) => (
              <input
                id={id}
                className="input"
                value={form.parentFullName}
                onChange={(e) => setForm({ ...form, parentFullName: e.target.value })}
              />
            )}
          </Field>

          <Field label={t("student.profile.parentRelationship")} required>
            {(id) => (
              <select
                id={id}
                className="input"
                value={form.parentRelationship}
                onChange={(e) =>
                  setForm({ ...form, parentRelationship: e.target.value as NewStudentForm["parentRelationship"] })
                }
              >
                <option value="">—</option>
                <option value="Father">{t("common.father")}</option>
                <option value="Mother">{t("common.mother")}</option>
                <option value="Guardian">{t("common.guardian")}</option>
              </select>
            )}
          </Field>
        </div>

        <Field label={t("student.profile.parentPhone")} hint={t("student.profile.parentPhoneHint")} required>
          {(id) => (
            <input
              id={id}
              type="tel"
              className="input"
              value={form.parentPhone}
              onChange={(e) => setForm({ ...form, parentPhone: e.target.value })}
            />
          )}
        </Field>
      </Modal>
    </div>
  );
}
