/**
 * BluePeak Voice Agent — Standalone Setup (ZERO dependencies)
 * ------------------------------------------------------------
 * Works without npm install. Requires only Node 18+.
 *
 *    node setup-standalone.js
 *
 * Reads .env itself, creates the Vapi assistant from
 * vapi-assistant.json, and attaches the phone number.
 * (Database schema is assumed already imported via Supabase SQL Editor.)
 */

import fs from "fs";

/* ---------- Tiny built-in .env parser (replaces dotenv) ---------- */
function loadEnv(path = "./.env") {
  if (!fs.existsSync(path)) {
    console.error(`✗ No .env file found at ${path}`);
    console.error("  Make sure the file is named exactly .env and is in this folder.");
    process.exit(1);
  }
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const {
  VAPI_API_KEY,
  VAPI_SERVER_SECRET,
  SERVER_URL,
  ELEVENLABS_VOICE_ID,
  TRANSFER_NUMBER,
  PHONE_MODE = "buy",
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
} = process.env;

/* ---------- Preflight checks with friendly messages ---------- */
const missing = [];
if (!VAPI_API_KEY) missing.push("VAPI_API_KEY");
if (!SERVER_URL || SERVER_URL.includes("placeholder")) missing.push("SERVER_URL");
if (!ELEVENLABS_VOICE_ID) missing.push("ELEVENLABS_VOICE_ID");
if (!VAPI_SERVER_SECRET) missing.push("VAPI_SERVER_SECRET");
if (missing.length) {
  console.error(`✗ Missing in .env: ${missing.join(", ")}`);
  process.exit(1);
}

const VAPI = "https://api.vapi.ai";
const headers = {
  Authorization: `Bearer ${VAPI_API_KEY}`,
  "Content-Type": "application/json",
};

async function api(path, body) {
  const res = await fetch(`${VAPI}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path} failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  console.log("(Database schema step skipped — already imported via Supabase SQL Editor)\n");

  /* ---------- Create the assistant ---------- */
  console.log("→ Creating Vapi assistant...");
  const config = JSON.parse(fs.readFileSync("./vapi-assistant.json", "utf8"));

  config.voice.voiceId = ELEVENLABS_VOICE_ID;
  config.serverUrl = `${SERVER_URL}/webhook/vapi`;
  config.serverUrlSecret = VAPI_SERVER_SECRET;

  /* Vapi's API expects tools nested under model, not at the top level */
  if (config.tools) {
    config.model.tools = config.tools;
    delete config.tools;
  }
  const transferTool = (config.model.tools || []).find((t) => t.type === "transferCall");
  if (transferTool && TRANSFER_NUMBER) {
    transferTool.destinations[0].number = TRANSFER_NUMBER;
  }

  const assistant = await api("/assistant", config);
  console.log(`✓ Assistant created: ${assistant.id}\n`);

  /* ---------- Phone number ---------- */
  console.log(`→ Setting up phone number (mode: ${PHONE_MODE})...`);
  let phone;
  if (PHONE_MODE === "twilio") {
    phone = await api("/phone-number", {
      provider: "twilio",
      number: TWILIO_PHONE_NUMBER,
      twilioAccountSid: TWILIO_ACCOUNT_SID,
      twilioAuthToken: TWILIO_AUTH_TOKEN,
      assistantId: assistant.id,
      name: "BluePeak Main Line",
    });
  } else {
    phone = await api("/phone-number", {
      provider: "vapi",
      assistantId: assistant.id,
      name: "BluePeak Main Line",
    });
  }
  console.log(`✓ Phone number attached: ${phone.number || "(provisioning)"} — id: ${phone.id}\n`);

  /* ---------- Done ---------- */
  console.log("=".repeat(60));
  console.log("SETUP COMPLETE — add these to .env AND Render Environment:");
  console.log(`VAPI_ASSISTANT_ID=${assistant.id}`);
  console.log(`VAPI_PHONE_NUMBER_ID=${phone.id}`);
  console.log("=".repeat(60));
  console.log("\nNext: Vapi dashboard → Provider Keys → 11Labs → paste ElevenLabs API key");
  console.log("Then: Assistants → BluePeak → Talk → test her!");
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
