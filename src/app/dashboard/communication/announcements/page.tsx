"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { apiPost, formatDateTime, qs, useApi } from "@/lib/client";
import { Badge, ErrorNotice, Field, Modal, PageHeader, useToast } from "@/components/ui";
import { WhatsAppButton } from "@/components/WhatsAppButton";
import { renderWhatsAppTemplate, resolveParentWhatsApp } from "@/lib/whatsapp-link";

type AudienceType = "STUDENT" | "GROUP" | "SELECTED";

interface AnnouncementRow {
  id: string;
  title: string;
  message: string;
  audienceType: AudienceType;
  group: { id: string; name: string } | null;
  recipientCount: number;
  createdAt: string;
}

interface AnnouncementDetail {
  id: string;
  title: string;
  message: string;
  audienceType: AudienceType;
  group: { id: string; name: string } | null;
  createdAt: string;
  recipients: {
    id: string;
    fullName: string;
    studentCode: string;
    primaryParent: { fullName: string; phone: string | null; whatsappNumber: string | null } | null;
  }[];
}

interface GroupOption {
  id: string;
  name: string;
}

interface StudentSearchResult {
  id: string;
  fullName: string;
  studentCode: string;
}

/**
 * Every wa.me link opens exactly one conversation — a click-to-chat URL
 * can never broadcast to a whole group at once. For a multi-recipient
 * announcement this page lists every recipient with their own button, so
 * the staff member opens/sends each one individually (spec item 11).
 */
export default function AnnouncementsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<AnnouncementRow[]>("/api/announcements");
  const { data: groups } = useApi<GroupOption[]>("/api/groups");

  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [audienceType, setAudienceType] = useState<AudienceType>("STUDENT");
  const [groupId, setGroupId] = useState("");
  const [studentQuery, setStudentQuery] = useState("");
  const [studentOptions, setStudentOptions] = useState<StudentSearchResult[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<StudentSearchResult[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [viewingId, setViewingId] = useState<string | null>(null);
  const { data: detail, loading: detailLoading } = useApi<AnnouncementDetail>(
    viewingId ? `/api/announcements/${viewingId}` : null,
    [viewingId]
  );

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
    setTitle("");
    setMessage("");
    setAudienceType("STUDENT");
    setGroupId("");
    setStudentQuery("");
    setStudentOptions([]);
    setSelectedStudents([]);
    setFormError(null);
    setModalOpen(true);
  }

  function toggleStudent(student: StudentSearchResult) {
    setSelectedStudents((list) =>
      list.some((s) => s.id === student.id) ? list.filter((s) => s.id !== student.id) : [...list, student]
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (audienceType === "STUDENT" && selectedStudents.length !== 1) {
      setFormError("Select exactly one student.");
      return;
    }
    if (audienceType === "GROUP" && !groupId) {
      setFormError(t("common.selectSubject"));
      return;
    }
    if (audienceType === "SELECTED" && selectedStudents.length === 0) {
      setFormError("Select at least one student.");
      return;
    }

    setSubmitting(true);
    try {
      const payload =
        audienceType === "STUDENT"
          ? { title, message, audienceType, studentId: selectedStudents[0].id }
          : audienceType === "GROUP"
            ? { title, message, audienceType, groupId }
            : { title, message, audienceType, studentIds: selectedStudents.map((s) => s.id) };

      const result = await apiPost<{ id: string }>("/api/announcements", payload);
      toast.success(t("common.created"));
      setModalOpen(false);
      reload();
      setViewingId(result.id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create announcement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("announcements.title")}
        actions={
          <button type="button" className="btn-primary" onClick={openCreate}>
            {t("announcements.add")}
          </button>
        }
      />

      <ErrorNotice message={error} />

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-start text-sm">
          <thead className="border-b border-black/5 text-black/60 dark:border-white/10 dark:text-white/60">
            <tr>
              <th className="p-3 text-start font-medium">{"Title"}</th>
              <th className="p-3 text-start font-medium">{t("announcements.audienceType")}</th>
              <th className="p-3 text-start font-medium">{t("announcements.recipients")}</th>
              <th className="p-3 text-start font-medium">{t("announcements.createdAt")}</th>
              <th className="p-3 text-start font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {!loading && (data?.length ?? 0) === 0 && (
              <tr>
                <td className="p-6 text-center text-black/50 dark:text-white/50" colSpan={5}>
                  {t("announcements.empty")}
                </td>
              </tr>
            )}
            {data?.map((a) => (
              <tr key={a.id} className="border-b border-black/5 dark:border-white/5">
                <td className="p-3 font-medium">{a.title}</td>
                <td className="p-3">
                  <Badge tone="neutral">{t(`announcements.audience.${a.audienceType}` as Parameters<typeof t>[0])}</Badge>
                  {a.group && <span className="ms-2 text-xs text-black/50 dark:text-white/50">{a.group.name}</span>}
                </td>
                <td className="p-3">{a.recipientCount}</td>
                <td className="p-3 text-xs">{formatDateTime(a.createdAt)}</td>
                <td className="p-3">
                  <button type="button" className="text-xs hover:underline" onClick={() => setViewingId(a.id)}>
                    {t("announcements.sendTo")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Compose */}
      <Modal open={modalOpen} title={t("announcements.composeTitle")} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit} className="space-y-3">
          <ErrorNotice message={formError} />

          <Field label="Title" required>
            {(id) => <input id={id} className="input" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />}
          </Field>

          <Field label={t("announcements.messageLabel")} required>
            {(id) => (
              <textarea
                id={id}
                className="input min-h-[100px]"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
              />
            )}
          </Field>

          <Field label={t("announcements.audienceType")} required>
            {(id) => (
              <select
                id={id}
                className="input"
                value={audienceType}
                onChange={(e) => {
                  setAudienceType(e.target.value as AudienceType);
                  setSelectedStudents([]);
                  setGroupId("");
                }}
              >
                <option value="STUDENT">{t("announcements.audience.STUDENT")}</option>
                <option value="GROUP">{t("announcements.audience.GROUP")}</option>
                <option value="SELECTED">{t("announcements.audience.SELECTED")}</option>
              </select>
            )}
          </Field>

          {audienceType === "GROUP" && (
            <Field label={t("groups.title")} required>
              {(id) => (
                <select id={id} className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)} required>
                  <option value="">{t("common.selectSubject")}</option>
                  {groups?.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          {(audienceType === "STUDENT" || audienceType === "SELECTED") && (
            <Field label={t("common.student")} required>
              {(id) => (
                <div className="space-y-2">
                  <div className="relative">
                    <input
                      id={id}
                      className="input"
                      placeholder="Search by name, code or phone"
                      value={studentQuery}
                      onChange={(e) => setStudentQuery(e.target.value)}
                    />
                    {studentOptions.length > 0 && (
                      <ul className="absolute z-10 mt-1 w-full rounded-lg border border-black/10 bg-white text-sm shadow-lg dark:border-white/10 dark:bg-surface-dark-muted">
                        {studentOptions.map((s) => (
                          <li key={s.id}>
                            <button
                              type="button"
                              className="block w-full px-3 py-2 text-start hover:bg-black/5 dark:hover:bg-white/10"
                              onClick={() => {
                                if (audienceType === "STUDENT") {
                                  setSelectedStudents([s]);
                                } else {
                                  toggleStudent(s);
                                }
                                setStudentQuery("");
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
                  {selectedStudents.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedStudents.map((s) => (
                        <Badge key={s.id} tone="brand">
                          {s.fullName}{" "}
                          <button type="button" className="ms-1" onClick={() => toggleStudent(s)} aria-label="Remove">
                            ×
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Field>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !title.trim() || !message.trim()}>
              {submitting ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>

      {/* Recipients + per-recipient WhatsApp links */}
      <Modal open={Boolean(viewingId)} title={detail?.title ?? t("announcements.sendTo")} onClose={() => setViewingId(null)}>
        {detailLoading && <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>}
        {detail && (
          <div className="space-y-3">
            <p className="whitespace-pre-wrap rounded-lg bg-black/5 p-3 text-sm dark:bg-white/10">{detail.message}</p>
            <p className="text-xs font-semibold text-black/60 dark:text-white/60">
              {t("announcements.recipients")} ({detail.recipients.length})
            </p>
            <ul className="divide-y divide-black/5 dark:divide-white/10">
              {detail.recipients.map((r) => {
                const target = resolveParentWhatsApp(r.primaryParent);
                return (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                    <div>
                      <p className="text-sm font-medium">{r.fullName}</p>
                      <p className="text-xs text-black/50 dark:text-white/50">
                        {r.primaryParent?.fullName ?? "—"} {!target.phone && `· ${t("announcements.noWhatsapp")}`}
                      </p>
                    </div>
                    <WhatsAppButton
                      target={target}
                      message={renderWhatsAppTemplate("ANNOUNCEMENT", {
                        studentName: r.fullName,
                        parentName: r.primaryParent?.fullName,
                        message: detail.message
                      })}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Modal>
    </div>
  );
}
