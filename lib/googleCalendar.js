const { google } = require("googleapis");

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const TIMEZONE = process.env.TIMEZONE || "Asia/Karachi";
const SLOT_MINUTES = Number(process.env.APPOINTMENT_DURATION_MINUTES || 30);
const OPEN_HOUR = Number(process.env.CLINIC_OPEN_HOUR || 9);
const CLOSE_HOUR = Number(process.env.CLINIC_CLOSE_HOUR || 17);
const WORKING_DAYS = (process.env.CLINIC_WORKING_DAYS || "1,2,3,4,5,6")
  .split(",")
  .map((d) => Number(d.trim()));

function getAuth() {
  // On a host like Render there's no local key file (it's gitignored), so the
  // key JSON is pasted directly into an env var instead. Locally, the file
  // path is simpler. Support both.
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON) {
    return new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON),
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
  }
  return new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
}

async function getCalendar() {
  const auth = getAuth();
  return google.calendar({ version: "v3", auth });
}

// Builds every candidate slot for a given YYYY-MM-DD, then removes ones that
// overlap existing events (via freebusy) or fall outside clinic hours.
async function listAvailableSlots(dateStr) {
  const calendar = await getCalendar();
  const dayStart = new Date(`${dateStr}T00:00:00`);
  const weekday = dayStart.getDay();

  if (!WORKING_DAYS.includes(weekday)) {
    return { open: false, slots: [] };
  }

  const timeMin = new Date(`${dateStr}T00:00:00`);
  const timeMax = new Date(`${dateStr}T23:59:59`);

  const fb = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: TIMEZONE,
      items: [{ id: CALENDAR_ID }],
    },
  });

  const busy = fb.data.calendars[CALENDAR_ID].busy.map((b) => ({
    start: new Date(b.start),
    end: new Date(b.end),
  }));

  const slots = [];
  for (let hour = OPEN_HOUR; hour < CLOSE_HOUR; hour += SLOT_MINUTES / 60) {
    const h = Math.floor(hour);
    const m = Math.round((hour - h) * 60);
    const slotStart = new Date(dateStr);
    slotStart.setHours(h, m, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + SLOT_MINUTES * 60000);

    const overlaps = busy.some((b) => slotStart < b.end && slotEnd > b.start);
    if (!overlaps && slotStart > new Date()) {
      slots.push(
        slotStart.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      );
    }
  }

  return { open: true, slots };
}

async function bookAppointment({ patientName, phoneNumber, department, reason, date, time }) {
  const calendar = await getCalendar();
  const start = new Date(`${date}T${time}:00`);
  const end = new Date(start.getTime() + SLOT_MINUTES * 60000);

  const event = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary: `Appointment: ${patientName}${department ? " - " + department : ""}`,
      description: [reason && `Reason: ${reason}`, `Booked via AI phone/WhatsApp receptionist`]
        .filter(Boolean)
        .join("\n"),
      start: { dateTime: start.toISOString(), timeZone: TIMEZONE },
      end: { dateTime: end.toISOString(), timeZone: TIMEZONE },
      extendedProperties: {
        private: {
          phoneNumber,
          patientName,
          department: department || "",
        },
      },
    },
  });

  return event.data;
}

async function findAppointmentsByPhone(phoneNumber, dateStr) {
  const calendar = await getCalendar();
  const timeMin = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  const timeMax = new Date(timeMin.getTime() + 1000 * 60 * 60 * 24 * (dateStr ? 1 : 60));

  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    privateExtendedProperty: [`phoneNumber=${phoneNumber}`],
    singleEvents: true,
    orderBy: "startTime",
  });

  return res.data.items || [];
}

async function cancelAppointment({ phoneNumber, date }) {
  const calendar = await getCalendar();
  const matches = await findAppointmentsByPhone(phoneNumber, date);
  if (matches.length === 0) return null;

  const target = matches[0];
  await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: target.id });
  return target;
}

async function rescheduleAppointment({ phoneNumber, oldDate, newDate, newTime }) {
  const calendar = await getCalendar();
  const matches = await findAppointmentsByPhone(phoneNumber, oldDate);
  if (matches.length === 0) return null;

  const target = matches[0];
  const start = new Date(`${newDate}T${newTime}:00`);
  const end = new Date(start.getTime() + SLOT_MINUTES * 60000);

  const updated = await calendar.events.patch({
    calendarId: CALENDAR_ID,
    eventId: target.id,
    requestBody: {
      start: { dateTime: start.toISOString(), timeZone: TIMEZONE },
      end: { dateTime: end.toISOString(), timeZone: TIMEZONE },
    },
  });

  return updated.data;
}

module.exports = {
  listAvailableSlots,
  bookAppointment,
  findAppointmentsByPhone,
  cancelAppointment,
  rescheduleAppointment,
};
