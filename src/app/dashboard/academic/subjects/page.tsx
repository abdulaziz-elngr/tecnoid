"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { apiDelete, apiPatch, apiPost, useApi } from "@/lib/client";
import { Badge, ConfirmDialog, DataTable, ErrorNotice, Field, Modal, PageHeader, useToast } from "@/components/ui";

interface Grade {
  id: string;
  name: string;
  order: number;
}

interface AcademicLevel {
  id: string;
  name: string;
  order: number;
  grades: Grade[];
}

interface SubjectRow {
  id: string;
  name: string;
  academicLevel: { id: string; name: string } | null;
  academicGrade: { id: string; name: string } | null;
  _count: { groups: number; exams: number };
}

export default function SubjectsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<SubjectRow[]>("/api/subjects");
  const { data: levels } = useApi<AcademicLevel[]>("/api/academic-levels");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SubjectRow | null>(null);
  const [name, setName] = useState("");
  const [levelId, setLevelId] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SubjectRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const gradesForLevel = useMemo(
    () => levels?.find((l) => l.id === levelId)?.grades ?? [],
    [levels, levelId]
  );

  function openCreate() {
    setEditing(null);
    setName("");
    setLevelId("");
    setGradeId("");
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(subject: SubjectRow) {
    setEditing(subject);
    setName(subject.name);
    setLevelId(subject.academicLevel?.id ?? "");
    setGradeId(subject.academicGrade?.id ?? "");
    setFormError(null);
    setModalOpen(true);
  }

  // Stage changed → the previously selected Grade may no longer belong
  // to it, so it is cleared and must be re-selected (spec item 1: "If
  // the Stage changes, the Grade selection must be validated again").
  function handleLevelChange(nextLevelId: string) {
    setLevelId(nextLevelId);
    setGradeId("");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!levelId || !gradeId) {
      setFormError(t("common.selectGrade"));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const payload = { name: name.trim(), academicLevelId: levelId, academicGradeId: gradeId };
      if (editing) {
        await apiPatch(`/api/subjects/${editing.id}`, payload);
        toast.success(t("common.saved"));
      } else {
        await apiPost("/api/subjects", payload);
        toast.success(t("common.created"));
      }
      setModalOpen(false);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save subject.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/subjects/${deleteTarget.id}`);
      toast.success(t("common.deleted"));
      setDeleteTarget(null);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete subject.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("subjects.title")}
        actions={
          <button type="button" className="btn-primary" onClick={openCreate}>
            {t("subjects.add")}
          </button>
        }
      />

      <ErrorNotice message={error} />

      <DataTable
        columns={[t("subjects.title"), t("subjects.stage"), t("subjects.grade"), t("nav.groups"), t("nav.exams"), t("common.actions")]}
        loading={loading}
        isEmpty={(data?.length ?? 0) === 0}
        emptyTitle={t("subjects.empty")}
      >
        {data?.map((subject) => (
          <tr key={subject.id} className="border-b border-black/5 dark:border-white/5">
            <td className="p-3 font-medium">{subject.name}</td>
            <td className="p-3">{subject.academicLevel?.name ?? "—"}</td>
            <td className="p-3">
              {subject.academicGrade?.name ?? (
                <Badge tone="warning">{t("subjects.needsAssignment")}</Badge>
              )}
            </td>
            <td className="p-3">{subject._count.groups}</td>
            <td className="p-3">{subject._count.exams}</td>
            <td className="p-3">
              <div className="flex gap-3">
                <button type="button" className="text-xs hover:underline" onClick={() => openEdit(subject)}>
                  {t("common.edit")}
                </button>
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline dark:text-red-400"
                  onClick={() => setDeleteTarget(subject)}
                >
                  {t("common.delete")}
                </button>
              </div>
            </td>
          </tr>
        ))}
      </DataTable>

      <Modal open={modalOpen} title={editing ? t("subjects.editTitle") : t("subjects.add")} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit} className="space-y-3">
          <ErrorNotice message={formError} />

          {/* Stage → Grade → Subject fields, in that order (spec item 1). */}
          <Field label={t("common.stage")} required>
            {(id) => (
              <select id={id} className="input" value={levelId} onChange={(e) => handleLevelChange(e.target.value)} required>
                <option value="">{t("common.selectStage")}</option>
                {levels?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label={t("common.grade")} required>
            {(id) => (
              <select
                id={id}
                className="input"
                value={gradeId}
                onChange={(e) => setGradeId(e.target.value)}
                required
                disabled={!levelId}
              >
                <option value="">{levelId ? t("common.selectGrade") : t("subjects.selectStageFirst")}</option>
                {gradesForLevel.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label={t("subjects.title")} required>
            {(id) => (
              <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            )}
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !name.trim() || !levelId || !gradeId}>
              {submitting ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t("common.delete")}
        message={t("subjects.deleteConfirm").replace("{name}", deleteTarget?.name ?? "")}
        confirmLabel={t("common.delete")}
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
