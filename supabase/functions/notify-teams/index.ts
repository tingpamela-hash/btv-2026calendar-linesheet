import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const NOTIFY_LIMIT = 8;
const NOTIFY_WINDOW_MS = 15 * 60 * 1000;
const notifyBuckets = new Map();
const DEFAULT_HOSTS = [
  "environment.api.powerplatform.com",
  "webhook.office.com",
  "webhooks.office.com",
  "hooks.office.com",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return notifyJson(null, 204);
  if (req.method !== "POST") return notifyJson({ ok: false, error: "Use POST." }, 405);

  const user = await notifyUser(notifyBearer(req));
  if (!user) return notifyJson({ ok: false, error: "Sign in as an editor." }, 401);

  let payload = null;
  try {
    payload = await req.json();
  } catch (_err) {
    return notifyJson({ ok: false, error: "Send a channel and a summary." }, 400);
  }
  const channel = payload && (payload.channel === "linesheet" || payload.channel === "calendar")
    ? payload.channel
    : "";
  if (!channel) return notifyJson({ ok: false, error: "Channel is not allowed." }, 400);
  const summary = payload && typeof payload.summary === "string" ? payload.summary.trim() : "";
  if (!summary || summary.length > 8000) {
    return notifyJson({ ok: false, error: "Summary is empty or too long." }, 400);
  }
  if (!notifyRoleAllowed(user.profile, channel)) {
    return notifyJson({ ok: false, error: "Editor access is required." }, 403);
  }
  if (!notifyTakeRate(user.id, Date.now())) {
    return notifyJson({ ok: false, error: "Too many notify requests." }, 429);
  }

  const webhookUrl = String(Deno.env.get("BTV_NOTIFY_WEBHOOK_URL") || "").trim();
  if (!webhookUrl) return notifyJson({ ok: true, disabled: true }, 200);
  if (!notifyHostAllowed(webhookUrl)) {
    return notifyJson({ ok: false, error: "Notify destination is not allowlisted." }, 500);
  }

  let resp;
  try {
    resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(notifyCard(channel, summary)),
    });
  } catch (_err) {
    return notifyJson({ ok: false, disabled: false }, 502);
  }
  return notifyJson({ ok: resp.ok, disabled: false }, resp.ok ? 200 : 502);
});

function notifyJson(body, status) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

function notifyBearer(req) {
  const header = req.headers.get("authorization") || "";
  return header.slice(0, 7).toLowerCase() === "bearer " ? header.slice(7).trim() : "";
}

async function notifyUser(bearer) {
  if (!bearer) return null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return null;
  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const got = await sb.auth.getUser(bearer);
  const user = got && got.data && got.data.user;
  if (!got || got.error || !user) return null;
  const profile = await sb.from("user_profiles")
    .select("is_admin, can_edit_linesheet, can_edit_product_calendar, can_edit_global_calendar")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.error || !profile.data) return null;
  return { id: user.id, profile: profile.data };
}

function notifyRoleAllowed(profile, channel) {
  if (!profile) return false;
  if (profile.is_admin === true) return true;
  if (channel === "linesheet") return profile.can_edit_linesheet === true;
  if (channel === "calendar") {
    return profile.can_edit_product_calendar === true || profile.can_edit_global_calendar === true;
  }
  return false;
}

function notifyHostAllowlist() {
  const custom = String(Deno.env.get("BTV_NOTIFY_HOST_ALLOWLIST") || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return custom.length ? custom : DEFAULT_HOSTS;
}

function notifyHostAllowed(webhookUrl) {
  let parsed;
  try {
    parsed = new URL(webhookUrl);
  } catch (_err) {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  return notifyHostAllowlist().some((entry) => host === entry || host.endsWith("." + entry));
}

function notifyTakeRate(key, now) {
  const bucket = notifyBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= NOTIFY_WINDOW_MS) {
    notifyBuckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= NOTIFY_LIMIT) return false;
  bucket.count += 1;
  return true;
}

function notifyCard(channel, summaryText) {
  const title = channel === "calendar" ? "BTV Calendar Update" : "BTV Planner — Linesheet";
  const htmlText = summaryText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/\n/g, "<br>");
  return {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    themeColor: "8B6F4E",
    summary: title,
    message: summaryText,
    sections: [{ text: htmlText }],
  };
}
