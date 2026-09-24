"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { apiPatch, apiPost, formatDateTime, formatMoneyClient, qs, useApi } from "@/lib/client";
import { Badge, DataTable, ErrorNotice, Field, Modal, PageHeader, Pager, StatCard, useToast } from "@/components/ui";
import { WhatsAppButton } from "@/components/WhatsAppButton";
import { renderWhatsAppTemplate, resolveParentWhatsApp } from "@/lib/whatsapp-link";

interface StudentOption {
  id: string;
  fullName: string;
  studentCode: string;
}

interface PaymentRow {
  id: string;
  receiptNumber: string;
  student: {
    id: string;
    fullName: string;
    studentCode: string;
    primaryParent: { fullName: string; phone: string | null; whatsappNumber: string | null } | null;
  };
  amount: number;
  refundedAmount: number;
  method: string;
  status: string;
  paidAt: string;
  notes: string | null;
  invoice: { id: string; invoiceNumber: string; status: string } | null;
}

const METHODS = ["CASH", "BANK_TRANSFER", "CARD", "OTHER"];

function toneFor(status: string) {
  if (status === "COMPLETED") return "success" as const;
  if (status === "VOIDED") return "danger" as const;
  if (status === "REFUNDED" || status === "PARTIALLY_REFUNDED") return "warning" as const;
  return "neutral" as const;
}

export default function PaymentsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [page, setPage] = useState(1);

  const { data, loading, error, reload } = useApi<{
    payments: PaymentRow[];
    totals: { collected: number };
    pagination: { page: number; totalPages: number };
  }>(`/api/payments${qs({ page, pageSize: 25 })}`);

  // -- Record payment --
  const [createOpen, setCreateOpen] = useState(false);
  const [studentQuery, setStudentQuery] = useState("");
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
  const [studentId, setStudentId] = useState("");
  const [studentLabel, setStudentLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const term = studentQuery.trim();
    if (term.length < 2) {
      setStudentOptions([]);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      fetch(`/api/search${qs({ q: term })}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((body) => setStudentOptions(body.data?.students ?? []))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [studentQuery]);

  function openCreate() {
    setStudentId("");
    setStudentLabel("");
    setStudentQuery("");
    setStudentOptions([]);
    setAmount("");
    setMethod("CASH");
    setNotes("");
    setFormError(null);
    setCreateOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await apiPost("/api/payments", {
        studentId,
        amount: Number(amount),
        method,
        notes: notes.trim() || undefined
      });
      toast.success(t("common.created"));
      setCreateOpen(false);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to record payment.");
    } finally {
      setSubmitting(false);
    }
  }

  // -- Void / refund --
  const [actionTarget, setActionTarget] = useState<{ payment: PaymentRow; kind: "VOID" | "REFUND" } | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function openAction(payment: PaymentRow, kind: "VOID" | "REFUND") {
    setActionTarget({ payment, kind });
    setRefundAmount(String(payment.amount - payment.refundedAmount));
    setActionReason("");
    setActionError(null);
  }

  async function handleAction() {
    if (!actionTarget) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await apiPatch(`/api/payments/${actionTarget.payment.id}`, {
        action: actionTarget.kind,
        reason: actionReason.trim(),
        ...(actionTarget.kind === "REFUND" ? { amount: Number(refundAmount) } : {})
      });
      toast.success(t("common.saved"));
      setActionTarget(null);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update payment.");
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("payments.title")}
        actions={
          <button type="button" className="btn-primary" onClick={openCreate}>
            {t("payments.add")}
          </button>
        }
      />

      <ErrorNotice message={error} />

      {data && <StatCard label="Collected" value={formatMoneyClient(data.totals.collected)} tone="positive" />}

      <DataTable
        columns={["Receipt", t("common.student"), t("common.amount"), "Method", t("common.date"), t("common.status"), t("common.actions"), ""]}
        loading={loading}
        isEmpty={(data?.payments.length ?? 0) === 0}
        emptyTitle={t("payments.empty")}
      >
        {data?.payments.map((p) => (
          <tr key={p.id} className="border-b border-black/5 dark:border-white/5">
            <td className="p-3 font-mono text-xs">
              {p.invoice ? (
                <Link href={`/dashboard/finance/invoices/${p.invoice.id}`} className="hover:underline">
                  {p.receiptNumber}
                </Link>
              ) : (
                p.receiptNumber
              )}
            </td>
            <td className="p-3 font-medium">
              {p.student.fullName}
              <span className="ms-2 font-mono text-xs text-black/45 dark:text-white/45">{p.student.studentCode}</span>
            </td>
            <td className="p-3">
              {formatMoneyClient(p.amount)}
              {p.refundedAmount > 0 && (
                <span className="ms-1 text-xs text-amber-600 dark:text-amber-400">
                  (-{formatMoneyClient(p.refundedAmount)})
                </span>
              )}
            </td>
            <td className="p-3">{p.method}</td>
            <td className="p-3">{formatDateTime(p.paidAt)}</td>
            <td className="p-3">
              <Badge tone={toneFor(p.status)}>{p.status}</Badge>
            </td>
            <td className="p-3">
              {p.status === "COMPLETED" || p.status === "PARTIALLY_REFUNDED" ? (
                <div className="flex gap-3">
                  <button type="button" className="text-xs hover:underline" onClick={() => openAction(p, "REFUND")}>
                    {t("payments.refund")}
                  </button>
                  {p.status === "COMPLETED" && (
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:underline dark:text-red-400"
                      onClick={() => openAction(p, "VOID")}
                    >
                      {t("payments.void")}
                    </button>
                  )}
                </div>
              ) : (
                "—"
              )}
            </td>
            <td className="p-3">
              {p.status === "COMPLETED" && (
                <WhatsAppButton
                  target={resolveParentWhatsApp(p.student.primaryParent)}
                  message={renderWhatsAppTemplate("OTHER", {
                    message: `السلام عليكم، تم استلام دفعة بمبلغ ${formatMoneyClient(p.amount)} للطالب ${p.student.fullName} (إيصال رقم ${p.receiptNumber}). شكرًا لكم.`
                  })}
                  label={t("payments.sendWhatsApp")}
                />
              )}
            </td>
          </tr>
        ))}
      </DataTable>

      <Pager page={data?.pagination.page ?? 1} totalPages={data?.pagination.totalPages ?? 1} onChange={setPage} />

      <Modal open={createOpen} title={t("payments.add")} onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleSubmit} className="space-y-3">
          <ErrorNotice message={formError} />
          <Field label={t("common.student")} required>
            {(id) => (
              <div className="relative">
                <input
                  id={id}
                  className="input"
                  placeholder="Search by name, code or phone"
                  value={studentId ? studentLabel : studentQuery}
                  onChange={(e) => {
                    setStudentId("");
                    setStudentQuery(e.target.value);
                  }}
                  required
                />
                {!studentId && studentOptions.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full rounded-lg border border-black/10 bg-white text-sm shadow-lg dark:border-white/10 dark:bg-surface-dark-muted">
                    {studentOptions.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          className="block w-full px-3 py-2 text-start hover:bg-black/5 dark:hover:bg-white/10"
                          onClick={() => {
                            setStudentId(s.id);
                            setStudentLabel(`${s.fullName} (${s.studentCode})`);
                            setStudentOptions([]);
                          }}
                        >
                          {s.fullName} <span className="font-mono text-xs opacity-60">{s.studentCode}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Field>
          <Field label={t("common.amount")} required>
            {(id) => (
              <input id={id} type="number" min={0.01} step="0.01" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            )}
          </Field>
          <Field label="Method" required>
            {(id) => (
              <select id={id} className="input" value={method} onChange={(e) => setMethod(e.target.value)} required>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t("common.notes")}>
            {(id) => <textarea id={id} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
          <p className="text-xs text-black/50 dark:text-white/50">
            The amount is automatically applied to the student's oldest unpaid subscriptions first.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !studentId || !amount}>
              {submitting ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(actionTarget)}
        title={actionTarget?.kind === "VOID" ? t("payments.void") : t("payments.refund")}
        onClose={() => setActionTarget(null)}
        footer={
          <>
            <button type="button" className="rounded-lg border border-black/10 px-4 py-2 text-sm dark:border-white/10" onClick={() => setActionTarget(null)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={
                actionBusy ||
                actionReason.trim().length < 3 ||
                (actionTarget?.kind === "REFUND" && (!refundAmount || Number(refundAmount) <= 0))
              }
              onClick={handleAction}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {actionBusy ? t("common.loading") : actionTarget?.kind === "VOID" ? t("payments.void") : t("payments.refund")}
            </button>
          </>
        }
      >
        <ErrorNotice message={actionError} />
        <p className="text-sm text-black/70 dark:text-white/70">
          {actionTarget?.kind === "VOID"
            ? `Void receipt ${actionTarget?.payment.receiptNumber}? This reverses its subscription allocations.`
            : `Refund receipt ${actionTarget?.payment.receiptNumber}.`}
        </p>
        {actionTarget?.kind === "REFUND" && (
          <Field label={t("common.amount")} required>
            {(id) => (
              <input
                id={id}
                type="number"
                min={0.01}
                step="0.01"
                max={actionTarget.payment.amount - actionTarget.payment.refundedAmount}
                className="input"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
              />
            )}
          </Field>
        )}
        <Field label={`${t("common.reason")} (recorded in the audit log)`} required>
          {(id) => (
            <textarea id={id} className="input min-h-[80px]" value={actionReason} onChange={(e) => setActionReason(e.target.value)} placeholder="Explain why this change is being made" />
          )}
        </Field>
      </Modal>
    </div>
  );
}
