import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope, ForbiddenError, UnauthorizedError } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { assertGradeBelongsToLevel, assertStageExists, assertSubjectBelongsToGrade } from "@/lib/academic";
import { evaluateCapacity } from "@/lib/capacity";
import { BusinessRuleError } from "@/lib/api";

const listQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  academicLevelId: z.string().uuid().optional(),
  academicGradeId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  roomId: z.string().uuid().optional()
});

// academicGradeId is required for every new group going forward (the
// database column stays nullable to tolerate groups created before
// Phase 2 — see the migration notes). Stage stays required as it already
// was pre-Phase-2.
const createGroupSchema = z.object({
  branchId: z.string().uuid(),
  subjectId: z.string().uuid(),
  academicLevelId: z.string().uuid({ message: "Select a stage." }),
  academicGradeId: z.string().uuid({ message: "Select a grade." }),
  roomId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  assistantId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(100),
  capacity: z.number().int().min(1).max(500)
});

function handleKnownErrors(err: unknown) {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof BusinessRuleError) {
    return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status: err.status });
  }
  console.error("[groups] internal error", err);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

const GROUP_INCLUDE = {
  subject: { select: { id: true, name: true } },
  academicLevel: { select: { id: true, name: true } },
  academicGrade: { select: { id: true, name: true } },
  room: { select: { id: true, name: true, capacity: true } },
  teacher: { select: { id: true, fullName: true } },
  assistant: { select: { id: true, fullName: true } },
  _count: { select: { groupStudents: true, schedules: true } }
} as const;

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("academic.groups.manage");
    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
    }
    const branchIds = resolveBranchScope(ctx, parsed.data.branchId);

    const groups = await db.group.findMany({
      where: {
        deletedAt: null,
        branch: { center: { organizationId: ctx.organizationId } },
        ...(branchIds ? { branchId: { in: branchIds } } : {}),
        ...(parsed.data.subjectId ? { subjectId: parsed.data.subjectId } : {}),
        ...(parsed.data.academicLevelId ? { academicLevelId: parsed.data.academicLevelId } : {}),
        ...(parsed.data.academicGradeId ? { academicGradeId: parsed.data.academicGradeId } : {}),
        ...(parsed.data.teacherId ? { teacherId: parsed.data.teacherId } : {}),
        ...(parsed.data.roomId ? { roomId: parsed.data.roomId } : {})
      },
      orderBy: { name: "asc" },
      include: GROUP_INCLUDE
    });

    const data = groups.map((g) => ({
      ...g,
      studentCount: g._count.groupStudents,
      capacityStatus: evaluateCapacity(g._count.groupStudents, g.room?.capacity ?? null)
    }));

    return NextResponse.json({ data });
  } catch (err) {
    return handleKnownErrors(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("academic.groups.manage");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const parsed = createGroupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid group data.", details: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;

    resolveBranchScope(ctx, input.branchId);
    const branch = await db.branch.findFirst({
      where: { id: input.branchId, deletedAt: null, center: { organizationId: ctx.organizationId } }
    });
    if (!branch) {
      return NextResponse.json({ error: "Invalid branch." }, { status: 400 });
    }

    // Stage → Grade → Subject chain, each link validated against the org
    // and against its parent (spec items 1–3): a Grade that does not
    // belong to the chosen Stage, or a Subject that does not belong to
    // the chosen Grade, is rejected here — and, as a backstop, by the
    // database triggers even if this check were ever bypassed.
    await assertStageExists(ctx.organizationId, input.academicLevelId);
    await assertGradeBelongsToLevel(ctx.organizationId, input.academicLevelId, input.academicGradeId);
    await assertSubjectBelongsToGrade(ctx.organizationId, input.subjectId, input.academicGradeId);

    // Rule 9 (pre-existing): declared group capacity cannot exceed the
    // room's capacity. Real enrolled headcount is separately enforced
    // once students are actually added (see /api/groups/[id]/students).
    if (input.roomId) {
      const room = await db.room.findFirst({
        where: { id: input.roomId, branchId: input.branchId, deletedAt: null }
      });
      if (!room) {
        return NextResponse.json({ error: "Invalid room for this branch." }, { status: 400 });
      }
      if (input.capacity > room.capacity) {
        return NextResponse.json(
          { error: `Group capacity (${input.capacity}) exceeds classroom capacity (${room.capacity}).` },
          { status: 400 }
        );
      }
    }

    if (input.teacherId) {
      const teacher = await db.teacher.findFirst({
        where: { id: input.teacherId, branchId: input.branchId, deletedAt: null }
      });
      if (!teacher) return NextResponse.json({ error: "Invalid teacher for this branch." }, { status: 400 });
    }
    if (input.assistantId) {
      const assistant = await db.teacher.findFirst({
        where: { id: input.assistantId, branchId: input.branchId, deletedAt: null }
      });
      if (!assistant) return NextResponse.json({ error: "Invalid assistant for this branch." }, { status: 400 });
    }

    const group = await db.group.create({
      data: {
        branchId: input.branchId,
        subjectId: input.subjectId,
        academicLevelId: input.academicLevelId,
        academicGradeId: input.academicGradeId,
        roomId: input.roomId,
        teacherId: input.teacherId,
        assistantId: input.assistantId,
        name: input.name,
        capacity: input.capacity
      },
      include: GROUP_INCLUDE
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_GROUP",
      entityType: "Group",
      entityId: group.id,
      afterValue: group
    });

    return NextResponse.json({ data: group }, { status: 201 });
  } catch (err) {
    return handleKnownErrors(err);
  }
}
