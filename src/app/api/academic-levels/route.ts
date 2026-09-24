import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthContext, requirePermission, ForbiddenError, UnauthorizedError } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { BusinessRuleError, created, handleApiError, ok, readJson } from "@/lib/api";

const SCOPE = "academic-levels";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  order: z.number().int().min(0).max(999).default(0),
  grades: z.array(z.string().trim().min(1).max(100)).max(30).default([])
});

// Stage/Grade is the root of the Stage → Grade → Subject → Group chain
// (Phase 2, spec item 1–2), so every screen that builds a Subject or
// Group form — not just the Levels admin screen itself — needs to read
// this list to populate its cascading selects. Reading (GET) is
// therefore allowed to anyone who can manage any part of that chain;
// only creating/editing a Stage itself stays behind the narrower
// `academic.levels.manage` permission.
const READ_PERMISSIONS = [
  "academic.levels.manage",
  "academic.subjects.manage",
  "academic.groups.manage",
  "academic.rooms.manage",
  "academic.schedule.manage"
];

export async function GET() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) throw new UnauthorizedError();
    if (!READ_PERMISSIONS.some((key) => ctx.permissions.has(key))) throw new ForbiddenError();

    const levels = await db.academicLevel.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      include: {
        grades: { orderBy: { order: "asc" } },
        _count: { select: { students: true, groups: true } }
      }
    });
    return ok(levels);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("academic.levels.manage");
    const input = await readJson(request, createSchema);

    const existing = await db.academicLevel.findFirst({
      where: { organizationId: ctx.organizationId, name: input.name }
    });
    if (existing) throw new BusinessRuleError("This level already exists.", { status: 409 });

    const level = await db.academicLevel.create({
      data: {
        organizationId: ctx.organizationId,
        name: input.name,
        order: input.order,
        grades: {
          create: input.grades.map((name, index) => ({ name, order: index }))
        }
      },
      include: { grades: true }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_ACADEMIC_LEVEL",
      entityType: "AcademicLevel",
      entityId: level.id,
      afterValue: { name: level.name, grades: level.grades.map((g) => g.name) }
    });

    return created(level);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
