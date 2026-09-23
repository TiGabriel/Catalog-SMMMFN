import "server-only";

/**
 * Application errors. Messages are Romanian, generic and safe to show to the user.
 * Internal details must never be put into `message`; use `internal` for server logs only.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  unauthenticated: () => new AppError(401, "NEAUTENTIFICAT", "Sesiunea a expirat sau nu sunteți autentificat."),
  invalidCredentials: () => new AppError(401, "DATE_INCORECTE", "Nume de utilizator sau parolă incorecte."),
  forbidden: () => new AppError(403, "ACCES_INTERZIS", "Nu aveți drepturi pentru această operațiune."),
  passwordChangeRequired: () =>
    new AppError(403, "SCHIMBARE_PAROLA_OBLIGATORIE", "Trebuie să vă schimbați parola înainte de a continua."),
  csrf: () => new AppError(403, "CERERE_INVALIDA", "Cererea a fost respinsă din motive de securitate."),
  notFound: () => new AppError(404, "NEGASIT", "Resursa solicitată nu a fost găsită."),
  validation: (details?: Record<string, string[]>, message = "Datele introduse nu sunt valide.") =>
    new AppError(400, "DATE_INVALIDE", message, details),
  conflict: (message = "Operațiunea intră în conflict cu datele existente.") => new AppError(409, "CONFLICT", message),
  rateLimited: () =>
    new AppError(429, "PREA_MULTE_CERERI", "Prea multe încercări. Vă rugăm să încercați din nou mai târziu."),
  unsupportedMediaType: () => new AppError(415, "TIP_CONTINUT_INVALID", "Tipul conținutului nu este acceptat."),
  internal: () => new AppError(500, "EROARE_INTERNA", "A apărut o eroare internă. Vă rugăm să încercați din nou."),
};
