import argon2 from "argon2";

/**
 * Password hashing using Argon2id — the modern, memory-hard algorithm
 * recommended by OWASP. Never store or log plaintext passwords.
 */

const HASH_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // ~19 MB, OWASP minimum recommendation
  timeCost: 2,
  parallelism: 1
};

export async function hashPassword(plainPassword: string): Promise<string> {
  return argon2.hash(plainPassword, HASH_OPTIONS);
}

export async function verifyPassword(
  hash: string,
  plainPassword: string
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plainPassword);
  } catch {
    // Malformed hash or verify error — treat as invalid, never throw
    // to the caller (which could leak timing/error information).
    return false;
  }
}

/**
 * Minimum password policy enforced server-side, independent of any
 * frontend validation.
 */
export function isPasswordStrongEnough(plainPassword: string): boolean {
  if (plainPassword.length < 10) return false;
  const hasLetter = /[a-zA-Z]/.test(plainPassword);
  const hasNumber = /[0-9]/.test(plainPassword);
  return hasLetter && hasNumber;
}
