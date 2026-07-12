/**
 * Kitchen234 — Voice Agent Server (Nike)
 * ---------------------------------------
 * Same architecture as the BluePeak server:
 *   POST /webhook/vapi  → Nike's tool calls + end-of-call reports
 *   POST /outbound      → trigger outbound calls
 *   GET  /health        → health check
 *
 * Deploy as its OWN Render service with its OWN Supabase project.
 * Env vars: DATABASE_URL, VAPI_API_KEY, VAPI_ASSISTANT_ID,
 * VAPI_PHONE_NUMBER_ID, VAPI_SERVER_SECRET, OUTBOUND_API_KEY,
 * RESEND_API_KEY, NOTIFY_EMAIL, EMAIL_FROM, SERVER_URL
 */

import express from "express";
import pg from "pg";
import crypto from "crypto";
import "dotenv/config";

const {
  DATABASE_URL,
  VAPI_API_KEY,
  VAPI_ASSISTANT_ID,
  VAPI_PHONE_NUMBER_ID,
  VAPI_SERVER_SECRET,
  OUTBOUND_API_KEY,
  RESEND_API_KEY,
  NOTIFY_EMAIL,
  EMAIL_FROM = "Kitchen234 Nike <onboarding@resend.dev>",
  PORT = 3000,
} = process.env;

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});

const app = express();
app.use(express.json({ limit: "5mb" }));

function verifyVapiSecret(req, res, next) {
  const secret = req.headers["x-vapi-secret"];
  if (!VAPI_SERVER_SECRET || secret === VAPI_SERVER_SECRET) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

async function emailReport({ direction, callerPhone, duration, summary, transcript, recordingUrl, endedReason }) {
  if (!RESEND_API_KEY || !NOTIFY_EMAIL) return;
  try {
    const mins = duration ? `${Math.floor(duration / 60)}m ${duration % 60}s` : "unknown";
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: NOTIFY_EMAIL.split(",").map((e) => e.trim()),
        subject: `[Kitchen234] ${direction} call ${callerPhone || "unknown"} — ${mins}`,
        html: `
          <h2 style="font-family:sans-serif">Kitchen234 Call Report</h2>
          <table style="font-family:sans-serif;font-size:14px">
            <tr><td><b>Direction:</b></td><td>${direction}</td></tr>
            <tr><td><b>Caller:</b></td><td>${callerPhone || "unknown"}</td></tr>
            <tr><td><b>Duration:</b></td><td>${mins}</td></tr>
            <tr><td><b>Ended:</b></td><td>${endedReason || "n/a"}</td></tr>
            ${recordingUrl ? `<tr><td><b>Recording:</b></td><td><a href="${recordingUrl}">Listen</a></td></tr>` : ""}
          </table>
          <h3 style="font-family:sans-serif">Summary</h3>
          <p style="font-family:sans-serif;font-size:14px">${summary || "No summary available."}</p>
          <h3 style="font-family:sans-serif">Transcript</h3>
          <pre style="font-family:monospace;font-size:13px;white-space:pre-wrap;background:#f6f6f6;padding:12px;border-radius:6px">${(transcript || "None").replace(/</g, "&lt;")}</pre>
        `,
      }),
    });
  } catch (err) {
    console.error("Report email failed:", err.message);
  }
}

/* ------------------------------------------------------------------ */
/* Nike's tools                                                         */
/* ------------------------------------------------------------------ */
const toolHandlers = {
  async search_menu({ keyword }) {
    const params = [];
    let where = "available = true";
    if (keyword) {
      params.push(`%${keyword}%`);
      where += ` AND (name ILIKE $1 OR description ILIKE $1 OR tags ILIKE $1 OR category ILIKE $1)`;
    }
    const { rows } = await pool.query(
      `SELECT name, category, price_small, price_large, description
         FROM menu_items WHERE ${where}
        ORDER BY CASE category WHEN 'best_seller' THEN 0 ELSE 1 END, name
        LIMIT 6`,
      params
    );
    if (!rows.length) return { found: false, message: "No matching dishes right now. Offer the best sellers instead." };
    return {
      found: true,
      dishes: rows.map((d) => ({
        name: d.name,
        category: d.category.replace(/_/g, " "),
        price:
          d.price_small && d.price_large
            ? `$${d.price_small} small, $${d.price_large} large`
            : `$${d.price_small ?? d.price_large}`,
        description: d.description,
      })),
    };
  },

  async place_order({ customer_name, customer_phone, items, fulfillment, delivery_address, notes }) {
    if (fulfillment === "delivery" && !delivery_address) {
      return { success: false, message: "Delivery address is required for delivery orders — ask the caller for it." };
    }
    const est = fulfillment === "delivery" ? 55 : 35;
    const { rows } = await pool.query(
      `INSERT INTO orders (customer_name, customer_phone, items, fulfillment, delivery_address, notes, estimated_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING order_number, estimated_minutes`,
      [customer_name, customer_phone, JSON.stringify(items), fulfillment, delivery_address || null, notes || null, est]
    );
    return {
      success: true,
      order_number: rows[0].order_number,
      estimated_minutes: rows[0].estimated_minutes,
      message: `Order confirmed. Number ${rows[0].order_number}, ready in about ${rows[0].estimated_minutes} minutes.`,
    };
  },

  async check_order_status({ order_number, phone }) {
    let query, param;
    if (order_number) {
      query = `SELECT order_number, status, estimated_minutes, created_at FROM orders WHERE upper(order_number) = upper($1)`;
      param = order_number;
    } else if (phone) {
      query = `SELECT order_number, status, estimated_minutes, created_at FROM orders WHERE customer_phone = $1 ORDER BY created_at DESC LIMIT 1`;
      param = phone;
    } else {
      return { found: false, message: "Ask for the order number or the phone number used." };
    }
    const { rows } = await pool.query(query, [param]);
    if (!rows.length) return { found: false, message: "No order found. Double-check the number, or offer to take a fresh order." };
    const o = rows[0];
    const mins = Math.max(0, o.estimated_minutes - Math.round((Date.now() - new Date(o.created_at)) / 60000));
    return {
      found: true,
      order_number: o.order_number,
      status: o.status.replace(/_/g, " "),
      estimated_minutes_remaining: o.status === "completed" ? 0 : mins,
    };
  },

  async log_complaint({ caller_phone, caller_name, order_number, category, severity, description }) {
    const { rows } = await pool.query(
      `INSERT INTO complaints (caller_name, caller_phone, order_number, category, severity, description)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ticket_number`,
      [caller_name || null, caller_phone, order_number || null, category, severity, description]
    );
    return {
      success: true,
      ticket_number: rows[0].ticket_number,
      message: `Complaint logged, ticket ${rows[0].ticket_number}. The team will call within 2 hours.`,
    };
  },

  async schedule_callback({ caller_phone, reason }) {
    await pool.query(`INSERT INTO callbacks (caller_phone, reason) VALUES ($1,$2)`, [caller_phone, reason || null]);
    return { success: true, message: "Callback scheduled — the kitchen team will reach out shortly." };
  },
};

/* ------------------------------------------------------------------ */
/* Webhook                                                              */
/* ------------------------------------------------------------------ */
app.post("/webhook/vapi", verifyVapiSecret, async (req, res) => {
  const msg = req.body?.message;
  if (!msg) return res.status(400).json({ error: "No message" });

  try {
    if (msg.type === "tool-calls") {
      const results = [];
      for (const tc of msg.toolCallList || []) {
        const name = tc.function?.name || tc.name;
        const args =
          typeof tc.function?.arguments === "string"
            ? JSON.parse(tc.function.arguments)
            : tc.function?.arguments || tc.arguments || {};
        let result;
        try {
          const handler = toolHandlers[name];
          result = handler ? await handler(args) : { error: `Unknown tool: ${name}` };
        } catch (err) {
          console.error(`Tool ${name} failed:`, err);
          result = { error: "That action failed — apologize and offer a callback." };
        }
        results.push({ toolCallId: tc.id, result: JSON.stringify(result) });
      }
      return res.json({ results });
    }

    if (msg.type === "end-of-call-report") {
      const call = msg.call || {};
      const artifact = msg.artifact || {};
      const callerPhone = call.customer?.number || msg.customer?.number || null;
      const started = call.startedAt ? new Date(call.startedAt) : null;
      const ended = call.endedAt ? new Date(call.endedAt) : null;
      const duration = started && ended ? Math.round((ended - started) / 1000) : null;

      await pool.query(
        `INSERT INTO calls (vapi_call_id, direction, caller_phone, started_at, ended_at,
                            duration_secs, ended_reason, was_transferred, transcript, summary, recording_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (vapi_call_id) DO UPDATE SET
           ended_at = EXCLUDED.ended_at, duration_secs = EXCLUDED.duration_secs,
           ended_reason = EXCLUDED.ended_reason, transcript = EXCLUDED.transcript,
           summary = EXCLUDED.summary, recording_url = EXCLUDED.recording_url`,
        [
          call.id || crypto.randomUUID(),
          call.type === "outboundPhoneCall" ? "outbound" : "inbound",
          callerPhone, started, ended, duration,
          msg.endedReason || null,
          (msg.endedReason || "").includes("transfer"),
          artifact.transcript || msg.transcript || null,
          msg.analysis?.summary || msg.summary || null,
          artifact.recordingUrl || msg.recordingUrl || null,
        ]
      );

      await emailReport({
        direction: call.type === "outboundPhoneCall" ? "outbound" : "inbound",
        callerPhone, duration,
        summary: msg.analysis?.summary || msg.summary || null,
        transcript: artifact.transcript || msg.transcript || null,
        recordingUrl: artifact.recordingUrl || msg.recordingUrl || null,
        endedReason: msg.endedReason || null,
      });

      return res.json({ received: true });
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

/* ------------------------------------------------------------------ */
/* Outbound                                                             */
/* ------------------------------------------------------------------ */
app.post("/outbound", async (req, res) => {
  if (OUTBOUND_API_KEY && req.headers["x-api-key"] !== OUTBOUND_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const { phone, context } = req.body || {};
  if (!phone) return res.status(400).json({ error: "phone is required" });
  try {
    const resp = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: { Authorization: `Bearer ${VAPI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        assistantId: VAPI_ASSISTANT_ID,
        phoneNumberId: VAPI_PHONE_NUMBER_ID,
        customer: { number: phone },
        ...(context && {
          assistantOverrides: {
            firstMessage: `Good day! This is Nike calling from Kitchen234. ${context}`,
          },
        }),
      }),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json(data);
    return res.json({ success: true, callId: data.id });
  } catch (err) {
    console.error("Outbound error:", err);
    return res.status(500).json({ error: "Failed to place call" });
  }
});

app.get("/", (_req, res) => res.send("Kitchen234 Voice Agent (Nike) — online"));
app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Kitchen234 agent server running on port ${PORT}`));
