"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { apiDelete, apiPost, qs, useApi } from "@/lib/client";
import { Badge, ErrorNotice, Field, PageHeader } from "@/components/ui";

const DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"] as const;
type Day = (typeof DAYS)[number];

interface Grade {
  id: string;
  name: string;
}
interface AcademicLevel {
  id: string;
  name: string;
  grades: Grade[];
}
interface SubjectOption {
  id: string;
  name: string;
  academicGradeId: string | null;
}
interface GroupOption {
  id: string;
  name: string;
  subject: { id: string; name: string } | null;
  academicLevel: { id: string; name: string } | null;
  academicGrade: { id: string; name: string } | null;
  room: { id: string; name: string } | null;
  teacher: { id: string; fullName: string } | null;
}
interface TeacherOption {
  id: string;
  fullName: string;
}
interface RoomOption {
  id: string;
  name: string;
}

interface ScheduleRow {
  id: string;
  groupId: string;
  dayOfWeek: Day;
  startTime: string;
  endTime: string;
  group: { id: string; name: string; capacity: number; studentCount: number } | null;
  subject: { id: string; name: string } | null;
  academicLevel: { id: string; name: string } | null;
  academicGrade: { id: string; name: string } | null;
  room: { id: string; name: string; capacity: number } | null;
  teacher: { id: string; fullName: string } | null;
  assistant: { id: string; fullName: string } | null;
}

const DAY_KEYS: Record<Day, string> = {
  SUNDAY: "day.sunday",
  MONDAY: "day.monday",
  TUESDAY: "day.tuesday",
  WEDNESDAY: "day.wednesday",
  THURSDAY: "day.thursday",
  FRIDAY: "day.friday",
  SATURDAY: "day.saturday"
};

export default function SchedulePage() {
  const { t } = useI18n();

  // -- Filters (spec item 8) — every option list is populated from real
  // data, and each selection narrows the ones downstream of it. --
  const [filterLevelId, setFilterLevelId] = useState("");
  const [filterGradeId, setFilterGradeId] = useState("");
  const [filterSubjectId, setFilterSubjectId] = useState("");
  const [filterGroupId, setFilterGroupId] = useState("");
  const [filterTeacherId, setFilterTeacherId] = useState("");
  const [filterRoomId, setFilterRoomId] = useState("");
  const [filterDay, setFilterDay] = useState("");

  const { data: levels } = useApi<AcademicLevel[]>("/api/academic-levels");
  const { data: subjects } = useApi<SubjectOption[]>("/api/subjects");
  const { data: groups } = useApi<GroupOption[]>("/api/groups");
  const { data: teachersPage } = useApi<TeacherOption[]>("/api/teachers?pageSize=100");
  const { data: rooms } = useApi<RoomOption[]>("/api/rooms");

  const scheduleQuery = qs({
    academicLevelId: filterLevelId || undefined,
    academicGradeId: filterGradeId || undefined,
    subjectId: filterSubjectId || undefined,
    groupId: filterGroupId || undefined,
    teacherId: filterTeacherId || undefined,
    roomId: filterRoomId || undefined,
    dayOfWeek: filterDay || undefined
  });
  const { data: schedules, loading, error, reload } = useApi<ScheduleRow[]>(`/api/schedules${scheduleQuery}`, [
    scheduleQuery
  ]);

  const gradesForLevel = useMemo(
    () => levels?.find((l) => l.id === filterLevelId)?.grades ?? [],
    [levels, filterLevelId]
  );
  const subjectsForGrade = useMemo(
    () => (filterGradeId ? subjects?.filter((s) => s.academicGradeId === filterGradeId) ?? [] : subjects ?? []),
    [subjects, filterGradeId]
  );
  const groupsForFilters = useMemo(
    () =>
      groups?.filter(
        (g) =>
          (!filterLevelId || g.academicLevel?.id === filterLevelId) &&
          (!filterGradeId || g.academicGrade?.id === filterGradeId) &&
          (!filterSubjectId || g.subject?.id === filterSubjectId)
      ) ?? [],
    [groups, filterLevelId, filterGradeId, filterSubjectId]
  );

  function clearFilters() {
    setFilterLevelId("");
    setFilterGradeId("");
    setFilterSubjectId("");
    setFilterGroupId("");
    setFilterTeacherId("");
    setFilterRoomId("");
    setFilterDay("");
  }

  // -- Add slot form --
  const [groupId, setGroupId] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState<Day>("SUNDAY");
  const [startTime, setStartTime] = useState("16:00");
  const [endTime, setEndTime] = useState("17:30");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<{ type: string; conflictingGroup: string }[] | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setConflicts(null);
    setSubmitting(true);
    try {
      await apiPost("/api/schedules", { groupId, dayOfWeek, startTime, endTime });
      reload();
    } catch (err) {
      const details = (err as { details?: { conflicts?: { type: string; conflictingGroup: string }[] } })?.details;
      if (details?.conflicts) setConflicts(details.conflicts);
      setFormError(err instanceof Error ? err.message : t("schedule.conflictError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    await apiDelete(`/api/schedules/${id}`);
    reload();
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t("nav.schedule")} />

      <form onSubmit={handleSubmit} className="card mb-2 grid gap-3 p-4 sm:grid-cols-5">
        <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)} required>
          <option value="">{t("common.selectSubject")}</option>
          {groups?.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} — {g.subject?.name}
            </option>
          ))}
        </select>
        <select className="input" value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value as Day)}>
          {DAYS.map((d) => (
            <option key={d} value={d}>
              {t(DAY_KEYS[d] as Parameters<typeof t>[0])}
            </option>
          ))}
        </select>
        <input type="time" className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        <input type="time" className="input" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        <button type="submit" disabled={submitting || !groupId} className="btn-primary">
          {submitting ? t("schedule.checking") : t("schedule.addSlot")}
        </button>
      </form>

      {(formError || conflicts) && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          <p>{formError}</p>
          {conflicts && (
            <ul className="mt-1 list-inside list-disc">
              {conflicts.map((c, i) => (
                <li key={i}>
                  {c.type} conflict with group &quot;{c.conflictingGroup}&quot;
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Dynamic filters (spec item 8) */}
      <div className="card grid gap-3 p-4 sm:grid-cols-4 lg:grid-cols-7">
        <Field label={t("schedule.filterStage")}>
          {(id) => (
            <select
              id={id}
              className="input"
              value={filterLevelId}
              onChange={(e) => {
                setFilterLevelId(e.target.value);
                setFilterGradeId("");
                setFilterSubjectId("");
                setFilterGroupId("");
              }}
            >
              <option value="">{t("common.all")}</option>
              {levels?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("schedule.filterGrade")}>
          {(id) => (
            <select
              id={id}
              className="input"
              value={filterGradeId}
              onChange={(e) => {
                setFilterGradeId(e.target.value);
                setFilterSubjectId("");
                setFilterGroupId("");
              }}
              disabled={!filterLevelId}
            >
              <option value="">{t("common.all")}</option>
              {gradesForLevel.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("schedule.filterSubject")}>
          {(id) => (
            <select
              id={id}
              className="input"
              value={filterSubjectId}
              onChange={(e) => {
                setFilterSubjectId(e.target.value);
                setFilterGroupId("");
              }}
            >
              <option value="">{t("common.all")}</option>
              {subjectsForGrade.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("schedule.filterGroup")}>
          {(id) => (
            <select id={id} className="input" value={filterGroupId} onChange={(e) => setFilterGroupId(e.target.value)}>
              <option value="">{t("common.all")}</option>
              {groupsForFilters.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("schedule.filterTeacher")}>
          {(id) => (
            <select id={id} className="input" value={filterTeacherId} onChange={(e) => setFilterTeacherId(e.target.value)}>
              <option value="">{t("common.all")}</option>
              {teachersPage?.map((tch) => (
                <option key={tch.id} value={tch.id}>
                  {tch.fullName}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("schedule.filterRoom")}>
          {(id) => (
            <select id={id} className="input" value={filterRoomId} onChange={(e) => setFilterRoomId(e.target.value)}>
              <option value="">{t("common.all")}</option>
              {rooms?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("schedule.filterDay")}>
          {(id) => (
            <select id={id} className="input" value={filterDay} onChange={(e) => setFilterDay(e.target.value)}>
              <option value="">{t("common.all")}</option>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {t(DAY_KEYS[d] as Parameters<typeof t>[0])}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="sm:col-span-4 lg:col-span-7">
          <button type="button" className="text-xs hover:underline" onClick={clearFilters}>
            {t("schedule.clearFilters")}
          </button>
        </div>
      </div>

      <ErrorNotice message={error} />

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-start text-sm">
          <thead className="border-b border-black/5 text-black/60 dark:border-white/10 dark:text-white/60">
            <tr>
              <th className="p-3 text-start">{t("common.day")}</th>
              <th className="p-3 text-start">{t("common.time")}</th>
              <th className="p-3 text-start">{t("common.subject")}</th>
              <th className="p-3 text-start">{t("common.stage")}</th>
              <th className="p-3 text-start">{t("common.grade")}</th>
              <th className="p-3 text-start">{t("groups.title")}</th>
              <th className="p-3 text-start">{t("common.teacher")}</th>
              <th className="p-3 text-start">{t("common.room")}</th>
              <th className="p-3 text-start">{t("schedule.studentsCount")}</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-black/5 dark:border-white/5">
                  <td className="p-3" colSpan={10}>
                    <span className="block h-4 w-full animate-pulse rounded bg-black/10 dark:bg-white/10" />
                  </td>
                </tr>
              ))}

            {!loading && (schedules?.length ?? 0) === 0 && (
              <tr>
                <td className="p-6 text-center text-black/50 dark:text-white/50" colSpan={10}>
                  {t("schedule.noSlots")}
                </td>
              </tr>
            )}

            {!loading &&
              schedules?.map((s) => (
                <tr key={s.id} className="border-b border-black/5 dark:border-white/5">
                  <td className="p-3">{t(DAY_KEYS[s.dayOfWeek] as Parameters<typeof t>[0])}</td>
                  <td className="p-3">
                    {s.startTime}–{s.endTime}
                  </td>
                  <td className="p-3 font-medium">{s.subject?.name ?? "—"}</td>
                  <td className="p-3">{s.academicLevel?.name ?? "—"}</td>
                  <td className="p-3">{s.academicGrade?.name ?? "—"}</td>
                  <td className="p-3">{s.group?.name ?? "—"}</td>
                  <td className="p-3">{s.teacher?.fullName ?? "—"}</td>
                  <td className="p-3">{s.room?.name ?? "—"}</td>
                  <td className="p-3">
                    {s.group ? (
                      <Badge tone={s.room && s.group.studentCount > s.room.capacity ? "danger" : "neutral"}>
                        {s.group.studentCount}
                        {s.room ? ` / ${s.room.capacity}` : ""}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="text-xs text-red-600 hover:underline dark:text-red-400"
                    >
                      {t("common.remove")}
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
