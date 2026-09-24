"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { apiDelete, apiPatch, apiPost, useApi } from "@/lib/client";
import { Badge, ConfirmDialog, DataTable, ErrorNotice, Field, Modal, PageHeader, useToast } from "@/components/ui";

interface BranchOption {
  id: string;
  name: string;
}

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

interface SubjectOption {
  id: string;
  name: string;
  academicGradeId: string | null;
}

interface TeacherOption {
  id: string;
  fullName: string;
  isAssistant: boolean;
}

interface RoomOption {
  id: string;
  name: string;
  capacity: number;
  branch: { id: string };
}

interface CapacityStatus {
  status: "AVAILABLE" | "FULL" | "EXCEEDED" | "UNLIMITED";
  message: string;
}

interface GroupRow {
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
  capacityStatus: CapacityStatus;
}

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "AVAILABLE") return "success";
  if (status === "FULL") return "warning";
  if (status === "EXCEEDED") return "danger";
  return "neutral";
}

export default function GroupsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<GroupRow[]>("/api/groups");
  const { data: branches } = useApi<BranchOption[]>("/api/branches");
  const { data: levels } = useApi<AcademicLevel[]>("/api/academic-levels");
  const { data: subjects } = useApi<SubjectOption[]>("/api/subjects");
  const { data: teachersPage } = useApi<TeacherOption[]>("/api/teachers?pageSize=100");
  const { data: rooms } = useApi<RoomOption[]>("/api/rooms");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<GroupRow | null>(null);
  const [branchId, setBranchId] = useState("");
  const [levelId, setLevelId] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState(20);
  const [roomId, setRoomId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [assistantId, setAssistantId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GroupRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!editing && branches?.[0] && !branchId) setBranchId(branches[0].id);
  }, [branches, editing, branchId]);

  const gradesForLevel = useMemo(() => levels?.find((l) => l.id === levelId)?.grades ?? [], [levels, levelId]);
  const subjectsForGrade = useMemo(
    () => subjects?.filter((s) => s.academicGradeId === gradeId) ?? [],
    [subjects, gradeId]
  );
  const roomsForBranch = useMemo(() => rooms?.filter((r) => r.branch.id === branchId) ?? [], [rooms, branchId]);
  const teachersForBranch = teachersPage ?? [];

  function openCreate() {
    setEditing(null);
    setBranchId(branches?.[0]?.id ?? "");
    setLevelId("");
    setGradeId("");
    setSubjectId("");
    setName("");
    setCapacity(20);
    setRoomId("");
    setTeacherId("");
    setAssistantId("");
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(group: GroupRow) {
    setEditing(group);
    setLevelId(group.academicLevel?.id ?? "");
    setGradeId(group.academicGrade?.id ?? "");
    setSubjectId(group.subject?.id ?? "");
    setName(group.name);
    setCapacity(group.capacity);
    setRoomId(group.room?.id ?? "");
    setTeacherId(group.teacher?.id ?? "");
    setAssistantId(group.assistant?.id ?? "");
    setFormError(null);
    setModalOpen(true);
  }

  // Stage → Grade → Subject cascade (spec item 2): changing an upstream
  // selection clears everything that depends on it so an invalid
  // combination can never be submitted.
  function handleLevelChange(nextLevelId: string) {
    setLevelId(nextLevelId);
    setGradeId("");
    setSubjectId("");
  }
  function handleGradeChange(nextGradeId: string) {
    setGradeId(nextGradeId);
    setSubjectId("");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!levelId || !gradeId || !subjectId) {
      setFormError(t("groups.selectSubjectFirst"));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      if (editing) {
        await apiPatch(`/api/groups/${editing.id}`, {
          subjectId,
          academicLevelId: levelId,
          academicGradeId: gradeId,
          roomId: roomId || null,
          teacherId: teacherId || null,
          assistantId: assistantId || null,
          name: name.trim(),
          capacity
        });
        toast.success(t("common.saved"));
      } else {
        await apiPost("/api/groups", {
          branchId,
          subjectId,
          academicLevelId: levelId,
          academicGradeId: gradeId,
          roomId: roomId || undefined,
          teacherId: teacherId || undefined,
          assistantId: assistantId || undefined,
          name: name.trim(),
          capacity
        });
        toast.success(t("common.created"));
      }
      setModalOpen(false);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save group.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/groups/${deleteTarget.id}`);
      toast.success(t("common.deleted"));
      setDeleteTarget(null);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete group.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("groups.title")}
        actions={
          <button type="button" className="btn-primary" onClick={openCreate} disabled={!branches?.length}>
            {t("groups.add")}
          </button>
        }
      />

      <ErrorNotice message={error} />

      <DataTable
        columns={[
          t("groups.name"),
          t("common.stage"),
          t("common.grade"),
          t("common.subject"),
          t("common.teacher"),
          t("common.classroom"),
          t("common.students"),
          t("rooms.status"),
          t("common.actions")
        ]}
        loading={loading}
        isEmpty={(data?.length ?? 0) === 0}
        emptyTitle={t("groups.empty")}
      >
        {data?.map((group) => (
          <tr key={group.id} className="border-b border-black/5 dark:border-white/5">
            <td className="p-3 font-medium">
              <Link href={`/dashboard/academic/groups/${group.id}`} className="hover:underline">
                {group.name}
              </Link>
            </td>
            <td className="p-3">{group.academicLevel?.name ?? "—"}</td>
            <td className="p-3">
              {group.academicGrade?.name ?? <Badge tone="warning">{t("groups.needsGrade")}</Badge>}
            </td>
            <td className="p-3">{group.subject?.name ?? "—"}</td>
            <td className="p-3">{group.teacher?.fullName ?? "—"}</td>
            <td className="p-3">{group.room?.name ?? "—"}</td>
            <td className="p-3">
              {group.studentCount} / {group.room?.capacity ?? group.capacity}
            </td>
            <td className="p-3">
              <Badge tone={statusTone(group.capacityStatus.status)}>{group.capacityStatus.message}</Badge>
            </td>
            <td className="p-3">
              <div className="flex gap-3">
                <Link href={`/dashboard/academic/groups/${group.id}`} className="text-xs hover:underline">
                  {t("common.viewDetails")}
                </Link>
                <button type="button" className="text-xs hover:underline" onClick={() => openEdit(group)}>
                  {t("common.edit")}
                </button>
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline dark:text-red-400"
                  onClick={() => setDeleteTarget(group)}
                >
                  {t("common.delete")}
                </button>
              </div>
            </td>
          </tr>
        ))}
      </DataTable>

      <Modal open={modalOpen} title={editing ? t("groups.editTitle") : t("groups.add")} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit} className="space-y-3">
          <ErrorNotice message={formError} />

          {!editing && (
            <Field label={t("common.branch")} required>
              {(id) => (
                <select id={id} className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)} required>
                  {branches?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          {/* Stage → Grade → Subject, in that order (spec item 2). */}
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
              <select id={id} className="input" value={gradeId} onChange={(e) => handleGradeChange(e.target.value)} required disabled={!levelId}>
                <option value="">{levelId ? t("common.selectGrade") : t("subjects.selectStageFirst")}</option>
                {gradesForLevel.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label={t("common.subject")} required>
            {(id) => (
              <select id={id} className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required disabled={!gradeId}>
                <option value="">{gradeId ? t("common.selectSubject") : t("groups.selectSubjectFirst")}</option>
                {subjectsForGrade.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label={t("groups.name")} required>
            {(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />}
          </Field>

          <Field label={t("common.capacity")} required hint="Planning target — real capacity is enforced against the classroom.">
            {(id) => (
              <input
                id={id}
                type="number"
                min={1}
                className="input"
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
                required
              />
            )}
          </Field>

          <Field label={t("common.classroom")}>
            {(id) => (
              <select id={id} className="input" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">{t("common.none")}</option>
                {roomsForBranch.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.capacity})
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label={t("common.teacher")}>
            {(id) => (
              <select id={id} className="input" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
                <option value="">{t("common.none")}</option>
                {teachersForBranch
                  .filter((tch) => !tch.isAssistant)
                  .map((tch) => (
                    <option key={tch.id} value={tch.id}>
                      {tch.fullName}
                    </option>
                  ))}
              </select>
            )}
          </Field>

          <Field label="Assistant">
            {(id) => (
              <select id={id} className="input" value={assistantId} onChange={(e) => setAssistantId(e.target.value)}>
                <option value="">{t("common.none")}</option>
                {teachersForBranch.map((tch) => (
                  <option key={tch.id} value={tch.id}>
                    {tch.fullName}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={submitting || !name.trim() || !levelId || !gradeId || !subjectId}
            >
              {submitting ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t("common.delete")}
        message={t("groups.deleteConfirm").replace("{name}", deleteTarget?.name ?? "")}
        confirmLabel={t("common.delete")}
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
