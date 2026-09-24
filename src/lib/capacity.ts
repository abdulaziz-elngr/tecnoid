import { db } from "./db";

/**
 * Real classroom-capacity evaluation (Phase 2, spec item 5 / 6).
 *
 * "Real" means: the actual number of `GroupStudent` rows for a group,
 * never the group's declared `capacity` field, which is only a planning
 * target. This is shared by:
 *   - the Groups API (assigning/changing a classroom)
 *   - the Group-students (enroll/unenroll) API
 *   - the Rooms API (shrinking a classroom's capacity)
 *   - the Room detail page (classroom capacity status)
 *
 * The database also enforces this at the trigger level (see the Phase 2
 * migration) so it can never be bypassed by a code path that forgets to
 * call this helper — this module exists purely to produce a friendly,
 * specific error message *before* the DB rejects the write, and to
 * render the same numbers consistently across every screen.
 */

export type CapacityStatus = "AVAILABLE" | "FULL" | "EXCEEDED" | "UNLIMITED";

export interface CapacityEvaluation {
  studentCount: number;
  capacity: number | null;
  availableSeats: number | null;
  status: CapacityStatus;
  /** Human-readable, ready to show in the UI or an API error. */
  message: string;
}

export function evaluateCapacity(studentCount: number, capacity: number | null | undefined): CapacityEvaluation {
  if (capacity === null || capacity === undefined) {
    return {
      studentCount,
      capacity: null,
      availableSeats: null,
      status: "UNLIMITED",
      message: "No classroom assigned yet, so no capacity limit applies."
    };
  }

  const availableSeats = capacity - studentCount;

  if (studentCount > capacity) {
    return {
      studentCount,
      capacity,
      availableSeats,
      status: "EXCEEDED",
      message: `Capacity exceeded by ${studentCount - capacity} student${studentCount - capacity === 1 ? "" : "s"}.`
    };
  }

  if (studentCount === capacity) {
    return {
      studentCount,
      capacity,
      availableSeats: 0,
      status: "FULL",
      message: "This classroom is at full capacity."
    };
  }

  return {
    studentCount,
    capacity,
    availableSeats,
    status: "AVAILABLE",
    message: `${availableSeats} seat${availableSeats === 1 ? "" : "s"} available.`
  };
}

/** The real, current enrolled headcount for a single group. */
export async function getGroupStudentCount(groupId: string): Promise<number> {
  return db.groupStudent.count({ where: { groupId } });
}

/**
 * Validates that a group's real enrolled headcount fits inside a given
 * classroom's capacity. Returns the evaluation either way — the caller
 * decides whether to block (throw) or just warn, depending on context.
 */
export async function checkGroupFitsRoom(groupId: string, roomId: string | null | undefined) {
  const studentCount = await getGroupStudentCount(groupId);
  if (!roomId) {
    return evaluateCapacity(studentCount, null);
  }
  const room = await db.room.findUnique({ where: { id: roomId }, select: { capacity: true } });
  return evaluateCapacity(studentCount, room?.capacity ?? null);
}

/**
 * Full capacity status for a classroom (Room), including a per-group
 * breakdown — used by the Room/Classroom detail page (spec item 6).
 * "Current students" is the *largest single group* assigned to the room
 * (peak concurrent occupancy), not the sum across every group, since a
 * classroom hosts one group at a time in different weekly time slots —
 * this matches the same comparison the capacity-assignment rule uses
 * (Group Student Count vs Classroom Capacity) and the DB trigger that
 * blocks shrinking a room below its largest assigned group.
 */
export async function getRoomCapacityDetail(roomId: string) {
  const room = await db.room.findUnique({
    where: { id: roomId },
    include: {
      branch: { select: { id: true, name: true } },
      groups: {
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          isActive: true,
          subject: { select: { id: true, name: true } },
          academicLevel: { select: { id: true, name: true } },
          academicGrade: { select: { id: true, name: true } },
          teacher: { select: { id: true, fullName: true } },
          _count: { select: { groupStudents: true } }
        }
      }
    }
  });
  if (!room) return null;

  const groups = room.groups.map((g) => ({
    id: g.id,
    name: g.name,
    isActive: g.isActive,
    subject: g.subject,
    academicLevel: g.academicLevel,
    academicGrade: g.academicGrade,
    teacher: g.teacher,
    studentCount: g._count.groupStudents,
    capacityStatus: evaluateCapacity(g._count.groupStudents, room.capacity)
  }));

  const peakStudentCount = groups.reduce((max, g) => Math.max(max, g.studentCount), 0);
  const totalStudentCount = groups.reduce((sum, g) => sum + g.studentCount, 0);

  return {
    id: room.id,
    name: room.name,
    number: room.number,
    capacity: room.capacity,
    isActive: room.isActive,
    branch: room.branch,
    groups,
    currentStudents: peakStudentCount,
    totalStudentsAcrossGroups: totalStudentCount,
    capacityStatus: evaluateCapacity(peakStudentCount, room.capacity)
  };
}
