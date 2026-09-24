import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok, created, readJson, readQuery, paginationSchema, BusinessRuleError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

const listSchema = paginationSchema.extend({
  branchId: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
  active: z.enum(["true", "false"]).optional()
});

const createSchema = z.object({
  branchId: z.string().uuid(),
  fullName: z.string().trim().min(2).max(200),
  phone: z.string().trim().max(30).optional(),
  position: z.string().trim().max(100).optional(),
  hireDate: z.string().datetime().optional(),
  photoUrl: z.string().url().max(500).optional()
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("employees.view");
    const query = readQuery(request, listSchema);
    const branchIds = resolveBranchScope(ctx, query.branchId);

    const where = {
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
      ...(query.active ? { isActive: query.active === "true" } : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: "insensitive" as const } },
              { phone: { contains: query.search } }
            ]
          }
        : {})
    };

    const [total, rows] = await Promise.all([
      db.employee.count({ where }),
      db.employee.findMany({
        where,
        orderBy: { fullName: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          fullName: true,
          phone: true,
          position: true,
          hireDate: true,
          photoUrl: true,
          isActive: true,
          branch: { select: { id: true, name: true } }
        }
      })
    ]);

    // Salary data is intentionally NOT selected here — it is only
    // exposed to roles holding `employees.update` on the detail route.
    return ok({
      employees: rows,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize))
      }
    });
  } catch (err) {
    return handleApiError("employees.list", err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("employees.create");
    const input = await readJson(request, createSchema);
    resolveBranchScope(ctx, input.branchId);

    const branch = await db.branch.findFirst({
      where: { id: input.branchId, deletedAt: null, center: { organizationId: ctx.organizationId } }
    });
    if (!branch) throw new BusinessRuleError("Invalid branch.", { status: 400 });

    const employee = await db.employee.create({
      data: {
        organizationId: ctx.organizationId,
        branchId: input.branchId,
        fullName: input.fullName,
        phone: input.phone,
        position: input.position,
        photoUrl: input.photoUrl,
        hireDate: input.hireDate ? new Date(input.hireDate) : undefined
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_EMPLOYEE",
      entityType: "Employee",
      entityId: employee.id,
      afterValue: employee
    });

    return created(employee);
  } catch (err) {
    return handleApiError("employees.create", err);
  }
}
