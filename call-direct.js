/**
 * BluePeak Direct Dialer — calls Vapi's API directly, no server needed.
 * Zero dependencies. Uses only your local .env.
 *
 *   node call-direct.js +15551234567 "I'm following up on your onboarding documents."
 */

import fs from "fs";

for (const line of fs.readFileSync("./.env", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  if (k && !(k in process.env)) process.env[k] = t.slice(eq + 1).trim();
}

const { VAPI_API_KEY, VAPI_ASSISTANT_ID, VAPI_PHONE_NUMBER_ID } = process.env;
const [phone, ...contextParts] = process.argv.slice(2);
const context = contextParts.join(" ");

const problems = [];
if (!VAPI_API_KEY) problems.push("VAPI_API_KEY missing from .env");
if (!VAPI_ASSISTANT_ID) problems.push("VAPI_ASSISTANT_ID missing from .env");
if (!VAPI_PHONE_NUMBER_ID) problems.push("VAPI_PHONE_NUMBER_ID missing from .env");
if (!phone || !phone.startsWith("+"))
  problems.push('Usage: node call-direct.js +1XXXXXXXXXX "reason for the call"');
if (problems.length) {
  problems.forEach((p) => console.error("✗ " + p));
  process.exit(1);
}

const res = await fetch("https://api.vapi.ai/call", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${VAPI_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    assistantId: VAPI_ASSISTANT_ID,
    phoneNumberId: VAPI_PHONE_NUMBER_ID,
    customer: { number: phone },
    ...(context && {
      assistantOverrides: {
        firstMessage: `Hello, this is Zara calling from BluePeak Recruitments. ${context}`,
      },
    }),
  }),
});

const data = await res.json();
if (res.ok) {
  console.log(`✓ Calling ${phone} now — call ID: ${data.id}`);
  console.log("  Watch live: dashboard.vapi.ai → Calls. Transcript email after hangup.");
} else {
  console.error("✗ Vapi rejected the call:", JSON.stringify(data, null, 2));
}
