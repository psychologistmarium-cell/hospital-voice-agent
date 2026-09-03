# Setup guide — Hospital Reception Voice Agent

Everything marked **(you do this)** requires an account/credential only you can create — I can't sign up for services on your behalf. Everything else is already written; you just run it.

## 0. What you're building

```
Patient calls phone number OR WhatsApp
              │
              ▼
   Twilio number (voice + WhatsApp Business Calling)
              │
              ▼
   Vapi assistant (GPT-4o brain, Soniox STT, Azure Urdu/English TTS)
              │  when it needs to check/book/cancel/reschedule
              ▼
   Your webhook (server.js) ──► Google Calendar (the hospital's schedule)
```

## 1. Accounts to create (you do this)

| Service | Why | Get |
|---|---|---|
| [Vapi](https://vapi.ai) | Hosts the voice assistant | Sign up → Dashboard → API Keys → copy your **Private Key** |
| [Google Cloud](https://console.cloud.google.com) | Calendar API for bookings | New project → enable "Google Calendar API" |
| [Twilio](https://twilio.com) | Phone number + WhatsApp | Sign up → buy a **voice-capable** number |

## 2. Google Calendar service account (you do this)

1. In Google Cloud Console: **IAM & Admin → Service Accounts → Create Service Account**. Any name, e.g. `hospital-voice-agent`.
2. Create a JSON key for it and download it. Save it as `hospital-voice-agent/service-account.json` (already gitignored — never commit this file).
3. Open the hospital's Google Calendar → **Settings and sharing** → **Share with specific people** → add the service account's email (looks like `hospital-voice-agent@your-project.iam.gserviceaccount.com`) with **"Make changes to events"** permission.
4. Copy the Calendar ID (Settings → Integrate calendar → Calendar ID) into `.env` as `GOOGLE_CALENDAR_ID`.

## 3. Configure and run the backend

```bash
cd hospital-voice-agent
npm install
cp .env.example .env
```

Fill in `.env`:
- `GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./service-account.json`
- `GOOGLE_CALENDAR_ID=` (from step 2.4)
- `VAPI_TOOL_SECRET=` any long random string — this stops randoms on the internet from hitting your booking endpoints
- Adjust `TIMEZONE`, `CLINIC_OPEN_HOUR`, `CLINIC_CLOSE_HOUR`, `CLINIC_WORKING_DAYS`, `APPOINTMENT_DURATION_MINUTES` to match the hospital.

Run it locally to test:
```bash
npm start
```

Vapi needs to reach this server over the public internet. For quick testing use a tunnel:
```bash
npx ngrok http 3000
```
Note the `https://xxxx.ngrok-free.app` URL — that plus `/vapi/tools` is your `WEBHOOK_URL` (e.g. `https://xxxx.ngrok-free.app/vapi/tools`).

**For production**, deploy to Render (or Railway/Fly.io/a VPS) instead of ngrok — see the Render steps below.

### Deploying to Render

1. Push this repo to GitHub (already done: `github.com/psychologistmarium-cell/hospital-voice-agent`).
2. [render.com](https://render.com) → sign up with GitHub → **New + → Web Service** → select the repo.
3. Settings:
   - **Root Directory:** leave blank
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free (for testing)
4. **Environment** tab → add these variables:
   - `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` — open `service-account.json` in a text editor, copy the entire contents, paste as the value
   - `GOOGLE_CALENDAR_ID`, `TIMEZONE`, `APPOINTMENT_DURATION_MINUTES`, `CLINIC_OPEN_HOUR`, `CLINIC_CLOSE_HOUR`, `CLINIC_WORKING_DAYS`, `VAPI_TOOL_SECRET` — copy each value straight from your local `.env`
   - (`PORT` is set automatically by Render — don't add it yourself)
5. Deploy. Render gives you a permanent URL like `https://hospital-voice-agent-backend.onrender.com`. Your webhook URL for Vapi is that plus `/vapi/tools`.
6. Test it: `https://your-app.onrender.com/health` should return `{"ok":true}`.

**Free-tier caveat:** Render's free web services spin down after 15 minutes idle and take ~30-50s to wake on the next request. That's fine for testing, but unacceptable for a live phone call (the caller would hang up waiting). Before going live, upgrade to Render's cheapest paid tier (~$7/mo) so it stays warm.

## 4. Fill in the hospital details

Open [prompts/system-prompt.md](prompts/system-prompt.md) and replace every `[PLACEHOLDER]`:
hospital name, address, visiting hours, department list, emergency number. This text is what the AI actually says, so the more specific and accurate, the better it performs.

## 5. Create the Vapi assistant

```bash
cd hospital-voice-agent
VAPI_API_KEY=your_vapi_private_key \
WEBHOOK_URL=https://xxxx.ngrok-free.app/vapi/tools \
VAPI_TOOL_SECRET=same_value_as_in_env \
node vapi/create-assistant.js
```

This creates the assistant with the system prompt, all 4 booking tools wired to your webhook, Soniox transcriber, and an Azure Urdu voice — in one shot, instead of manually re-typing 4 tool JSON schemas into the dashboard UI.

Then open the assistant in the [Vapi dashboard](https://dashboard.vapi.ai):
- **Transcriber tab** — confirm provider is Soniox with multilingual/auto-detect on. Field names occasionally shift; the dashboard dropdown is the source of truth if the script's setting didn't stick.
- **Voice tab** — confirm the Azure Urdu voice is selected. Use the dashboard's "Talk to Assistant" test button, try a sentence in Urdu, one in English, and one mixed, and listen for quality. If `ur-PK-UzmaNeural` sounds off, try `ur-PK-AsadNeural` or test a couple of Azure's other multilingual voices — this is the one part worth spending 10 minutes A/B testing by ear.
- **Test the tools** — say "I'd like to book an appointment" in the web test call and confirm it actually calls your webhook (check your server logs) and creates a real Google Calendar event.

## 6. Connect a phone number

In Vapi dashboard → **Phone Numbers → Import Twilio Number**. You'll need:
- Twilio Account SID and Auth Token (Twilio Console → Account Info)
- The Twilio phone number you bought

Attach it to the "Hospital Reception Agent" assistant. Call it from your own phone to test end-to-end.

## 7. WhatsApp call pickup

This is a newer Twilio feature (WhatsApp Business Calling, launched late 2025), so budget extra time here and expect to iterate:

1. **(you do this)** Set up a WhatsApp sender on Twilio (Messaging → Senders → WhatsApp senders). Start with the Twilio Sandbox for WhatsApp to test quickly without approval delays.
2. **(you do this)** Apply for **WhatsApp Business Calling** on that sender — this requires Meta Business verification of the hospital, which only the hospital's authorized rep can complete (identity/business documents). This step can take days.
3. Once approved, Twilio routes inbound WhatsApp voice calls to the **same Voice URL/TwiML App** as a normal phone call on that number — so once it's enabled, the exact same Vapi assistant picks it up with no extra code from us. Point the WhatsApp Business Calling voice config at the same number you imported into Vapi in step 6.
4. Test by calling the hospital's WhatsApp number via the WhatsApp app's call button.

*If you also want the WhatsApp number to handle typed text messages (not just calls) as a chat-based receptionist, that's a separate, smaller feature (Twilio WhatsApp messaging webhook + Vapi's chat API or a simple GPT call reusing the same tools) — tell me if you want that added too, it wasn't part of what you asked for so I left it out.*

## 8. Test checklist before going live

- [ ] Book, cancel, and reschedule in English
- [ ] Book, cancel, and reschedule in Urdu
- [ ] Book with mixed Urdu/English mid-sentence
- [ ] Ask a general question (visiting hours, address)
- [ ] Say an emergency phrase ("chest pain", "ambulance") and confirm it redirects instead of booking
- [ ] Try booking a slot that's already taken — confirm it offers alternatives instead of double-booking
- [ ] Call from a real phone (not just the dashboard web test)
- [ ] Call the WhatsApp number once step 7 is approved

## 9. Costs to expect (rough, check current pricing before committing)

Per-minute: Vapi platform fee + Soniox STT + Azure TTS + GPT-4o + Twilio voice minutes, roughly $0.15–$0.30/min combined depending on providers chosen — plus Twilio's monthly number rental and WhatsApp Business Calling's own per-minute rate. Get exact current numbers from each provider's pricing page before rolling out, since these change.
