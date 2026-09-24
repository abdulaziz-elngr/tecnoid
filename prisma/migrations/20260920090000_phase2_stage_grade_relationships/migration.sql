-- ==========================================================================
-- Phase 2 migration — Stage/Grade relationships, classroom capacity
-- enforcement, Announcements.
--
-- SAFETY / DATA PRESERVATION NOTES (read before applying to production):
--   1. Every new column below is added NULLABLE. No existing row in
--      "Subject" or "Group" is touched, deleted, or required to change.
--   2. No table is dropped. No column is dropped. No existing row is
--      deleted.
--   3. Existing Subjects/Groups that predate this migration will have
--      "academicLevelId"/"academicGradeId" = NULL after this migration
--      runs. They keep working exactly as before (nullable FKs), but the
--      application layer requires Stage+Grade for any NEW subject/group
--      created after this migration, and flags legacy unassigned rows in
--      the UI ("Needs Stage/Grade assignment") so an administrator can
--      fill them in manually — there is no way to auto-infer a Stage/
--      Grade from data that was never captured, so we do not guess.
--      To find every row that still needs manual assignment, run:
--        SELECT id, name FROM "Subject" WHERE "academicGradeId" IS NULL;
--        SELECT id, name FROM "Group"   WHERE "academicGradeId" IS NULL;
--   4. The Subject unique constraint changes from
--      (organizationId, name) to (organizationId, academicGradeId, name)
--      so the same subject name can exist once per Grade (e.g.
--      "Mathematics" for First Secondary and "Mathematics" for Second
--      Secondary are different rows). Postgres treats NULL as distinct
--      in a unique index, so legacy rows with no grade yet are exempt
--      from collisions with each other.
--   5. Cross-table integrity (Grade belongs to the chosen Stage, a
--      Group's Subject belongs to the same Grade as the Group, real
--      enrolled headcount never exceeds classroom capacity) is enforced
--      with Postgres trigger functions rather than Prisma composite
--      relations, matching the project's existing convention of adding
--      DB-level guards directly in migration SQL (see the comment on
--      the Schedule model in prisma/schema.prisma for precedent).
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Subject -> Stage (AcademicLevel) / Grade (AcademicGrade)
-- --------------------------------------------------------------------------

ALTER TABLE "Subject"
  ADD COLUMN "academicLevelId" TEXT,
  ADD COLUMN "academicGradeId" TEXT;

-- Drop the old organization-wide unique name constraint and replace it
-- with one scoped per Grade (see note 4 above). The constraint name
-- matches Prisma's default naming convention for the original
-- `@@unique([organizationId, name])`.
ALTER TABLE "Subject" DROP CONSTRAINT IF EXISTS "Subject_organizationId_name_key";
ALTER TABLE "Subject"
  ADD CONSTRAINT "Subject_organizationId_academicGradeId_name_key"
  UNIQUE ("organizationId", "academicGradeId", "name");

CREATE INDEX IF NOT EXISTS "Subject_organizationId_idx" ON "Subject" ("organizationId");
CREATE INDEX IF NOT EXISTS "Subject_academicLevelId_idx" ON "Subject" ("academicLevelId");
CREATE INDEX IF NOT EXISTS "Subject_academicGradeId_idx" ON "Subject" ("academicGradeId");

ALTER TABLE "Subject"
  ADD CONSTRAINT "Subject_academicLevelId_fkey"
  FOREIGN KEY ("academicLevelId") REFERENCES "AcademicLevel"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Subject"
  ADD CONSTRAINT "Subject_academicGradeId_fkey"
  FOREIGN KEY ("academicGradeId") REFERENCES "AcademicGrade"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
-- 2. Group -> Grade (AcademicGrade). Group already had academicLevelId
--    (Stage) as a required column from Phase 1; that column is untouched.
-- --------------------------------------------------------------------------

ALTER TABLE "Group" ADD COLUMN "academicGradeId" TEXT;

CREATE INDEX IF NOT EXISTS "Group_academicLevelId_idx" ON "Group" ("academicLevelId");
CREATE INDEX IF NOT EXISTS "Group_academicGradeId_idx" ON "Group" ("academicGradeId");

ALTER TABLE "Group"
  ADD CONSTRAINT "Group_academicGradeId_fkey"
  FOREIGN KEY ("academicGradeId") REFERENCES "AcademicGrade"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
-- 3. Referential-integrity triggers (real FK-style enforcement for
--    relationships that span more than one column / more than one table,
--    which plain foreign keys cannot express).
-- --------------------------------------------------------------------------

-- 3a. A Subject's Grade must belong to the Subject's own Stage.
CREATE OR REPLACE FUNCTION enforce_subject_grade_level_match() RETURNS trigger AS $$
DECLARE
  grade_level_id TEXT;
BEGIN
  IF NEW."academicGradeId" IS NOT NULL THEN
    SELECT "levelId" INTO grade_level_id FROM "AcademicGrade" WHERE id = NEW."academicGradeId";
    IF grade_level_id IS NULL THEN
      RAISE EXCEPTION 'Unknown academicGradeId %', NEW."academicGradeId" USING ERRCODE = '23503';
    END IF;
    IF NEW."academicLevelId" IS NOT NULL AND grade_level_id IS DISTINCT FROM NEW."academicLevelId" THEN
      RAISE EXCEPTION 'Subject grade % does not belong to stage %', NEW."academicGradeId", NEW."academicLevelId"
        USING ERRCODE = '23514';
    END IF;
    -- Keep the redundant stage column consistent automatically so callers
    -- that only send academicGradeId can never leave it out of sync.
    NEW."academicLevelId" := grade_level_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_subject_grade_level_match ON "Subject";
CREATE TRIGGER trg_subject_grade_level_match
  BEFORE INSERT OR UPDATE OF "academicGradeId", "academicLevelId" ON "Subject"
  FOR EACH ROW EXECUTE FUNCTION enforce_subject_grade_level_match();

-- 3b. A Group's Grade must belong to the Group's own Stage.
CREATE OR REPLACE FUNCTION enforce_group_grade_level_match() RETURNS trigger AS $$
DECLARE
  grade_level_id TEXT;
BEGIN
  IF NEW."academicGradeId" IS NOT NULL THEN
    SELECT "levelId" INTO grade_level_id FROM "AcademicGrade" WHERE id = NEW."academicGradeId";
    IF grade_level_id IS NULL THEN
      RAISE EXCEPTION 'Unknown academicGradeId %', NEW."academicGradeId" USING ERRCODE = '23503';
    END IF;
    IF grade_level_id IS DISTINCT FROM NEW."academicLevelId" THEN
      RAISE EXCEPTION 'Group grade % does not belong to stage %', NEW."academicGradeId", NEW."academicLevelId"
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_group_grade_level_match ON "Group";
CREATE TRIGGER trg_group_grade_level_match
  BEFORE INSERT OR UPDATE OF "academicGradeId", "academicLevelId" ON "Group"
  FOR EACH ROW EXECUTE FUNCTION enforce_group_grade_level_match();

-- 3c. A Group's Subject must belong to the same Grade as the Group.
CREATE OR REPLACE FUNCTION enforce_group_subject_grade_match() RETURNS trigger AS $$
DECLARE
  subject_grade_id TEXT;
BEGIN
  IF NEW."academicGradeId" IS NOT NULL THEN
    SELECT "academicGradeId" INTO subject_grade_id FROM "Subject" WHERE id = NEW."subjectId";
    IF subject_grade_id IS NOT NULL AND subject_grade_id IS DISTINCT FROM NEW."academicGradeId" THEN
      RAISE EXCEPTION 'Group subject % (grade %) does not match group grade %',
        NEW."subjectId", subject_grade_id, NEW."academicGradeId"
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_group_subject_grade_match ON "Group";
CREATE TRIGGER trg_group_subject_grade_match
  BEFORE INSERT OR UPDATE OF "subjectId", "academicGradeId" ON "Group"
  FOR EACH ROW EXECUTE FUNCTION enforce_group_subject_grade_match();

-- --------------------------------------------------------------------------
-- 4. Real classroom-capacity enforcement (spec item 5 / 6): actual
--    enrolled headcount (GroupStudent rows), not just the Group's
--    declared `capacity` field, is what gets compared against the
--    Room's capacity. The application layer performs the same checks
--    first (for a friendly error message); these triggers are the
--    non-bypassable backstop.
-- --------------------------------------------------------------------------

-- 4a. Enrolling a student beyond the assigned classroom's capacity is
--     rejected outright (the project has no existing "soft warning"
--     rule to preserve here — the pre-existing rule for capacity was
--     already a hard block, see the historical check in
--     src/app/api/groups/route.ts — so Phase 2 keeps that same
--     safer-by-default behaviour for the real-headcount case too).
CREATE OR REPLACE FUNCTION enforce_group_capacity() RETURNS trigger AS $$
DECLARE
  room_capacity INT;
  current_count INT;
BEGIN
  SELECT r.capacity INTO room_capacity
  FROM "Group" g
  LEFT JOIN "Room" r ON r.id = g."roomId"
  WHERE g.id = NEW."groupId";

  IF room_capacity IS NOT NULL THEN
    SELECT count(*) INTO current_count FROM "GroupStudent" WHERE "groupId" = NEW."groupId";
    IF current_count >= room_capacity THEN
      RAISE EXCEPTION 'Classroom capacity (%) reached for this group — cannot enroll another student', room_capacity
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_group_capacity_check ON "GroupStudent";
CREATE TRIGGER trg_group_capacity_check
  BEFORE INSERT ON "GroupStudent"
  FOR EACH ROW EXECUTE FUNCTION enforce_group_capacity();

-- 4b. Re-assigning a Group to a smaller classroom than its current real
--     enrolled headcount is rejected.
CREATE OR REPLACE FUNCTION enforce_group_room_capacity() RETURNS trigger AS $$
DECLARE
  student_count INT;
  room_capacity INT;
BEGIN
  IF NEW."roomId" IS NOT NULL AND (OLD."roomId" IS DISTINCT FROM NEW."roomId") THEN
    SELECT capacity INTO room_capacity FROM "Room" WHERE id = NEW."roomId";
    SELECT count(*) INTO student_count FROM "GroupStudent" WHERE "groupId" = NEW.id;
    IF room_capacity IS NOT NULL AND student_count > room_capacity THEN
      RAISE EXCEPTION 'Classroom capacity (%) is smaller than the number of students already in this group (%)',
        room_capacity, student_count
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_group_room_capacity_check ON "Group";
CREATE TRIGGER trg_group_room_capacity_check
  BEFORE UPDATE OF "roomId" ON "Group"
  FOR EACH ROW EXECUTE FUNCTION enforce_group_room_capacity();

-- 4c. Shrinking a classroom's capacity below the real headcount of the
--     largest group already assigned to it is rejected. (The pre-existing
--     check in src/app/api/rooms/[id]/route.ts only compared against the
--     declared Group.capacity field; this trigger additionally guards the
--     real, dynamic enrollment count.)
CREATE OR REPLACE FUNCTION enforce_room_capacity_shrink() RETURNS trigger AS $$
DECLARE
  max_group_students INT;
BEGIN
  IF NEW.capacity < OLD.capacity THEN
    SELECT COALESCE(MAX(cnt), 0) INTO max_group_students
    FROM (
      SELECT gs."groupId", count(*) AS cnt
      FROM "GroupStudent" gs
      JOIN "Group" g ON g.id = gs."groupId"
      WHERE g."roomId" = NEW.id AND g."deletedAt" IS NULL
      GROUP BY gs."groupId"
    ) counts;

    IF NEW.capacity < max_group_students THEN
      RAISE EXCEPTION 'Cannot shrink classroom capacity to % — the largest group assigned to it has % students',
        NEW.capacity, max_group_students
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_room_capacity_shrink_check ON "Room";
CREATE TRIGGER trg_room_capacity_shrink_check
  BEFORE UPDATE OF capacity ON "Room"
  FOR EACH ROW EXECUTE FUNCTION enforce_room_capacity_shrink();

-- --------------------------------------------------------------------------
-- 5. Announcements (manual click-to-chat WhatsApp — see item 11)
-- --------------------------------------------------------------------------

CREATE TYPE "AnnouncementAudienceType" AS ENUM ('STUDENT', 'GROUP', 'SELECTED');

CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "groupId" TEXT,
    "createdById" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "audienceType" "AnnouncementAudienceType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnnouncementRecipient" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Announcement_organizationId_idx" ON "Announcement" ("organizationId");
CREATE INDEX "Announcement_branchId_idx" ON "Announcement" ("branchId");
CREATE INDEX "Announcement_groupId_idx" ON "Announcement" ("groupId");
CREATE INDEX "Announcement_createdAt_idx" ON "Announcement" ("createdAt");

CREATE UNIQUE INDEX "AnnouncementRecipient_announcementId_studentId_key"
  ON "AnnouncementRecipient" ("announcementId", "studentId");
CREATE INDEX "AnnouncementRecipient_announcementId_idx" ON "AnnouncementRecipient" ("announcementId");
CREATE INDEX "AnnouncementRecipient_studentId_idx" ON "AnnouncementRecipient" ("studentId");

ALTER TABLE "Announcement"
  ADD CONSTRAINT "Announcement_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AnnouncementRecipient"
  ADD CONSTRAINT "AnnouncementRecipient_announcementId_fkey"
  FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnnouncementRecipient"
  ADD CONSTRAINT "AnnouncementRecipient_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
