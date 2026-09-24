import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { BusinessRuleError, NotFoundError, handleApiError, ok, readJson } from "@/lib/api";
import { getRoomCapacityDetail } from "@/lib/capacity";

const SCOPE = "rooms.detail";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  number: z.string().trim().max(30).nullable().optional(),
  capacity: z.number().int().min(1).max(1000).optional(),
  isActive: z.boolean().optional()
});

async function loadRoom(organizationId: string, id: string) {
  const room = await db.room.findFirst({
    where: { id, deletedAt: null, branch: { center: { organizationId } } },
    include: {
      groups: {
        where: { deletedAt: null },
        select: { id: true, name: true, capacity: true, _count: { select: { groupStudents: true } } }
      }
    }
  });
  if (!room) throw new NotFoundError("Room not found.");
  return room;
}

/**
 * Classroom details (spec item 6): name, address/location (via branch),
 * capacity, real current student count, available seats, assigned
 * groups, and capacity status — all computed from real database counts,
 * never hard-coded.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.rooms.manage");
    const room = await loadRoom(ctx.organizationId, params.id);
    resolveBranchScope(ctx, room.branchId);
    const detail = await getRoomCapacityDetail(params.id);
    if (!detail) throw new NotFoundError("Room not found.");
    return ok(detail);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.rooms.manage");
    const room = await loadRoom(ctx.organizationId, params.id);
    resolveBranchScope(ctx, room.branchId);
    const input = await readJson(request, updateSchema);

    // Rule 9 — a room may never be shrunk below the largest group already
    // assigned to it. Checked against BOTH the declared `capacity` field
    // (planning target) and the real enrolled headcount (spec item 5) —
    // whichever is larger is what would actually overflow the room. The
    // database trigger `enforce_room_capacity_shrink` (Phase 2 migration)
    // additionally guards the real-headcount case at the DB level.
    if (input.capacity !== undefined) {
      const largestDeclared = room.groups.reduce((max, g) => Math.max(max, g.capacity), 0);
      const largestEnrolled = room.groups.reduce((max, g) => Math.max(max, g._count.groupStudents), 0);
      const largest = Math.max(largestDeclared, largestEnrolled);
      if (input.capacity < largest) {
        throw new BusinessRuleError(
          `Capacity cannot be lower than the largest group assigned to this room (${largest} students).`
        );
      }
    }

    const updated = await db.room.update({ where: { id: room.id }, data: input });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPDATE_ROOM",
      entityType: "Room",
      entityId: room.id,
      beforeValue: { name: room.name, number: room.number, capacity: room.capacity, isActive: room.isActive },
      afterValue: {
        name: updated.name,
        number: updated.number,
        capacity: updated.capacity,
        isActive: updated.isActive
      }
    });

    return ok(updated);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.rooms.manage");
    const room = await loadRoom(ctx.organizationId, params.id);
    resolveBranchScope(ctx, room.branchId);

    if (room.groups.length > 0) {
      throw new BusinessRuleError(
        "This room is still assigned to active groups. Reassign them before removing it."
      );
    }

    // Soft delete only — history stays intact (§43).
    await db.room.update({ where: { id: room.id }, data: { deletedAt: new Date(), isActive: false } });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "DELETE_ROOM",
      entityType: "Room",
      entityId: room.id,
      beforeValue: { name: room.name, capacity: room.capacity }
    });

    return ok({ id: room.id, deleted: true });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
