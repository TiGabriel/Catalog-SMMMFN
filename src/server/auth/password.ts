import "server-only";
import { hash, verify } from "@node-rs/argon2";
import { SECURITY } from "@/server/config";
import { passwordPolicyErrors } from "@/lib/validation/password";
import { ARGON2_OPTIONS } from "@/server/auth/argon2-options";

export async function hashPassword(password: string): Promise<string> {
  const errors = passwordPolicyErrors(password);
  if (errors.length > 0) throw new Error("Password does not satisfy policy");
  return hash(password, ARGON2_OPTIONS);
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifies a password. When the user does not exist (or has no hash), a dummy
 * hash is verified instead so response time does not reveal valid usernames.
 */
export async function verifyPassword(passwordHash: string | null | undefined, password: string): Promise<boolean> {
  if (password.length > SECURITY.password.maxLength) return false;
  if (!passwordHash) {
    dummyHash ??= hash("Parola-Inexistenta#1", ARGON2_OPTIONS);
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
