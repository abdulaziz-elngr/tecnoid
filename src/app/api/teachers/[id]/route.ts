import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, ForbiddenError, UnauthorizedError } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";

const updateTeacherSchema = z.object({
  fullName: z.string().trim().min(2).max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(200).optional(),
  isActive: z.boolean().optional()
});

function handleKnownErrors(err: unknown) {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  console.error("[teachers/:id] internal error", err);
  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 }
  );
}

async function findScopedTeacher(organizationId: string, branchIds: string[] | undefined, id: string) {
  return db.teacher.findFirst({
    where: {
      id,
      organizationId,
      deletedAt: null,
      ...(branchIds ? { branchId: { in: branchIds } } : {})
    },
    include: {
      branch: { select: { id: true, name: true } },
      groupsAsTeacher: { select: { id: true, name: true, subject: { select: { name: true } } } },
      groupsAsAssistant: { select: { id: true, name: true, subject: { select: { name: true } } } }
    }
  });
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("teachers.view");
    const branchIds = ctx.isOrgWide ? undefined : ctx.branchIds;
    const teacher = await findScopedTeacher(ctx.organizationId, branchIds, params.id);
    if (!teacher) {
      return NextResponse.json({ error: "Teacher not found." }, { status: 404 });
    }
    return NextResponse.json({ data: teacher });
  } catch (err) {
    return handleKnownErrors(err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("teachers.update");
    const branchIds = ctx.isOrgWide ? undefined : ctx.branchIds;
    const existing = await findScopedTeacher(ctx.organizationId, branchIds, params.id);
    if (!existing) {
      return NextResponse.json({ error: "Teacher not found." }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const parsed = updateTeacherSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid teacher data.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const updated = await db.teacher.update({ where: { id: existing.id }, data: parsed.data });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPDATE_TEACHER",
      entityType: "Teacher",
      entityId: updated.id,
      beforeValue: existing,
      afterValue: updated
    });

    return NextResponse.json({ data: updated });
  } catch (err) {
    return handleKnownErrors(err);
  }
}
