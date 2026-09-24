"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { apiPost, formatDate, qs, useApi } from "@/lib/client";
import { Badge, DataTable, ErrorNotice, Field, Modal, PageHeader, Pager, useToast } from "@/components/ui";

interface BranchOption {
  id: string;
  name: string;
}

interface EmployeeRow {
  id: string;
  fullName: string;
  phone: string | null;
  position: string | null;
  hireDate: string | null;
  isActive: boolean;
  branch: { id: string; name: string };
}

export default function EmployeesPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const query = qs({ search: search || undefined, page, pageSize: 20 });
  const { data, loading, error, reload } = useApi<{
    employees: EmployeeRow[];
    pagination: { page: number; totalPages: number };
  }>(`/api/employees${query}`);
  const { data: branches } = useApi<BranchOption[]>("/api/branches");

  const [modalOpen, setModalOpen] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [position, setPosition] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function openCreate() {
    setFullName("");
    setPhone("");
    setPosition("");
    setBranchId(branches?.[0]?.id ?? "");
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await apiPost("/api/employees", {
        branchId,
        fullName: fullName.trim(),
        phone: phone.trim() || undefined,
        position: position.trim() || undefined
      });
      toast.success(t("common.created"));
      setModalOpen(false);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save employee.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("employees.title")}
        actions={
          <button type="button" className="btn-primary" onClick={openCreate} disabled={!branches?.length}>
            {t("employees.add")}
          </button>
        }
      />

      <ErrorNotice message={error} />

      <input
        className="input max-w-sm"
        placeholder={t("common.search")}
        value={search}
        onChange={(e) => {
          setPage(1);
          setSearch(e.target.value);
        }}
      />

      <DataTable
        columns={[t("employees.title"), "Position", "Phone", t("common.branch"), "Hire date", t("common.status")]}
        loading={loading}
        isEmpty={(data?.employees.length ?? 0) === 0}
        emptyTitle={t("employees.empty")}
      >
        {data?.employees.map((e) => (
          <tr key={e.id} className="border-b border-black/5 dark:border-white/5">
            <td className="p-3 font-medium">
              <Link href={`/dashboard/attendance/employees?employeeId=${e.id}`} className="hover:underline">
                {e.fullName}
              </Link>
            </td>
            <td className="p-3">{e.position ?? "—"}</td>
            <td className="p-3">{e.phone ?? "—"}</td>
            <td className="p-3">{e.branch.name}</td>
            <td className="p-3">{formatDate(e.hireDate)}</td>
            <td className="p-3">
              <Badge tone={e.isActive ? "success" : "neutral"}>{e.isActive ? "Active" : "Inactive"}</Badge>
            </td>
          </tr>
        ))}
      </DataTable>

      <Pager page={data?.pagination.page ?? 1} totalPages={data?.pagination.totalPages ?? 1} onChange={setPage} />

      <Modal open={modalOpen} title={t("employees.add")} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit} className="space-y-3">
          <ErrorNotice message={formError} />
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
          <Field label="Full name" required>
            {(id) => (
              <input id={id} className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            )}
          </Field>
          <Field label="Phone">
            {(id) => <input id={id} className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />}
          </Field>
          <Field label="Position">
            {(id) => <input id={id} className="input" value={position} onChange={(e) => setPosition(e.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !fullName.trim() || !branchId}>
              {submitting ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
