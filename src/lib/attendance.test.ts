import { describe, it, expect } from "vitest";
import {
  evaluateAttendance,
  attendanceRate,
  normalizeScanInput,
  DEFAULT_MAKEUP_RULES,
  type AttendanceFacts,
  type MakeUpRules
} from "./attendance";

function baseFacts(overrides: Partial<AttendanceFacts> = {}): AttendanceFacts {
  return {
    enrolledGroupIds: ["group-1"],
    primaryGroupIdForSubject: "group-1",
    sessionGroupId: "group-1",
    sessionSubjectId: "subject-1",
    sessionAcademicLevelId: "level-1",
    primarySubjectId: "subject-1",
    studentAcademicLevelId: "level-1",
    groupCapacity: 20,
    currentAttendeeCount: 5,
    alreadyRecorded: false,
    makeUpsThisMonth: 0,
    daysSinceOriginSession: null,
    hasApproval: false,
    minutesAfterStart: 0,
    sessionStatus: "OPEN",
    studentStatus: "ACTIVE",
    ...overrides
  };
}

describe("evaluateAttendance — hard blockers", () => {
  it("denies duplicate attendance (Rule 1)", () => {
    const result = evaluateAttendance(baseFacts({ alreadyRecorded: true }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("DUPLICATE");
  });

  it("denies attendance for a cancelled session", () => {
    const result = evaluateAttendance(baseFacts({ sessionStatus: "CANCELLED" }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("SESSION_CANCELLED");
  });

  it("denies attendance for an already-closed session", () => {
    const result = evaluateAttendance(baseFacts({ sessionStatus: "COMPLETED" }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("SESSION_COMPLETED");
  });

  it("denies attendance for an inactive student", () => {
    const result = evaluateAttendance(baseFacts({ studentStatus: "SUSPENDED" }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("STUDENT_NOT_ACTIVE");
  });
});

describe("evaluateAttendance — enrolled (regular) path", () => {
  it("records REGULAR attendance within the late threshold", () => {
    const result = evaluateAttendance(baseFacts({ minutesAfterStart: 5 }));
    expect(result).toMatchObject({ allowed: true, type: "REGULAR", code: "OK_REGULAR", isMakeUp: false });
  });

  it("records LATE attendance past the late threshold", () => {
    const result = evaluateAttendance(baseFacts({ minutesAfterStart: 20 }));
    expect(result).toMatchObject({ allowed: true, type: "LATE", code: "OK_LATE" });
  });

  it("respects a custom late threshold from facts", () => {
    const result = evaluateAttendance(baseFacts({ minutesAfterStart: 10, lateThresholdMinutes: 5 }));
    expect(result.type).toBe("LATE");
  });

  it("is not late exactly at the threshold boundary", () => {
    const result = evaluateAttendance(baseFacts({ minutesAfterStart: 15 }));
    expect(result.type).toBe("REGULAR");
  });

  it("denies when the group is at capacity and capacity is enforced", () => {
    const result = evaluateAttendance(baseFacts({ currentAttendeeCount: 20, groupCapacity: 20 }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("CAPACITY_FULL");
  });

  it("allows over capacity when respectCapacity is disabled", () => {
    const rules: MakeUpRules = { ...DEFAULT_MAKEUP_RULES, respectCapacity: false };
    const result = evaluateAttendance(baseFacts({ currentAttendeeCount: 25, groupCapacity: 20 }), rules);
    expect(result.allowed).toBe(true);
  });
});

describe("evaluateAttendance — make-up path (Rule 2, Rule 3)", () => {
  function makeUpFacts(overrides: Partial<AttendanceFacts> = {}): AttendanceFacts {
    return baseFacts({
      enrolledGroupIds: ["other-group"],
      sessionGroupId: "makeup-group",
      makeUpsThisMonth: 1,
      daysSinceOriginSession: 3,
      ...overrides
    });
  }

  it("allows a valid make-up in the same subject and level", () => {
    const result = evaluateAttendance(makeUpFacts());
    expect(result).toMatchObject({ allowed: true, type: "MAKE_UP", code: "OK_MAKE_UP", isMakeUp: true });
  });

  it("denies when the subject does not match and requireSameSubject is set", () => {
    const result = evaluateAttendance(makeUpFacts({ sessionSubjectId: "other-subject" }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("NOT_ENROLLED_SUBJECT_MISMATCH");
  });

  it("denies when there is no primary group and requireSameSubject is disabled", () => {
    const rules: MakeUpRules = { ...DEFAULT_MAKEUP_RULES, requireSameSubject: false };
    const result = evaluateAttendance(makeUpFacts({ primaryGroupIdForSubject: null }), rules);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("NOT_ENROLLED_SUBJECT_MISMATCH");
  });

  it("denies when the academic level does not match", () => {
    const result = evaluateAttendance(makeUpFacts({ sessionAcademicLevelId: "other-level" }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("LEVEL_MISMATCH");
  });

  it("denies once the monthly make-up limit is reached", () => {
    const result = evaluateAttendance(makeUpFacts({ makeUpsThisMonth: 4 }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("MAKEUP_LIMIT_REACHED");
  });

  it("allows unlimited make-ups when maxMakeUpsPerMonth is 0", () => {
    const rules: MakeUpRules = { ...DEFAULT_MAKEUP_RULES, maxMakeUpsPerMonth: 0 };
    const result = evaluateAttendance(makeUpFacts({ makeUpsThisMonth: 50 }), rules);
    expect(result.allowed).toBe(true);
  });

  it("denies once the make-up window has expired", () => {
    const result = evaluateAttendance(makeUpFacts({ daysSinceOriginSession: 20 }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("MAKEUP_WINDOW_EXPIRED");
  });

  it("does not enforce the window when no origin session is known", () => {
    const result = evaluateAttendance(makeUpFacts({ daysSinceOriginSession: null }));
    expect(result.allowed).toBe(true);
  });

  it("requires approval when the rule demands it", () => {
    const rules: MakeUpRules = { ...DEFAULT_MAKEUP_RULES, requireApproval: true };
    const denied = evaluateAttendance(makeUpFacts({ hasApproval: false }), rules);
    expect(denied.allowed).toBe(false);
    expect(denied.code).toBe("APPROVAL_REQUIRED");

    const approved = evaluateAttendance(makeUpFacts({ hasApproval: true }), rules);
    expect(approved.allowed).toBe(true);
  });
});

describe("attendanceRate", () => {
  it("returns 0 for zero total sessions", () => {
    expect(attendanceRate(0, 0)).toBe(0);
  });

  it("computes a rounded percentage to one decimal place", () => {
    expect(attendanceRate(2, 3)).toBe(66.7);
  });

  it("returns 100 when every session was present", () => {
    expect(attendanceRate(10, 10)).toBe(100);
  });
});

describe("normalizeScanInput", () => {
  it("trims whitespace and uppercases the payload", () => {
    expect(normalizeScanInput("  abc123  ")).toBe("ABC123");
  });

  it("strips internal whitespace introduced by scanner noise", () => {
    expect(normalizeScanInput("ab c 123")).toBe("ABC123");
  });
});
