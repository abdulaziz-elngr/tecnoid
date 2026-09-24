"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { apiPost, formatDateTime, qs, useApi } from "@/lib/client";
import { Badge, DataTable, ErrorNotice, PageHeader, Pager, StatCard, useToast } from "@/components/ui";

interface StatusInfo {
  configured: boolean;
  provider: string | null;
  configurationPath: string;
  requiredEnvVars: string[];
  queue: { queued: number; failed: number; sent: number };
}

interface MessageRow {
  id: string;
  toNumber: string;
  body: string;
  status: string;
  templateKey: string | null;
  attempts: number;
  errorMessage: string | null;
  sentAt: string | null;
  createdAt: string;
}

function toneFor(status: string) {
  if (status === "DELIVERED" || status === "READ" || status === "SENT") return "success" as const;
  if (status === "FAILED") return "danger" as const;
  return "warning" as const;
}

export default function WhatsAppPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [retrying, setRetrying] = useState<string | null>(null);

  const { data: status, error: statusError } = useApi<StatusInfo>("/api/whatsapp/status");
  const { data, loading, error, reload } = useApi<{
    messages: MessageRow[];
    pagination: { page: number; totalPages: number };
  }>(`/api/whatsapp/messages${qs({ page, pageSize: 25 })}`);

  async function retry(id: string) {
    setRetrying(id);
    try {
      await apiPost(`/api/whatsapp/messages/${id}/retry`);
      toast.success(t("common.saved"));
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to retry message.");
    } finally {
      setRetrying(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t("whatsapp.title")} />

      <ErrorNotice message={statusError ?? error} />

      {status && !status.configured && (
        <div className="card border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <p className="font-medium">{t("whatsapp.notConfigured")}</p>
          <p className="mt-1 text-xs">
            Set {status.requiredEnvVars.join(" and ")} to enable sending, then configure the integration at{" "}
            {status.configurationPath}.
          </p>
        </div>
      )}

      {status && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Sent" value={status.queue.sent} tone="positive" />
          <StatCard label="Queued" value={status.queue.queued} />
          <StatCard label="Failed" value={status.queue.failed} tone="negative" />
        </div>
      )}

      <DataTable
        columns={["To", "Template", "Body", t("common.status"), "Attempts", t("common.date"), t("common.actions")]}
        loading={loading}
        isEmpty={(data?.messages.length ?? 0) === 0}
        emptyTitle={t("whatsapp.empty")}
      >
        {data?.messages.map((m) => (
          <tr key={m.id} className="border-b border-black/5 dark:border-white/5">
            <td className="p-3 font-mono text-xs">{m.toNumber}</td>
            <td className="p-3 text-xs">{m.templateKey ?? "—"}</td>
            <td className="max-w-xs truncate p-3 text-xs" title={m.body}>
              {m.body}
            </td>
            <td className="p-3">
              <Badge tone={toneFor(m.status)}>{m.status}</Badge>
              {m.errorMessage && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{m.errorMessage}</p>}
            </td>
            <td className="p-3">{m.attempts}</td>
            <td className="p-3">{formatDateTime(m.sentAt ?? m.createdAt)}</td>
            <td className="p-3">
              {m.status === "FAILED" && (
                <button type="button" className="text-xs hover:underline" disabled={retrying === m.id} onClick={() => retry(m.id)}>
                  {retrying === m.id ? t("common.loading") : t("whatsapp.retry")}
                </button>
              )}
            </td>
          </tr>
        ))}
      </DataTable>

      <Pager page={data?.pagination.page ?? 1} totalPages={data?.pagination.totalPages ?? 1} onChange={setPage} />
    </div>
  );
}
