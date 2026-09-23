/** Password policy – shared by server validation and client-side hints (server is authoritative). */
export const PASSWORD_RULES = {
  minLength: 8,
  maxLength: 128,
} as const;

export const PASSWORD_POLICY_TEXT =
  "Parola trebuie să aibă cel puțin 8 caractere și să conțină cel puțin o literă mare, o cifră și un caracter special.";

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
  return errors;
}
