# Hospital Reception Voice Agent

Bilingual (Urdu/English) AI receptionist for phone and WhatsApp calls, built on [Vapi](https://vapi.ai) + Google Calendar + Twilio.

Handles: booking, cancelling, and rescheduling appointments, plus general hospital FAQs — in Urdu, English, or naturally mixed "Urdlish".

**Start here → [SETUP.md](SETUP.md)** for the full step-by-step build.

```
hospital-voice-agent/
├── server.js               # Webhook Vapi calls to run booking tools
├── lib/googleCalendar.js   # Google Calendar integration (availability, book/cancel/reschedule)
├── prompts/system-prompt.md # The assistant's persona + instructions (edit hospital details here)
├── vapi/create-assistant.js # Script that creates the Vapi assistant via API
├── .env.example             # Copy to .env and fill in
└── SETUP.md                 # Full walkthrough
```
