/**
 * Attendance business rules (spec §14, §17, §61).
 *
 * The decision logic is a PURE function so it can be unit-tested
 * exhaustively without a database. `src/app/api/attendance/scan/route.ts`
 * loads the facts from Postgres, hands them to `evaluateAttendance()`,
 * and only writes a row when the decision is `allowed`.
 *
 * Rules enforced here:
 *   Rule 1  A student cannot have duplicate attendance for one session.
 *   Rule 2  A student cannot attend an unauthorized group.
 *   Rule 3  Make-up attendance must follow the configured rules.
 *   Rule 9  Room/group capacity cannot be exceeded.
 */

export type AttendanceTypeValue = "REGULAR" | "MAKE_UP" | "LATE" | "EXCUSED" | "ABSENT";

export interface MakeUpRules {
  /** The make-up group must teach the same subject as the student's primary group. */
  requireSameSubject: boolean;
  /** The make-up group must target the same academic level as the student. */
  requireSameLevel: boolean;
  /** Refuse if the session already has as many attendees as the group capacity. */
  respectCapacity: boolean;
  /** Maximum make-up sessions a student may take within the calendar month. 0 = unlimited. */
  maxMakeUpsPerMonth: number;
  /** Make-up must happen within N days of the missed session. 0 = no limit. */
  maxDaysAfterOrigin: number;
  /** Require an explicit administrator approval before recording a make-up. */
  requireApproval: boolean;
}

export const DEFAULT_MAKEUP_RULES: MakeUpRules = {
  requireSameSubject: true,
  requireSameLevel: true,
  respectCapacity: true,
  maxMakeUpsPerMonth: 4,
  maxDaysAfterOrigin: 14,
  requireApproval: false
};

/** Minutes after the session start time after which a student is marked LATE. */
export const DEFAULT_LATE_THRESHOLD_MINUTES = 15;

export interface AttendanceFacts {
  /** Group ids the student is enrolled in (any subject). */
  enrolledGroupIds: string[];
  /** The student's primary group for the subject of the scanned session, if any. */
  primaryGroupIdForSubject: string | null;
  /** The group the scanned session belongs to. */
  sessionGroupId: string;
  sessionSubjectId: string;
  sessionAcademicLevelId: string;
  /** Subject of the student's primary group (null if none). */
  primarySubjectId: string | null;
  studentAcademicLevelId: string | null;
  groupCapacity: number;
  currentAttendeeCount: number;
  /** Already-recorded attendance for this exact session (Rule 1). */
  alreadyRecorded: boolean;
  /** Number of MAKE_UP rows the student already has this calendar month. */
  makeUpsThisMonth: number;
  /** Days between the missed session and this one, if an origin session is known. */
  daysSinceOriginSession: number | null;
  /** True when an operator with `attendance.makeup.approve` authorised this scan. */
  hasApproval: boolean;
  /** Minutes elapsed since the session's scheduled start (can be negative). */
  minutesAfterStart: number;
  sessionStatus: "SCHEDULED" | "OPEN" | "COMPLETED" | "CANCELLED";
  studentStatus: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "GRADUATED";
  lateThresholdMinutes?: number;
}

export type AttendanceDecisionCode =
  | "OK_REGULAR"
  | "OK_LATE"
  | "OK_MAKE_UP"
  | "DUPLICATE"
  | "SESSION_CANCELLED"
  | "SESSION_COMPLETED"
  | "STUDENT_NOT_ACTIVE"
  | "NOT_ENROLLED_SUBJECT_MISMATCH"
  | "LEVEL_MISMATCH"
  | "CAPACITY_FULL"
  | "MAKEUP_LIMIT_REACHED"
  | "MAKEUP_WINDOW_EXPIRED"
  | "APPROVAL_REQUIRED";

export interface AttendanceDecision {
  allowed: boolean;
  type: AttendanceTypeValue | null;
  code: AttendanceDecisionCode;
  /** Machine-neutral English sentence; the UI maps `code` to a localized string. */
  message: string;
  isMakeUp: boolean;
}

export function evaluateAttendance(
  facts: AttendanceFacts,
  rules: MakeUpRules = DEFAULT_MAKEUP_RULES
): AttendanceDecision {
  const lateThreshold = facts.lateThresholdMinutes ?? DEFAULT_LATE_THRESHOLD_MINUTES;

  // --- Hard blockers, checked before anything else ---
  if (facts.alreadyRecorded) {
    return deny("DUPLICATE", "Attendance for this student in this session is already recorded.");
  }
  if (facts.sessionStatus === "CANCELLED") {
    return deny("SESSION_CANCELLED", "This session has been cancelled.");
  }
  if (facts.sessionStatus === "COMPLETED") {
    return deny("SESSION_COMPLETED", "This session is already closed for attendance.");
  }
  if (facts.studentStatus !== "ACTIVE") {
    return deny("STUDENT_NOT_ACTIVE", "This student account is not active.");
  }

  const isEnrolledInSessionGroup = facts.enrolledGroupIds.includes(facts.sessionGroupId);

  // --- Path A: the student belongs to this group. Normal attendance. ---
  if (isEnrolledInSessionGroup) {
    if (rules.respectCapacity && facts.currentAttendeeCount >= facts.groupCapacity) {
      return deny("CAPACITY_FULL", "This session has reached its capacity.");
    }
    const late = facts.minutesAfterStart > lateThreshold;
    return {
      allowed: true,
      type: late ? "LATE" : "REGULAR",
      code: late ? "OK_LATE" : "OK_REGULAR",
      message: late ? "Attendance recorded (late)." : "Attendance recorded.",
      isMakeUp: false
    };
  }

  // --- Path B: make-up attendance in a group the student is not enrolled in ---
  // Rule 2: never a free-for-all — every rule below must pass.
  if (rules.requireSameSubject) {
    if (!facts.primarySubjectId || facts.primarySubjectId !== facts.sessionSubjectId) {
      return deny(
        "NOT_ENROLLED_SUBJECT_MISMATCH",
        "This student is not enrolled in this group, and it does not match their subject."
      );
    }
  } else if (!facts.primaryGroupIdForSubject) {
    return deny(
      "NOT_ENROLLED_SUBJECT_MISMATCH",
      "This student has no primary group, so make-up attendance cannot be validated."
    );
  }

  if (
    rules.requireSameLevel &&
    facts.studentAcademicLevelId &&
    facts.studentAcademicLevelId !== facts.sessionAcademicLevelId
  ) {
    return deny("LEVEL_MISMATCH", "This group targets a different academic level.");
  }

  if (rules.respectCapacity && facts.currentAttendeeCount >= facts.groupCapacity) {
    return deny("CAPACITY_FULL", "This session has reached its capacity.");
  }

  if (rules.maxMakeUpsPerMonth > 0 && facts.makeUpsThisMonth >= rules.maxMakeUpsPerMonth) {
    return deny(
      "MAKEUP_LIMIT_REACHED",
      "This student has reached the allowed number of make-up sessions this month."
    );
  }

  if (
    rules.maxDaysAfterOrigin > 0 &&
    facts.daysSinceOriginSession !== null &&
    facts.daysSinceOriginSession > rules.maxDaysAfterOrigin
  ) {
    return deny(
      "MAKEUP_WINDOW_EXPIRED",
      "The allowed make-up window for the missed session has expired."
    );
  }

  if (rules.requireApproval && !facts.hasApproval) {
    return deny("APPROVAL_REQUIRED", "Administrator approval is required for this make-up session.");
  }

  return {
    allowed: true,
    type: "MAKE_UP",
    code: "OK_MAKE_UP",
    message: "Make-up attendance recorded.",
    isMakeUp: true
  };
}

function deny(code: AttendanceDecisionCode, message: string): AttendanceDecision {
  return { allowed: false, type: null, code, message, isMakeUp: false };
}

/** Percentage helper used across attendance dashboards and student profiles. */
export function attendanceRate(present: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((present / total) * 1000) / 10;
}

/** Normalizes a scanned barcode/QR payload before lookup. */
export function normalizeScanInput(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toUpperCase();
}
