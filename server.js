require("dotenv").config();
const express = require("express");
const {
  listAvailableSlots,
  bookAppointment,
  cancelAppointment,
  rescheduleAppointment,
} = require("./lib/googleCalendar");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VAPI_TOOL_SECRET = process.env.VAPI_TOOL_SECRET;

app.get("/health", (req, res) => res.json({ ok: true }));

// Vapi posts here whenever the assistant invokes one of your custom tools.
// Docs: https://docs.vapi.ai/tools/custom-tools
app.post("/vapi/tools", async (req, res) => {
  if (VAPI_TOOL_SECRET) {
    const header = req.header("x-vapi-tool-secret");
    if (header !== VAPI_TOOL_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }

  const toolCalls =
    req.body?.message?.toolCallList ||
    req.body?.message?.toolCalls ||
    [];

  const results = await Promise.all(
    toolCalls.map(async (call) => {
      const id = call.id;
      const name = call.name || call.function?.name;
      const args = call.arguments || call.function?.arguments || {};

      try {
        const result = await runTool(name, args);
        return { toolCallId: id, result: JSON.stringify(result) };
      } catch (err) {
        console.error(`Tool ${name} failed:`, err);
        return { toolCallId: id, result: `Error: ${err.message}` };
      }
    })
  );

  res.status(200).json({ results });
});

async function runTool(name, args) {
  switch (name) {
    case "check_availability": {
      const { date } = args;
      const { open, slots } = await listAvailableSlots(date);
      if (!open) return { available: false, message: "Clinic is closed on this date." };
      if (slots.length === 0) return { available: false, message: "No open slots on this date." };
      return { available: true, slots };
    }

    case "book_appointment": {
      const { patient_name, phone_number, department, reason, date, time } = args;
      const { open, slots } = await listAvailableSlots(date);
      if (!open || !slots.includes(time)) {
        return { success: false, message: `That slot is not available. Open slots: ${slots.join(", ") || "none"}` };
      }
      const event = await bookAppointment({
        patientName: patient_name,
        phoneNumber: phone_number,
        department,
        reason,
        date,
        time,
      });
      return { success: true, message: `Booked for ${patient_name} on ${date} at ${time}.`, eventId: event.id };
    }

    case "cancel_appointment": {
      const { phone_number, date } = args;
      const cancelled = await cancelAppointment({ phoneNumber: phone_number, date });
      if (!cancelled) return { success: false, message: "No matching appointment found." };
      return { success: true, message: "Appointment cancelled." };
    }

    case "reschedule_appointment": {
      const { phone_number, old_date, new_date, new_time } = args;
      const { open, slots } = await listAvailableSlots(new_date);
      if (!open || !slots.includes(new_time)) {
        return { success: false, message: `New slot not available. Open slots: ${slots.join(", ") || "none"}` };
      }
      const updated = await rescheduleAppointment({
        phoneNumber: phone_number,
        oldDate: old_date,
        newDate: new_date,
        newTime: new_time,
      });
      if (!updated) return { success: false, message: "No existing appointment found to reschedule." };
      return { success: true, message: `Rescheduled to ${new_date} at ${new_time}.` };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

app.listen(PORT, () => {
  console.log(`Hospital voice agent backend listening on port ${PORT}`);
});
