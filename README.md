# Kitchen234 Voice Agent — Nike

AI voice agent for **Kitchen234**, an authentic Nigerian restaurant in Austin, TX. **Nike** answers every call to the restaurant — takes orders, answers menu questions, checks order status, and handles complaints with warm Naija hospitality. Humans only step in on transfer.

Built on Vapi · Anthropic Claude · ElevenLabs · Supabase · Node.js.

## What Nike does

- 🍲 **Takes complete orders** — dishes, portion sizes, spice level ("Mild, medium, or proper Nigerian hot?"), pickup or delivery with address capture, then confirms with a `KIT-XXXXXX` order number and prep time
- 📖 **Answers menu questions** — searches the live menu in the database, quotes real prices and descriptions; never invents dishes
- 🔎 **Checks order status** — by order number or caller's phone, with time-remaining estimates
- 😔 **Resolves complaints** — empathetic intake, `K234-` ticket numbers, 2-hour team callback promise
- 🌙 **After-hours pre-orders** — outside 9 AM–9 PM Central, takes pre-orders queued for opening instead of losing the call
- ☎️ **Transfers to a human** — warm transfer to the manager's direct line on request or escalation
- 🚫 **Never guesses on allergens** — ingredient-safety questions become kitchen callbacks, not improvised answers
- 📤 **Outbound calls** — order-ready notifications and follow-ups via API, CLI, or batch CSV
- 📧 **Emails every call** — transcript, summary, duration, and recording link to the kitchen inbox

## AI-first call flow (Setup B)

The restaurant's existing phone number **forwards unconditionally** to Nike's Twilio number — customers keep dialing the number they know, Nike answers 100% of calls, and the kitchen phone stops interrupting cooking.

```
Customer dials the kitchen number
        │  (unconditional carrier forwarding)
        ▼
Nike answers (Vapi: Claude LLM · ElevenLabs Nigerian voice · Deepgram STT)
        │
        ├── order / menu / status / complaint → tools → this server → Supabase
        ├── "let me speak to a person"        → transfer to MANAGER DIRECT LINE
        │      (never the main number — it forwards back to Nike = loop)
        └── hangup → transcript saved + emailed
```

## Repo contents

| File | Purpose |
|---|---|
| `server.js` | Express webhook server: menu search, order placement, status, complaints, callbacks, transcript emails, outbound endpoint |
| `vapi-assistant.json` | Nike's full definition: personality, order-taking flow, tools, transfer rules, after-hours behavior |
| `schema.sql` | Postgres schema: `menu_items` (seeded), `orders`, `complaints`, `callbacks`, `calls` |
| `setup-standalone.js` | Zero-dependency provisioning via the Vapi API |
| `update-assistant.js` | Push config changes without creating duplicates |
| `call-direct.js` / `call-batch.js` | Outbound CLI: single call / CSV batch |
| `env.example` | Environment template (with the Setup B loop warning baked in) |

## Quick start

1. Create a **dedicated** Supabase project; run `schema.sql` in the SQL Editor (Run and enable RLS)
2. Buy a Twilio number; copy `env.example` → `.env` and fill credentials (`PHONE_MODE=twilio`)
3. Deploy this repo to Render; add the env vars; set `SERVER_URL` to the service URL
4. `node setup-standalone.js` — creates Nike and attaches the Twilio number
5. Vapi dashboard → Provider Keys → 11Labs (org-wide; skip if already set) — and put a Nigerian-accented voice ID in the assistant
6. Test by calling the Twilio number and placing a full order
7. **Cutover:** enable unconditional forwarding on the restaurant's existing number → the Twilio number (typically `*72` + number; reversible with `*73`)

## Menu management

Prices and dishes live in the `menu_items` table — edit them in Supabase's Table Editor and Nike quotes the new values on the very next call. No redeploy, no config change. Set `available = false` to 86 a dish.

## Stack

Vapi · Anthropic Claude · ElevenLabs (eleven_turbo_v2_5) · Deepgram nova-3 · Supabase Postgres · Express / Node 18+ · Resend · Render

---

*Private project — Kitchen234 LLC. Credentials are environment-only; never commit `.env`.*
