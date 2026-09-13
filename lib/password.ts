/** Single source of truth for the app's password minimum length — used by
 *  every password-entry flow (Registrierung, Passwort ändern, Passwort
 *  zurücksetzen) so the rule can never drift between them again. This is a
 *  client-side UX check only; the authoritative enforcement is Supabase
 *  Auth's own project-level minimum password length setting (Dashboard →
 *  Authentication → Policies), which must be set to at least this value. */
export const PASSWORD_MIN_LENGTH = 8

export const PASSWORD_MIN_LENGTH_MESSAGE = `Das Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen lang sein.`
