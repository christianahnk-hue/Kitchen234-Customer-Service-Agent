/**
 * Push updates from vapi-assistant.json to your EXISTING assistant.
 * Use this after editing the prompt/config instead of re-running setup.js
 * (which would create a duplicate assistant).
 *
 *   node update-assistant.js
 */
import fs from "fs";
import "dotenv/config";

const { VAPI_API_KEY, VAPI_ASSISTANT_ID, VAPI_SERVER_SECRET, SERVER_URL, ELEVENLABS_VOICE_ID, TRANSFER_NUMBER } = process.env;

if (!VAPI_ASSISTANT_ID) {
  console.error("VAPI_ASSISTANT_ID missing from .env — run setup.js first.");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync("./vapi-assistant.json", "utf8"));
config.voice.voiceId = ELEVENLABS_VOICE_ID || config.voice.voiceId;
config.serverUrl = `${SERVER_URL}/webhook/vapi`;
config.serverUrlSecret = VAPI_SERVER_SECRET;
/* Vapi's API expects tools nested under model, not at the top level */
if (config.tools) {
  config.model.tools = config.tools;
  delete config.tools;
}
const transferTool = (config.model.tools || []).find((t) => t.type === "transferCall");
if (transferTool && TRANSFER_NUMBER) transferTool.destinations[0].number = TRANSFER_NUMBER;

const res = await fetch(`https://api.vapi.ai/assistant/${VAPI_ASSISTANT_ID}`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${VAPI_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify(config),
});
const data = await res.json();
if (!res.ok) {
  console.error("Update failed:", JSON.stringify(data, null, 2));
  process.exit(1);
}
console.log(`✓ Assistant ${VAPI_ASSISTANT_ID} updated with latest config.`);
