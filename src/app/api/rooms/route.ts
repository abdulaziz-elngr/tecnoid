import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { badRequest, created, handleApiError, ok, readJson, readQuery } from "@/lib/api";

const SCOPE = "rooms";

const listSchema = z.object({ branchId: z.string().uuid().optional() });

const createSchema = z.object({
  branchId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  number: z.string().trim().max(30).optional(),
  capacity: z.number().int().min(1).max(1000),
  isActive: z.boolean().default(true)
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("academic.rooms.manage");
    const query = readQuery(request, listSchema);
    const branchIds = resolveBranchScope(ctx, query.branchId);

    const rooms = await db.room.findMany({
      where: {
        deletedAt: null,
        branch: { center: { organizationId: ctx.organizationId } },
        ...(branchIds ? { branchId: { in: branchIds } } : {})
      },
      orderBy: [{ branchId: "asc" }, { name: "asc" }],
      include: {
        branch: { select: { id: true, name: true } },
        _count: { select: { groups: true } }
      }
    });

    return ok(rooms);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("academic.rooms.manage");
    const input = await readJson(request, createSchema);
    resolveBranchScope(ctx, input.branchId);

    const branch = await db.branch.findFirst({
      where: { id: input.branchId, deletedAt: null, center: { organizationId: ctx.organizationId } }
    });
    if (!branch) return badRequest("Invalid branch.");

    const room = await db.room.create({
      data: {
        branchId: input.branchId,
        name: input.name,
        number: input.number,
        capacity: input.capacity,
        isActive: input.isActive
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_ROOM",
      entityType: "Room",
      entityId: room.id,
      afterValue: room
    });

    return created(room);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
