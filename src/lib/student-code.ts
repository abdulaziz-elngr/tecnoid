import { customAlphabet } from "nanoid";
import { db } from "./db";

// Unambiguous alphabet (no 0/O, 1/I) for human-readable, scannable codes.
const codeAlphabet = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8);

/**
 * Generates a unique, human-readable Student ID and a paired QR
 * payload. Retries on the rare collision instead of trusting a
 * single random draw to be unique (defense in depth alongside the
 * DB unique constraint).
 */
export async function generateStudentCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `STD-${codeAlphabet()}`;
    const exists = await db.student.findUnique({ where: { studentCode: candidate } });
    if (!exists) return candidate;
  }
  throw new Error("Could not generate a unique student code, please retry.");
}

export function buildQrPayload(studentCode: string): string {
  // The QR/barcode encodes the student code plus a short random
  // suffix so the printed code itself isn't trivially guessable
  // from a sequential Student ID.
  return `TECNOID:${studentCode}:${codeAlphabet()}`;
}
