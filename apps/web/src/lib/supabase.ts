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

// The one place a fresh anonymous session is minted. CAPTCHA is enabled in
// Supabase Auth, so signInAnonymously requires a Turnstile token. Called only by
// <AuthGate> on first visit; returning devices reuse the localStorage session.
export async function signInWithCaptcha(captchaToken: string): Promise<void> {
  const { error } = await supabase.auth.signInAnonymously({ options: { captchaToken } });
  if (error) throw error;
}

// Read the current anonymous uid. By the time any route renders, <AuthGate> has
// guaranteed a session, so this never needs to sign in itself.
export async function ensureAnonAuth(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Not signed in (captcha gate not passed)");
  return data.session.user.id;
}
