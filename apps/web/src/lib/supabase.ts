import { createClient } from "@supabase/supabase-js";

// Fail fast: a blank URL otherwise surfaces as a confusing runtime 404 (§10.4).
const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anon) {
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy apps/web/.env.example to apps/web/.env and fill it.",
  );
}

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Anonymous auth: silent, no names, no login UI. Idempotent — reuses the
// localStorage session on reload so the same device keeps the same auth.uid().
let authPromise: Promise<string> | null = null;
export function ensureAnonAuth(): Promise<string> {
  authPromise ??= (async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) return data.session.user.id;
    const { data: signed, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    return signed.user!.id;
  })();
  return authPromise;
}
