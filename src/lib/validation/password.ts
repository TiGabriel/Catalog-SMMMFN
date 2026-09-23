/** Password policy – shared by server validation and client-side hints (server is authoritative). */
export const PASSWORD_RULES = {
  minLength: 8,
  maxLength: 128,
} as const;

export const PASSWORD_POLICY_TEXT =
  "Parola trebuie să aibă cel puțin 8 caractere și să conțină cel puțin o literă mare, o cifră și un caracter special.";

/** Fragments that make a password trivially guessable (checked case-/diacritics-insensitively). */
const WEAK_FRAGMENTS = ["password", "passw0rd", "parola", "qwerty", "azerty", "123456", "abcdef", "admin", "smmmfn", "murgescu", "catalog", "fortelenavale"];

function simplify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/0/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/[$5]/g, "s")
    .replace(/[^a-z0-9]/g, "");
}

export function passwordPolicyErrors(password: string, username?: string): string[] {
  const errors: string[] = [];
  if (password.length < PASSWORD_RULES.minLength) errors.push("Parola trebuie să aibă cel puțin 8 caractere.");
  if (password.length > PASSWORD_RULES.maxLength) errors.push("Parola poate avea cel mult 128 de caractere.");
  if (!/\p{Lu}/u.test(password)) errors.push("Parola trebuie să conțină cel puțin o literă mare.");
  if (!/\p{Nd}/u.test(password)) errors.push("Parola trebuie să conțină cel puțin o cifră.");
  if (!/[^\p{L}\p{N}\s]/u.test(password)) errors.push("Parola trebuie să conțină cel puțin un caracter special.");
  if (username && username.length >= 3 && password.toLowerCase().includes(username.toLowerCase())) {
    errors.push("Parola nu poate conține numele de utilizator.");
  }
  const simple = simplify(password);
  const raw = password.toLowerCase();
  if (WEAK_FRAGMENTS.some((w) => raw.includes(w) || simple.includes(simplify(w)))) {
    errors.push("Parola este prea ușor de ghicit (conține un cuvânt uzual).");
  }
  return errors;
}
