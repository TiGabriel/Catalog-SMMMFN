import { z } from "zod";

export const USERNAME_REGEX = /^[a-z0-9][a-z0-9._-]{2,49}$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export const uuid = z.uuid({ error: "Identificator invalid." });

export const username = z
  .string({ error: "Numele de utilizator este obligatoriu." })
  .transform(normalizeUsername)
  .pipe(
    z.string().regex(USERNAME_REGEX, {
      error: "Numele de utilizator poate conține 3–50 caractere: litere mici, cifre, punct, cratimă sau underscore.",
    }),
  );

/** Person names: letters (incl. diacritics), spaces, hyphen, apostrophe, dot. */
export const personName = z
  .string({ error: "Câmp obligatoriu." })
  .trim()
  .min(1, { error: "Câmp obligatoriu." })
  .max(80, { error: "Maximum 80 de caractere." })
  .regex(/^[\p{L}][\p{L} .'-]*$/u, { error: "Conține caractere nepermise." });

export const shortText = (max = 200) =>
  z.string().trim().min(1, { error: "Câmp obligatoriu." }).max(max, { error: `Maximum ${max} de caractere.` });

export const reasonText = z
  .string({ error: "Motivul este obligatoriu." })
  .trim()
  .min(3, { error: "Motivul trebuie să aibă cel puțin 3 caractere." })
  .max(500, { error: "Motivul poate avea cel mult 500 de caractere." });

/** Calendar date "YYYY-MM-DD" → Date at UTC midnight. */
export const isoDate = z
  .string({ error: "Dată invalidă." })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Dată invalidă (format AAAA-LL-ZZ)." })
  .transform((s, ctx) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
      ctx.addIssue({ code: "custom", message: "Dată invalidă." });
      return z.NEVER;
    }
    return d;
  });
