"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { apiDelete, apiPatch, apiPost, useApi } from "@/lib/client";
import { Badge, ConfirmDialog, DataTable, ErrorNotice, Field, Modal, PageHeader, useToast } from "@/components/ui";

interface BranchOption {
  id: string;
  name: string;
}

interface RoomRow {
  id: string;
  name: string;
  number: string | null;
  capacity: number;
  isActive: boolean;
  branch: { id: string; name: string };
  _count: { groups: number };
}

export default function RoomsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<RoomRow[]>("/api/rooms");
  const { data: branches } = useApi<BranchOption[]>("/api/branches");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RoomRow | null>(null);
  const [branchId, setBranchId] = useState("");
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [capacity, setCapacity] = useState(20);
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoomRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!editing && branches && branches[0] && !branchId) setBranchId(branches[0].id);
  }, [branches, editing, branchId]);

  function openCreate() {
    setEditing(null);
    setName("");
    setNumber("");
    setCapacity(20);
    setIsActive(true);
    setBranchId(branches?.[0]?.id ?? "");
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(room: RoomRow) {
    setEditing(room);
    setName(room.name);
    setNumber(room.number ?? "");
    setCapacity(room.capacity);
    setIsActive(room.isActive);
    setBranchId(room.branch.id);
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      if (editing) {
        await apiPatch(`/api/rooms/${editing.id}`, {
          name: name.trim(),
          number: number.trim() || null,
          capacity,
          isActive
        });
        toast.success(t("common.saved"));
      } else {
        await apiPost("/api/rooms", {
          branchId,
          name: name.trim(),
          number: number.trim() || undefined,
          capacity,
          isActive
        });
        toast.success(t("common.created"));
      }
      setModalOpen(false);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save room.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/rooms/${deleteTarget.id}`);
      toast.success(t("common.deleted"));
      setDeleteTarget(null);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete room.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("rooms.title")}
        actions={
          <button type="button" className="btn-primary" onClick={openCreate} disabled={!branches?.length}>
            {t("rooms.add")}
          </button>
        }
      />

      <ErrorNotice message={error} />

      <DataTable
        columns={[t("rooms.title"), t("common.branch"), "Capacity", t("nav.groups"), t("common.status"), t("common.actions")]}
        loading={loading}
        isEmpty={(data?.length ?? 0) === 0}
        emptyTitle={t("rooms.empty")}
      >
        {data?.map((room) => (
          <tr key={room.id} className="border-b border-black/5 dark:border-white/5">
            <td className="p-3 font-medium">
              <Link href={`/dashboard/academic/rooms/${room.id}`} className="hover:underline">
                {room.name}
              </Link>
              {room.number && <span className="ms-2 text-xs text-black/45 dark:text-white/45">#{room.number}</span>}
            </td>
            <td className="p-3">{room.branch.name}</td>
            <td className="p-3">{room.capacity}</td>
            <td className="p-3">{room._count.groups}</td>
            <td className="p-3">
              <Badge tone={room.isActive ? "success" : "neutral"}>{room.isActive ? "Active" : "Inactive"}</Badge>
            </td>
            <td className="p-3">
              <div className="flex gap-3">
                <button type="button" className="text-xs hover:underline" onClick={() => openEdit(room)}>
                  {t("common.edit")}
                </button>
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline dark:text-red-400"
                  onClick={() => setDeleteTarget(room)}
                >
                  {t("common.delete")}
                </button>
              </div>
            </td>
          </tr>
        ))}
      </DataTable>

      <Modal open={modalOpen} title={editing ? t("common.edit") : t("rooms.add")} onClose={() => setModalOpen(false)}>
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
          <Field label={t("rooms.title")} required>
            {(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} required />}
          </Field>
          <Field label="Number" hint="Optional room/label number">
            {(id) => <input id={id} className="input" value={number} onChange={(e) => setNumber(e.target.value)} />}
          </Field>
          <Field label="Capacity" required>
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
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4" />
            Active
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !name.trim() || (!editing && !branchId)}>
              {submitting ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t("common.delete")}
        message={`Delete "${deleteTarget?.name}"? Only possible while no groups are assigned to it.`}
        confirmLabel={t("common.delete")}
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
