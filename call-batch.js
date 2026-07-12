/**
 * BluePeak Batch Dialer — your own campaign runner. Zero dependencies.
 * Works with the free Vapi number (unlike dashboard Campaigns).
 *
 * Usage:
 *   node call-batch.js contacts.csv "I'm following up on your application for the AI Data Annotator role."
 *
 * CSV format (header row required):
 *   number
 *   +15612642534
 *   +16463531875
 *
 * Calls each number in order, waiting 45 seconds between dials so
 * calls don't pile up. Press Ctrl+C anytime to stop the run.
 */

import fs from "fs";

/* Read .env */
for (const line of fs.readFileSync("./.env", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  if (k && !(k in process.env)) process.env[k] = t.slice(eq + 1).trim();
}

const { VAPI_API_KEY, VAPI_ASSISTANT_ID, VAPI_PHONE_NUMBER_ID } = process.env;
const [csvPath, ...contextParts] = process.argv.slice(2);
const context = contextParts.join(" ");
const DELAY_SECONDS = 45;

if (!csvPath || !fs.existsSync(csvPath)) {
  console.error('Usage: node call-batch.js contacts.csv "optional reason for the calls"');
  process.exit(1);
}
if (!VAPI_API_KEY || !VAPI_ASSISTANT_ID || !VAPI_PHONE_NUMBER_ID) {
  console.error("✗ VAPI_API_KEY, VAPI_ASSISTANT_ID, or VAPI_PHONE_NUMBER_ID missing from .env");
  process.exit(1);
}

/* Parse CSV: accepts headers number / phone / phoneNumber / phone_number */
const rows = fs.readFileSync(csvPath, "utf8").split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
const header = rows[0].toLowerCase().split(",").map((h) => h.trim());
const numIdx = header.findIndex((h) => ["number", "phone", "phonenumber", "phone_number"].includes(h));
if (numIdx === -1) {
  console.error(`✗ CSV needs a column named number/phone/phoneNumber. Found: ${rows[0]}`);
  process.exit(1);
}
const numbers = rows.slice(1).map((r) => r.split(",")[numIdx].trim()).filter((n) => n.startsWith("+"));

if (!numbers.length) {
  console.error("✗ No valid E.164 numbers found (each must start with +, e.g. +15551234567)");
  process.exit(1);
}

console.log(`Batch run: ${numbers.length} contact(s), ${DELAY_SECONDS}s between calls.`);
if (context) console.log(`Opening context: "${context}"`);
console.log("Press Ctrl+C to stop.\n");

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
let ok = 0, failed = 0;

for (let i = 0; i < numbers.length; i++) {
  const phone = numbers[i];
  process.stdout.write(`[${i + 1}/${numbers.length}] Calling ${phone} ... `);
  try {
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
      console.log(`✓ dialing (call ${data.id})`);
      ok++;
    } else {
      console.log(`✗ ${JSON.stringify(data.message || data)}`);
      failed++;
    }
  } catch (err) {
    console.log(`✗ ${err.message}`);
    failed++;
  }
  if (i < numbers.length - 1) await sleep(DELAY_SECONDS);
}

console.log(`\nDone: ${ok} dialed, ${failed} failed.`);
console.log("Transcript emails arrive as each call ends. Full logs: dashboard.vapi.ai → Calls.");
