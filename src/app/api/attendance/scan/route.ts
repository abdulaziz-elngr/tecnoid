import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok, readJson, clientIp, userAgent, BusinessRuleError } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { evaluateAttendance, normalizeScanInput, type AttendanceFacts } from "@/lib/attendance";
import { minutesAfterStart } from "@/lib/sessions";
import { getLateThresholdMinutes, getMakeUpRules } from "@/lib/settings";
import { writeAuditLog } from "@/lib/audit";
import { dispatchEvent } from "@/lib/notifications";

/**
 * POST /api/attendance/scan — the barcode/QR attendance flow (spec §17).
 *
 *   Scan → find student → validate student → validate session/group →
 *   duplicate check → make-up eligibility → record → respond.
 *
 * Designed to be fast: one indexed student lookup by qrCode/studentCode,
 * one session lookup, three cheap counts, one insert. Everything the UI
 * needs to render the confirmation card comes back in this single call
 * so the operator never waits for a second round-trip.
 */

const scanSchema = z.object({
  code: z.string().trim().min(3).max(100),
  sessionId: z.string().uuid(),
  /** Set by the operator when authorising a make-up in the UI. */
  makeUpReason: z.string().trim().max(300).optional(),
  originSessionId: z.string().uuid().optional(),
  deviceInfo: z.string().trim().max(200).optional()
});

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("attendance.create");

    // Rate limit per operator: a scanner gun can fire fast, but not
    // thousands per minute — that would be a script, not a queue of kids.
    const limit = checkRateLimit(`scan:${ctx.userId}`, 240, 60 * 1000);
    if (!limit.allowed) {
      throw new BusinessRuleError("Too many scans. Please slow down.", {
        status: 429,
        code: "RATE_LIMITED"
      });
    }

    const input = await readJson(request, scanSchema);
    const code = normalizeScanInput(input.code);

    const session = await db.classSession.findFirst({
      where: {
        id: input.sessionId,
        organizationId: ctx.organizationId,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            capacity: true,
            subjectId: true,
            academicLevelId: true,
            subject: { select: { name: true } },
            room: { select: { name: true } }
          }
        }
      }
    });
    if (!session) {
      return ok(
        {
          status: "REJECTED",
          code: "SESSION_NOT_FOUND",
          message: "Session not found or outside your branch scope."
        },
        { status: 404 }
      );
    }
    resolveBranchScope(ctx, session.branchId);

    const student = await db.student.findFirst({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        OR: [{ qrCode: code }, { studentCode: code }]
      },
      select: {
        id: true,
        fullName: true,
        studentCode: true,
        photoUrl: true,
        status: true,
        branchId: true,
        academicLevelId: true,
        groupStudents: {
          select: { groupId: true, isPrimary: true, group: { select: { subjectId: true } } }
        }
      }
    });

    if (!student) {
      return ok(
        { status: "REJECTED", code: "STUDENT_NOT_FOUND", message: "No student matches this code." },
        { status: 404 }
      );
    }

    // A student from another branch cannot be scanned into this branch's
    // session by an operator who has no access to that student.
    resolveBranchScope(ctx, student.branchId);

    const [existing, attendeeCount, monthStart] = [
      await db.attendance.findFirst({
        where: { sessionId: session.id, studentId: student.id, deletedAt: null },
        select: { id: true, type: true, recordedAt: true }
      }),
      await db.attendance.count({ where: { sessionId: session.id, deletedAt: null } }),
      new Date(Date.UTC(session.date.getUTCFullYear(), session.date.getUTCMonth(), 1))
    ];

    const makeUpsThisMonth = await db.attendance.count({
      where: {
        studentId: student.id,
        type: "MAKE_UP",
        deletedAt: null,
        recordedAt: { gte: monthStart }
      }
    });

    let daysSinceOrigin: number | null = null;
    if (input.originSessionId) {
      const origin = await db.classSession.findFirst({
        where: { id: input.originSessionId, organizationId: ctx.organizationId },
        select: { date: true }
      });
      if (origin) {
        daysSinceOrigin = Math.round(
          (session.date.getTime() - origin.date.getTime()) / 86400000
        );
      }
    }

    const primaryLink = student.groupStudents.find(
      (gs) => gs.isPrimary && gs.group.subjectId === session.group.subjectId
    );

    const [rules, lateThreshold] = await Promise.all([
      getMakeUpRules(ctx.organizationId),
      getLateThresholdMinutes(ctx.organizationId)
    ]);

    const facts: AttendanceFacts = {
      enrolledGroupIds: student.groupStudents.map((gs) => gs.groupId),
      primaryGroupIdForSubject: primaryLink?.groupId ?? null,
      sessionGroupId: session.group.id,
      sessionSubjectId: session.group.subjectId,
      sessionAcademicLevelId: session.group.academicLevelId,
      primarySubjectId: primaryLink?.group.subjectId ?? null,
      studentAcademicLevelId: student.academicLevelId,
      groupCapacity: session.group.capacity,
      currentAttendeeCount: attendeeCount,
      alreadyRecorded: Boolean(existing),
      makeUpsThisMonth,
      daysSinceOriginSession: daysSinceOrigin,
      hasApproval: ctx.permissions.has("attendance.makeup.approve") && Boolean(input.makeUpReason),
      minutesAfterStart: minutesAfterStart(session.date, session.startMinutes),
      sessionStatus: session.status,
      studentStatus: student.status,
      lateThresholdMinutes: lateThreshold
    };

    const decision = evaluateAttendance(facts, rules);

    const studentCard = {
      id: student.id,
      fullName: student.fullName,
      studentCode: student.studentCode,
      photoUrl: student.photoUrl
    };
    const sessionCard = {
      id: session.id,
      groupName: session.group.name,
      subjectName: session.group.subject.name,
      roomName: session.group.room?.name ?? null
    };

    if (!decision.allowed) {
      return ok({
        status: "REJECTED",
        code: decision.code,
        message: decision.message,
        student: studentCard,
        session: sessionCard,
        existingAttendance: existing
      });
    }

    const attendance = await db.attendance.create({
      data: {
        organizationId: ctx.organizationId,
        branchId: session.branchId,
        sessionId: session.id,
        studentId: student.id,
        groupId: session.group.id,
        type: decision.type!,
        operatorUserId: ctx.userId,
        deviceInfo: input.deviceInfo ?? userAgent(request)?.slice(0, 200),
        makeUpReason: decision.isMakeUp ? input.makeUpReason : undefined,
        makeUpApprovedBy: decision.isMakeUp ? ctx.userId : undefined,
        originSessionId: decision.isMakeUp ? input.originSessionId : undefined
      }
    });

    // Opening the session on the first scan saves the operator a click.
    if (session.status === "SCHEDULED") {
      await db.classSession.update({
        where: { id: session.id },
        data: { status: "OPEN", openedAt: new Date() }
      });
    }

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: decision.isMakeUp ? "RECORD_MAKEUP_ATTENDANCE" : "RECORD_ATTENDANCE",
      entityType: "Attendance",
      entityId: attendance.id,
      afterValue: attendance,
      reason: input.makeUpReason,
      ipAddress: clientIp(request)
    });

    if (decision.type === "LATE") {
      // Fire-and-forget: parent alerts must never slow the scanner down.
      void dispatchEvent({
        organizationId: ctx.organizationId,
        event: "STUDENT_LATE",
        studentId: student.id,
        title: "Late arrival",
        actorUserId: ctx.userId,
        variables: {
          student_name: student.fullName,
          subject_name: session.group.subject.name,
          date: session.date.toISOString().slice(0, 10),
          late_minutes: Math.max(0, facts.minutesAfterStart)
        }
      }).catch((err) => console.error("[attendance.scan] notify failed", err));
    }

    return ok({
      status: "ACCEPTED",
      code: decision.code,
      message: decision.message,
      attendance: {
        id: attendance.id,
        type: attendance.type,
        recordedAt: attendance.recordedAt
      },
      student: studentCard,
      session: sessionCard
    });
  } catch (err) {
    return handleApiError("attendance.scan", err);
  }
}
