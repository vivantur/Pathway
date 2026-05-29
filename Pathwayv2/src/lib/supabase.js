'use strict';

const { createClient } = require('@supabase/supabase-js');

let _client = null;

// Returns the Supabase service-role client, or null if env vars are not set.
// Callers must handle the null case gracefully — the bot should work fully
// without Supabase configured (local dev, Railway without vars set, etc.).
function getSupabase() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key, {
    auth: { persistSession: false },
  });
  return _client;
}

module.exports = { getSupabase };
