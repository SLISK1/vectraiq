import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================
// Thin wrapper that lets an authenticated user trigger
// the service-role-only daily-pipeline (or other admin functions).
//
// Pattern:
//   1. Verify the caller is a logged-in user (any user — single-user app).
//   2. Fire-and-forget the actual function call with service role.
//   3. Return immediately so the browser doesn't time out on the 5-15min run.
//
// The target function inserts pipeline_runs row immediately, so the UI
// can poll `pipeline_runs` to track progress.
// ============================================================

const ALLOWED_TARGETS = new Set([
  'daily-pipeline',
  'seed-extended-universe',
  'compute-news-sentiment',
  'fetch-events',
  'compute-sector-returns',
  'fetch-earnings-events',
  'analyze-thesis',
  'fetch-news',
  'paper-snapshot',
]);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // === AUTH CHECK ===
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Authorization header required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    // Service role tokens are allowed (cron passthrough). Otherwise verify user JWT.
    const isServiceRole = token === serviceKey;
    if (!isServiceRole) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await userClient.auth.getUser(token);
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.log(`trigger-pipeline: invoked by user ${user.id}`);
    }

    // === PARSE BODY ===
    let body: { target?: string; payload?: Record<string, unknown> } = {};
    try {
      body = await req.json();
    } catch { /* no body */ }

    const target = body.target || 'daily-pipeline';
    if (!ALLOWED_TARGETS.has(target)) {
      return new Response(JSON.stringify({
        error: `Target '${target}' not in allowlist`,
        allowed: Array.from(ALLOWED_TARGETS),
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const payload = body.payload || {};

    // === FIRE-AND-FORGET ===
    // We deliberately do NOT await the response — daily-pipeline takes 5-15min
    // and the caller's request would time out. The target function inserts a
    // pipeline_runs row immediately, so the UI polls that table to track progress.
    const targetUrl = `${supabaseUrl}/functions/v1/${target}`;
    const targetCall = fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(payload),
    }).catch(e => {
      console.error(`Background ${target} call failed:`, e);
    });

    // EdgeRuntime.waitUntil keeps the runtime alive for the background task
    // even after we return the response. Falls back gracefully if not supported.
    try {
      // @ts-ignore — EdgeRuntime is Supabase-specific
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(targetCall);
      }
    } catch { /* not supported — fetch is already in flight, will continue best-effort */ }

    return new Response(JSON.stringify({
      triggered: target,
      payload,
      note: 'Running in background. Poll pipeline_runs (or relevant table) for status.',
      timestamp: new Date().toISOString(),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
