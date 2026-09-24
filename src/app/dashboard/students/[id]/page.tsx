"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { ConfirmDialog, ErrorNotice, Field, useToast } from "@/components/ui";

interface StudentDetail {
  id: string;
  studentCode: string;
  fullName: string;
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "GRADUATED";
  phone: string | null;
  address: string | null;
  school: string | null;
  notes: string | null;
  emergencyContact: string | null;
  gender: string;
  enrollmentDate: string;
}

interface ParentLink {
  id: string;
  relationship: string;
  isPrimary: boolean;
  parent: { id: string; fullName: string; phone: string; whatsappNumber: string | null };
}

type EditableFields = Pick<
  StudentDetail,
  "fullName" | "phone" | "address" | "school" | "notes" | "emergencyContact" | "status"
>;

const STATUS_OPTIONS: StudentDetail["status"][] = ["ACTIVE", "INACTIVE", "SUSPENDED", "GRADUATED"];

export default function StudentProfilePage() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const toast = useToast();

  const [student, setStudent] = useState<StudentDetail | null>(null);
  const [parents, setParents] = useState<ParentLink[] | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditableFields | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/students/${params.id}`).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to load student.");
        return r.json();
      }),
      fetch(`/api/students/${params.id}/parents`).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to load parents.");
        return r.json();
      }),
      fetch("/api/auth/me").then(async (r) => (r.ok ? r.json() : { permissions: [] }))
    ])
      .then(([studentRes, parentsRes, meRes]) => {
        setStudent(studentRes.data);
        setParents(parentsRes.data);
        setPermissions(meRes.permissions ?? []);
      })
      .catch((e) => setError(e.message));
  }, [params.id]);

  function startEditing() {
    if (!student) return;
    setForm({
      fullName: student.fullName,
      phone: student.phone,
      address: student.address,
      school: student.school,
      notes: student.notes,
      emergencyContact: student.emergencyContact,
      status: student.status
    });
    setSaveError(null);
    setEditing(true);
  }

  async function saveEdit() {
    if (!form) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/students/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to update student.");
      setStudent(body.data);
      setEditing(false);
      toast.success(t("common.saved"));
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete(reason: string) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/students/${params.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to delete student.");
      toast.success(t("common.deleted"));
      router.push("/dashboard/students");
    } catch (e) {
      toast.error((e as Error).message);
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  const canEdit = permissions.includes("students.update");
  const canDelete = permissions.includes("students.delete");

  if (error) {
    return <ErrorNotice message={error} />;
  }

  return (
    <div>
      <button onClick={() => router.back()} className="mb-4 text-sm text-tecno-gold-dark dark:text-tecno-gold">
        ← {t("common.back")}
      </button>

      {!student ? (
        <div className="h-24 w-full animate-pulse rounded-card bg-black/5 dark:bg-white/5" />
      ) : (
        <>
          <div className="card mb-4 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold">{student.fullName}</h1>
                <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                  {t("student.profile.studentId")}: <span className="font-mono">{student.studentCode}</span>
                </p>
                <span className="mt-2 inline-block rounded-full bg-tecno-gold/15 px-2 py-0.5 text-xs text-tecno-gold-dark dark:text-tecno-gold">
                  {student.status}
                </span>
              </div>

              {!editing && (
                <div className="flex gap-2">
                  {canEdit && (
                    <button type="button" onClick={startEditing} className="btn-primary">
                      {t("common.edit")}
                    </button>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => setDeleteOpen(true)}
                      className="rounded-lg border border-red-600/30 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400"
                    >
                      {t("common.delete")}
                    </button>
                  )}
                </div>
              )}
            </div>

            {!editing ? (
              <dl className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-black/50 dark:text-white/50">{t("student.profile.phone")}</dt>
                  <dd>{student.phone ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-black/50 dark:text-white/50">{t("student.profile.address")}</dt>
                  <dd>{student.address ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-black/50 dark:text-white/50">{t("student.profile.school")}</dt>
                  <dd>{student.school ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-black/50 dark:text-white/50">{t("student.profile.emergencyContact")}</dt>
                  <dd>{student.emergencyContact ?? "—"}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-black/50 dark:text-white/50">{t("common.notes")}</dt>
                  <dd>{student.notes ?? "—"}</dd>
                </div>
              </dl>
            ) : (
              form && (
                <div className="mt-5 space-y-3">
                  <ErrorNotice message={saveError} />

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
                    <Field label={t("student.profile.phone")}>
                      {(id) => (
                        <input
                          id={id}
                          className="input"
                          value={form.phone ?? ""}
                          onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        />
                      )}
                    </Field>

                    <Field label={t("student.profile.emergencyContact")}>
                      {(id) => (
                        <input
                          id={id}
                          className="input"
                          value={form.emergencyContact ?? ""}
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
                        value={form.address ?? ""}
                        onChange={(e) => setForm({ ...form, address: e.target.value })}
                      />
                    )}
                  </Field>

                  <Field label={t("student.profile.school")}>
                    {(id) => (
                      <input
                        id={id}
                        className="input"
                        value={form.school ?? ""}
                        onChange={(e) => setForm({ ...form, school: e.target.value })}
                      />
                    )}
                  </Field>

                  <Field label={t("common.status")}>
                    {(id) => (
                      <select
                        id={id}
                        className="input"
                        value={form.status}
                        onChange={(e) => setForm({ ...form, status: e.target.value as StudentDetail["status"] })}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>

                  <Field label={t("common.notes")}>
                    {(id) => (
                      <textarea
                        id={id}
                        className="input min-h-[80px]"
                        value={form.notes ?? ""}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      />
                    )}
                  </Field>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      className="rounded-lg border border-black/10 px-4 py-2 text-sm dark:border-white/10"
                    >
                      {t("common.cancel")}
                    </button>
                    <button type="button" disabled={saving} onClick={saveEdit} className="btn-primary disabled:opacity-50">
                      {saving ? t("common.loading") : t("common.save")}
                    </button>
                  </div>
                </div>
              )
            )}
          </div>

          <div className="card p-6">
            <h2 className="mb-3 font-semibold">{t("student.profile.parents")}</h2>
            {!parents ? (
              <div className="h-10 w-full animate-pulse rounded bg-black/5 dark:bg-white/5" />
            ) : parents.length === 0 ? (
              <p className="text-sm text-black/50 dark:text-white/50">{t("student.profile.noParents")}</p>
            ) : (
              <ul className="space-y-2">
                {parents.map((link) => (
                  <li
                    key={link.id}
                    className="flex items-center justify-between rounded-lg border border-black/5 p-3 text-sm dark:border-white/10"
                  >
                    <div>
                      <p className="font-medium">{link.parent.fullName}</p>
                      <p className="text-black/50 dark:text-white/50">
                        {link.relationship} · {link.parent.phone}
                      </p>
                    </div>
                    {link.isPrimary && (
                      <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">Primary</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <ConfirmDialog
            open={deleteOpen}
            title={t("student.profile.deleteTitle")}
            message={t("student.profile.deleteMessage")}
            confirmLabel={t("common.delete")}
            requireReason
            busy={deleting}
            onCancel={() => setDeleteOpen(false)}
            onConfirm={confirmDelete}
          />
        </>
      )}
    </div>
  );
}
