import { db } from "./db";
import { BusinessRuleError, NotFoundError } from "./api";

/**
 * Shared Stage (AcademicLevel) / Grade (AcademicGrade) validation.
 *
 * Used by the Subjects and Groups APIs so "a Grade must belong to the
 * selected Stage" is checked with one implementation, not copy-pasted —
 * see prisma/migrations/20260920090000_phase2_stage_grade_relationships
 * for the matching database-level trigger that backstops this same rule.
 */

/** Confirms the Stage exists and belongs to this organization. */
export async function assertStageExists(organizationId: string, academicLevelId: string) {
  const level = await db.academicLevel.findFirst({ where: { id: academicLevelId, organizationId } });
  if (!level) throw new NotFoundError("Stage not found.");
  return level;
}

/** Confirms the Grade exists, belongs to the given Stage, and both belong to this org. */
export async function assertGradeBelongsToLevel(
  organizationId: string,
  academicLevelId: string,
  academicGradeId: string
) {
  const grade = await db.academicGrade.findFirst({
    where: { id: academicGradeId, levelId: academicLevelId, level: { organizationId } }
  });
  if (!grade) {
    throw new BusinessRuleError("The selected grade does not belong to the selected stage.", {
      status: 400,
      code: "GRADE_STAGE_MISMATCH"
    });
  }
  return grade;
}

/** Confirms the Subject exists, belongs to this org, and belongs to the given Grade. */
export async function assertSubjectBelongsToGrade(organizationId: string, subjectId: string, academicGradeId: string) {
  const subject = await db.subject.findFirst({
    where: { id: subjectId, organizationId, deletedAt: null }
  });
  if (!subject) throw new NotFoundError("Subject not found.");

  if (subject.academicGradeId && subject.academicGradeId !== academicGradeId) {
    throw new BusinessRuleError(
      "The selected subject belongs to a different grade than the one selected for this group.",
      { status: 400, code: "SUBJECT_GRADE_MISMATCH" }
    );
  }
  return subject;
}
