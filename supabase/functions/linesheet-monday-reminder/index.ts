// BTV Planner — Weekly Linesheet Reminder
//
// Reads outstanding linesheet items (same rule as the in-app dashboard:
// missing fields, launch within 30 days, not yet marked complete), groups
// them by responsible team, and emails each team's configured recipients
// via Resend. Invoked every Monday by the pg_cron job set up in
// supabase-setup.sql (section 11), or manually for testing.
//
// Required secrets (supabase secrets set ...):
//   RESEND_API_KEY       — from resend.com
//   LINESHEET_FROM_EMAIL — optional, e.g. "BTV Planner <notifications@beyondthevines.com>"
//                          defaults to Resend's shared test sender, which only
//                          delivers to the Resend account owner's own email.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeReminder } from "./authorization.mjs";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("LINESHEET_FROM_EMAIL") || "BTV Planner <onboarding@resend.dev>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EMAILS_KEY = "btv-linesheet-notify-emails-v1";

// Mirrors the TDEF role/field definitions in linesheet.html (btvCheckMondayReminder).
const TDEF = [
  { id: "merch", label: "Merch", fields: ["name", "category", "variant", "sgd", "launchDate"], flabels: ["Product Name", "Category", "Colour/Variant", "SGD RRP", "Launch Date"] },
  { id: "design", label: "Design", fields: ["description", "washcare", "fabric", "productImg", "lookbookImg"], flabels: ["Description", "Washcare", "Fabric", "Product Image", "Lookbook Image"] },
  { id: "prod", label: "Prod", fields: ["hscode", "sku", "barcode"], flabels: ["HS Code", "SKU", "Barcode"] },
  { id: "pd", label: "Product Designers", fields: ["fabric", "weightGrams", "measurementSummary"], flabels: ["Fabric Composition", "Product Weight", "Measurement Chart"] },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: "Reminder unavailable." }, 503);
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const authorized = await authorizeReminder(req, {
    secret: Deno.env.get("BTV_REMINDER_CRON_SECRET"),
    client: sb,
  });
  if (!authorized) return json({ ok: false, error: "Not authorized." }, 403);
  if (!RESEND_API_KEY) {
    return json({ ok: false, error: "RESEND_API_KEY secret is not set." }, 500);
  }

  const [{ data: productRows, error: productsError }, { data: emailRows, error: emailsError }] = await Promise.all([
    sb.from("linesheet_products").select("data"),
    sb.from("app_state").select("value").eq("key", EMAILS_KEY),
  ]);

  if (productsError) return json({ ok: false, error: productsError.message }, 500);
  if (emailsError) return json({ ok: false, error: emailsError.message }, 500);

  const products: any[] = (productRows || [])
    .map((row) => row.data)
    .filter((product) => product && typeof product === "object");
  const emailsRow = emailRows?.[0];
  const roleEmails: Record<string, string[]> = emailsRow?.value || {};

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + 30);
  cutoff.setHours(23, 59, 59, 999);

  const relevant = products.filter((p) => {
    if (p.linesheetComplete) return false;
    if (!p.launchDate) return false;
    const d = new Date(p.launchDate);
    d.setHours(0, 0, 0, 0);
    const due = new Date(d);
    due.setDate(due.getDate() - 30);
    return due <= cutoff;
  });

  const results: any[] = [];

  for (const team of TDEF) {
    const out = relevant.filter((p) => team.fields.some((fk) => !p[fk]));
    const emails = (roleEmails[team.id] || []).map((e) => (e || "").trim()).filter(Boolean);

    if (!out.length) {
      results.push({ team: team.id, skipped: "no outstanding items" });
      continue;
    }
    if (!emails.length) {
      results.push({ team: team.id, skipped: "no recipients configured", outstanding: out.length });
      continue;
    }

    const lines: string[] = [
      `${team.label} team — ${out.length} linesheet item(s) need your input before launch:`,
      "",
    ];
    out.forEach((p) => {
      const missing = team.fields
        .map((fk, i) => (!p[fk] ? team.flabels[i] : null))
        .filter(Boolean);
      lines.push(
        `• ${p.name || "Unnamed"}${p.variant ? " — " + p.variant : ""} [Launch: ${p.launchDate || "?"}] — Missing: ${missing.join(", ")}`,
      );
    });
    lines.push("", "Please log in to the BTV Planner Linesheet and fill these in.");

    const html = lines
      .map((l) => (l ? `<p style="margin:0 0 8px;font:14px/1.5 Helvetica,Arial,sans-serif">${escapeHtml(l)}</p>` : ""))
      .join("");

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: emails,
        subject: `[Action Needed] ${team.label} — ${out.length} Linesheet item(s) due`,
        html,
      }),
    });

    results.push({
      team: team.id,
      outstanding: out.length,
      recipients: emails.length,
      sent: resp.ok,
      status: resp.status,
      ...(resp.ok ? {} : { body: await resp.text() }),
    });
  }

  return json({ ok: true, results });
});

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
