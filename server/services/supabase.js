// ── Supabase client (server-side, service-role) ──────────────────────────────
// The app talks to Supabase only from the server, using the service-role key.
// The anon key is never sent to the browser and no RLS is relied upon — the
// client keeps calling /api/* and Express is the only thing that touches the DB.
//
// Lazy singleton: the client is created on first use (not at import) so the
// server still boots for the stateless-proxy modules even before SUPABASE_*
// env vars are configured. The first DB call throws a clear, actionable error.

const { createClient } = require('@supabase/supabase-js');

let client = null;

function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY ' +
      'in your .env (see .env.example). These must be the project URL and the ' +
      'service-role key (server-side only — never expose the service-role key to the browser).'
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

// True when both env vars are present — lets callers gate optional persistence
// without triggering the throw above.
function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

module.exports = { getSupabase, isSupabaseConfigured };
