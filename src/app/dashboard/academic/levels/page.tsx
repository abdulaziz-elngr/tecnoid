"use client";

import { useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { apiDelete, apiPatch, apiPost, useApi } from "@/lib/client";
import {
  Badge,
  ConfirmDialog,
  DataTable,
  ErrorNotice,
  Field,
  Modal,
  PageHeader,
  useToast
} from "@/components/ui";

interface Grade {
  id: string;
  name: string;
  order: number;
}

interface LevelRow {
  id: string;
  name: string;
  order: number;
  grades: Grade[];
  _count: { students: number; groups: number };
}

export default function AcademicLevelsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<LevelRow[]>("/api/academic-levels");

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [order, setOrder] = useState(0);
  const [gradesText, setGradesText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [gradeDraft, setGradeDraft] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<LevelRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await apiPost("/api/academic-levels", {
        name: name.trim(),
        order,
        grades: gradesText
          .split(",")
          .map((g) => g.trim())
          .filter(Boolean)
      });
      toast.success(t("common.created"));
      setCreateOpen(false);
      setName("");
      setOrder(0);
      setGradesText("");
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create level.");
    } finally {
      setSubmitting(false);
    }
  }

  async function addGrade(levelId: string) {
    const value = (gradeDraft[levelId] ?? "").trim();
    if (!value) return;
    try {
      await apiPatch(`/api/academic-levels/${levelId}`, { addGrade: value });
      setGradeDraft((d) => ({ ...d, [levelId]: "" }));
      toast.success(t("common.saved"));
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add grade.");
    }
  }

  async function removeGrade(levelId: string, gradeId: string) {
    try {
      await apiPatch(`/api/academic-levels/${levelId}`, { removeGradeId: gradeId });
      toast.success(t("common.deleted"));
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove grade.");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/academic-levels/${deleteTarget.id}`);
      toast.success(t("common.deleted"));
      setDeleteTarget(null);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete level.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("levels.title")}
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            {t("levels.add")}
          </button>
        }
      />

      <ErrorNotice message={error} />

      <DataTable
        columns={[t("levels.title"), t("nav.levels"), "Grades", t("common.actions")]}
        loading={loading}
        isEmpty={(data?.length ?? 0) === 0}
        emptyTitle={t("levels.empty")}
      >
        {data?.map((level) => (
          <tr key={level.id} className="border-b border-black/5 align-top dark:border-white/5">
            <td className="p-3 font-medium">{level.name}</td>
            <td className="p-3 text-sm text-black/60 dark:text-white/60">
              {level._count.students} · {level._count.groups} {t("nav.groups")}
            </td>
            <td className="p-3">
              <div className="flex flex-wrap gap-1.5">
                {level.grades.map((g) => (
                  <Badge key={g.id} tone="neutral">
                    <span className="flex items-center gap-1">
                      {g.name}
                      <button
                        type="button"
                        onClick={() => removeGrade(level.id, g.id)}
                        aria-label={`Remove ${g.name}`}
                        className="text-black/40 hover:text-red-600 dark:text-white/40"
                      >
                        ×
                      </button>
                    </span>
                  </Badge>
                ))}
              </div>
              <div className="mt-2 flex gap-1.5">
                <input
                  className="input py-1 text-xs"
                  placeholder={t("levels.add")}
                  value={gradeDraft[level.id] ?? ""}
                  onChange={(e) => setGradeDraft((d) => ({ ...d, [level.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addGrade(level.id);
                    }
                  }}
                />
                <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => addGrade(level.id)}>
                  {t("common.add")}
                </button>
              </div>
            </td>
            <td className="p-3">
              <button
                type="button"
                className="text-xs text-red-600 hover:underline dark:text-red-400"
                onClick={() => setDeleteTarget(level)}
              >
                {t("common.delete")}
              </button>
            </td>
          </tr>
        ))}
      </DataTable>

      <Modal open={createOpen} title={t("levels.add")} onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate} className="space-y-3">
          <ErrorNotice message={formError} />
          <Field label={t("levels.title")} required>
            {(id) => (
              <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            )}
          </Field>
          <Field label="Order" hint="Lower numbers appear first.">
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                className="input"
                value={order}
                onChange={(e) => setOrder(Number(e.target.value))}
              />
            )}
          </Field>
          <Field label="Grades" hint="Comma-separated, e.g. Grade 1, Grade 2, Grade 3">
            {(id) => (
              <input id={id} className="input" value={gradesText} onChange={(e) => setGradesText(e.target.value)} />
            )}
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !name.trim()}>
              {submitting ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t("common.delete")}
        message={`Delete "${deleteTarget?.name}"? This is only possible while no students or groups reference it.`}
        confirmLabel={t("common.delete")}
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
