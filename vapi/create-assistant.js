// One-shot script that creates (or updates) the Vapi assistant via API,
// instead of hand-clicking through the dashboard for 4 tool schemas.
//
// Usage (reads VAPI_API_KEY, WEBHOOK_URL, VAPI_TOOL_SECRET from .env):
//   node vapi/create-assistant.js
// Or override any of them inline:
//   WEBHOOK_URL=https://your-server.com/vapi/tools node vapi/create-assistant.js
//
// After it runs, open the assistant in the Vapi dashboard and sanity-check
// the Transcriber tab (Soniox) and Voice tab (Azure) match what's described
// in SETUP.md -- exact provider field names occasionally change, and the
// dashboard is the source of truth if this script's shape has drifted.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const VAPI_TOOL_SECRET = process.env.VAPI_TOOL_SECRET;

if (!VAPI_API_KEY || !WEBHOOK_URL) {
  console.error("Set VAPI_API_KEY and WEBHOOK_URL env vars before running this script.");
  process.exit(1);
}

const systemPrompt = fs.readFileSync(
  path.join(__dirname, "..", "prompts", "system-prompt.md"),
  "utf8"
);

const toolServer = { url: WEBHOOK_URL, headers: VAPI_TOOL_SECRET ? { "x-vapi-tool-secret": VAPI_TOOL_SECRET } : undefined };

const tools = [
  {
    type: "function",
    function: {
      name: "check_availability",
      description: "Check open appointment slots on a given date.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date in YYYY-MM-DD format." },
        },
        required: ["date"],
      },
    },
    server: toolServer,
  },
  {
    type: "function",
    function: {
      name: "book_appointment",
      description: "Book a new appointment once the patient has agreed to a specific date and time.",
      parameters: {
        type: "object",
        properties: {
          patient_name: { type: "string" },
          phone_number: { type: "string", description: "Caller's phone number, confirmed out loud." },
          department: { type: "string", description: "Department or doctor, e.g. Cardiology." },
          reason: { type: "string", description: "Brief reason for visit, optional." },
          date: { type: "string", description: "YYYY-MM-DD" },
          time: { type: "string", description: "24h HH:MM, must be one returned by check_availability." },
        },
        required: ["patient_name", "phone_number", "date", "time"],
      },
    },
    server: toolServer,
  },
  {
    type: "function",
    function: {
      name: "cancel_appointment",
      description: "Cancel an existing appointment.",
      parameters: {
        type: "object",
        properties: {
          phone_number: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD of the appointment to cancel." },
        },
        required: ["phone_number", "date"],
      },
    },
    server: toolServer,
  },
  {
    type: "function",
    function: {
      name: "reschedule_appointment",
      description: "Move an existing appointment to a new date/time.",
      parameters: {
        type: "object",
        properties: {
          phone_number: { type: "string" },
          old_date: { type: "string", description: "YYYY-MM-DD of the current appointment." },
          new_date: { type: "string", description: "YYYY-MM-DD desired." },
          new_time: { type: "string", description: "24h HH:MM desired, must be open." },
        },
        required: ["phone_number", "old_date", "new_date", "new_time"],
      },
    },
    server: toolServer,
  },
];

const assistantPayload = {
  name: "Hospital Reception Agent",
  firstMessage:
    "Assalam-o-Alaikum! City Care Hospital mein khush aamdeed, main aapki AI receptionist hoon. Kya main aapki appointment book, cancel, ya reschedule karne mein madad karun?",
  model: {
    provider: "openai",
    model: "gpt-4o",
    messages: [{ role: "system", content: systemPrompt }],
    tools,
  },
  transcriber: {
    provider: "soniox",
    // Verify in dashboard: language/model field names for multilingual+Urdu
    // may differ slightly from this. Soniox's real-time model auto-detects
    // language and handles Urdu/English code-switching.
    language: "multi",
  },
  voice: {
    provider: "azure",
    voiceId: "ur-PK-UzmaNeural",
  },
  endCallMessage: "Allah Hafiz, apna khayal rakhiye ga.",
};

async function main() {
  const res = await fetch("https://api.vapi.ai/assistant", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(assistantPayload),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error("Vapi API error:", res.status, data);
    process.exit(1);
  }

  console.log("Assistant created:", data.id);
  console.log("Open it in the dashboard to review Transcriber/Voice settings and attach a phone number.");
}

main();
