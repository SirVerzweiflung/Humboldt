// Supabase/Postgrest errors are plain objects, not Error instances, so String(e)
// yields "[object Object]". Extract something human-readable.
export function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const msg = o.message ?? o.error_description ?? o.error ?? o.hint;
    if (typeof msg === "string") return msg;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}
