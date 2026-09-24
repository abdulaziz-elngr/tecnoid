import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope, ForbiddenError, UnauthorizedError } from "@/lib/rbac";
import { generateStudentCode, buildQrPayload } from "@/lib/student-code";
import { writeAuditLog } from "@/lib/audit";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  branchId: z.string().uuid().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "GRADUATED"]).optional()
});

const createStudentSchema = z.object({
  branchId: z.string().uuid(),
  fullName: z.string().trim().min(2).max(200),
  gender: z.enum(["MALE", "FEMALE"]),
  dateOfBirth: z.string().datetime().optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(500).optional(),
  school: z.string().trim().max(200).optional(),
  academicLevelId: z.string().uuid().optional(),
  notes: z.string().trim().max(2000).optional(),
  emergencyContact: z.string().trim().max(200).optional()
});

function handleKnownErrors(err: unknown) {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  console.error("[students] internal error", err);
  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 }
  );
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("students.view");

    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
    }
    const { page, pageSize, search, branchId, status } = parsed.data;

    const branchIds = resolveBranchScope(ctx, branchId);

    const where = {
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: "insensitive" as const } },
              { studentCode: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search } }
            ]
          }
        : {})
    };

    const [total, students] = await Promise.all([
      db.student.count({ where }),
      db.student.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          studentCode: true,
          fullName: true,
          photoUrl: true,
          gender: true,
          status: true,
          phone: true,
          enrollmentDate: true,
          branch: { select: { id: true, name: true } },
          academicLevel: { select: { id: true, name: true } }
        }
      })
    ]);

    return NextResponse.json({
      data: students,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    });
  } catch (err) {
    return handleKnownErrors(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("students.create");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const parsed = createStudentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid student data.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const input = parsed.data;

    // Verify the target branch belongs to this org AND this user's scope
    // — never trust branchId from the client beyond that verification.
    resolveBranchScope(ctx, input.branchId);
    const branch = await db.branch.findFirst({
      where: { id: input.branchId, deletedAt: null, center: { organizationId: ctx.organizationId } }
    });
    if (!branch) {
      return NextResponse.json({ error: "Invalid branch." }, { status: 400 });
    }

    const studentCode = await generateStudentCode();
    const qrCode = buildQrPayload(studentCode);

    const student = await db.student.create({
      data: {
        organizationId: ctx.organizationId,
        branchId: input.branchId,
        studentCode,
        qrCode,
        fullName: input.fullName,
        gender: input.gender,
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : undefined,
        phone: input.phone,
        address: input.address,
        school: input.school,
        academicLevelId: input.academicLevelId,
        notes: input.notes,
        emergencyContact: input.emergencyContact
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_STUDENT",
      entityType: "Student",
      entityId: student.id,
      afterValue: student
    });

    return NextResponse.json({ data: student }, { status: 201 });
  } catch (err) {
    return handleKnownErrors(err);
  }
}
