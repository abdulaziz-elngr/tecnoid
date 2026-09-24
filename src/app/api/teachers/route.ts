import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope, ForbiddenError, UnauthorizedError } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  branchId: z.string().uuid().optional(),
  isAssistant: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true"))
});

const createTeacherSchema = z.object({
  branchId: z.string().uuid(),
  fullName: z.string().trim().min(2).max(200),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(200).optional(),
  isAssistant: z.boolean().default(false)
});

function handleKnownErrors(err: unknown) {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  console.error("[teachers] internal error", err);
  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 }
  );
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("teachers.view");
    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
    }
    const { page, pageSize, search, branchId, isAssistant } = parsed.data;
    const branchIds = resolveBranchScope(ctx, branchId);

    const where = {
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
      ...(isAssistant !== undefined ? { isAssistant } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search } },
              { email: { contains: search, mode: "insensitive" as const } }
            ]
          }
        : {})
    };

    const [total, teachers] = await Promise.all([
      db.teacher.count({ where }),
      db.teacher.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          fullName: true,
          photoUrl: true,
          phone: true,
          email: true,
          isAssistant: true,
          isActive: true,
          branch: { select: { id: true, name: true } },
          _count: { select: { groupsAsTeacher: true, groupsAsAssistant: true } }
        }
      })
    ]);

    return NextResponse.json({
      data: teachers,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    });
  } catch (err) {
    return handleKnownErrors(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("teachers.create");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const parsed = createTeacherSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid teacher data.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const input = parsed.data;

    resolveBranchScope(ctx, input.branchId);
    const branch = await db.branch.findFirst({
      where: { id: input.branchId, deletedAt: null, center: { organizationId: ctx.organizationId } }
    });
    if (!branch) {
      return NextResponse.json({ error: "Invalid branch." }, { status: 400 });
    }

    const teacher = await db.teacher.create({
      data: {
        organizationId: ctx.organizationId,
        branchId: input.branchId,
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        isAssistant: input.isAssistant
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: input.isAssistant ? "CREATE_TEACHER_ASSISTANT" : "CREATE_TEACHER",
      entityType: "Teacher",
      entityId: teacher.id,
      afterValue: teacher
    });

    return NextResponse.json({ data: teacher }, { status: 201 });
  } catch (err) {
    return handleKnownErrors(err);
  }
}
