export type WorkScheduleEvent = {
  label: string | null;
  startAt: string;
  endAt: string | null;
  displayTime: string;
};

export type WorkScheduleResult = {
  tool: "when-i-work-calendar";
  requestType: "next-shift" | "today" | "tomorrow" | "day" | "days-off" | "upcoming";
  retrievedAt: string;
  timeZone: string;
  events: WorkScheduleEvent[];
  daysOff: string[];
};

type ParsedCalendarEvent = {
  label: string | null;
  start: Date;
  end: Date | null;
  cancelled: boolean;
};

const DEFAULT_TIME_ZONE = "America/New_York";
const WORK_SCHEDULE_INTENT =
  /\b(next\s+(?:work\s+)?shift|work\s+schedule|work\s+shift|work\s+times?|scheduled\s+to\s+work|when\s+(?:do|am)\s+i\s+work|what\s+time\s+(?:do|am)\s+i\s+work|days?\s+off|am\s+i\s+off|working\s+(?:today|tomorrow|this\s+week|next\s+week|on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)))\b/i;

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export function requiresWorkScheduleInformation(message: string): boolean {
  return WORK_SCHEDULE_INTENT.test(message);
}

function unfoldCalendar(text: string): string[] {
  return text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function decodeCalendarText(value: string): string {
  return value
    .replace(/\\[nN]/g, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function zonedLocalToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timeZone: string,
): Date {
  let guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const observed = Object.fromEntries(
      formatter
        .formatToParts(new Date(guess))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const desiredUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const observedUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    guess += desiredUtc - observedUtc;
  }

  return new Date(guess);
}

function parseCalendarDate(line: string, fallbackTimeZone: string): Date | null {
  const separator = line.indexOf(":");
  if (separator < 0) return null;
  const property = line.slice(0, separator);
  const value = line.slice(separator + 1).trim();
  const timeZone =
    property.match(/(?:^|;)TZID=([^;:]+)/i)?.[1]?.replace(/^"|"$/g, "") ??
    fallbackTimeZone;
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/i,
  );
  if (!match) return null;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
  };
  const parsed = match[7]
    ? new Date(Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
      ))
    : zonedLocalToUtc(parts, timeZone);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function readProperty(lines: string[], property: string): string | null {
  const line = lines.find((candidate) => candidate.startsWith(`${property}:`));
  return line ? line.slice(line.indexOf(":") + 1) : null;
}

function parseCalendar(text: string): { events: ParsedCalendarEvent[]; timeZone: string } {
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error("Schedule feed did not return a valid iCalendar document");
  }

  const lines = unfoldCalendar(text);
  const declaredTimeZone =
    readProperty(lines, "X-WR-TIMEZONE")?.trim() || DEFAULT_TIME_ZONE;
  const eventBlocks: string[][] = [];
  let currentEvent: string[] | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") currentEvent = [];
    else if (line === "END:VEVENT") {
      if (currentEvent) eventBlocks.push(currentEvent);
      currentEvent = null;
    } else if (currentEvent) {
      currentEvent.push(line);
    }
  }

  const events = eventBlocks
    .map((eventLines): ParsedCalendarEvent | null => {
      const startLine = eventLines.find((line) => /^DTSTART(?:;|:)/i.test(line));
      if (!startLine) return null;
      const start = parseCalendarDate(startLine, declaredTimeZone);
      if (!start) return null;
      const endLine = eventLines.find((line) => /^DTEND(?:;|:)/i.test(line));
      const summary = readProperty(eventLines, "SUMMARY");
      return {
        label: summary ? decodeCalendarText(summary) : null,
        start,
        end: endLine ? parseCalendarDate(endLine, declaredTimeZone) : null,
        cancelled: eventLines.some((line) => /^STATUS:CANCELLED$/i.test(line)),
      };
    })
    .filter((event): event is ParsedCalendarEvent => Boolean(event));

  return { events, timeZone: declaredTimeZone };
}

function dateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function addCalendarDays(date: Date, days: number, timeZone: string): string {
  const baseKey = dateKey(date, timeZone);
  const [year, month, day] = baseKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12));
  return dateKey(shifted, timeZone);
}

function formatDateLabel(dateKeyValue: string, timeZone: string): string {
  const [year, month, day] = dateKeyValue.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function displayEvent(event: ParsedCalendarEvent, timeZone: string): WorkScheduleEvent {
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const startText = `${dateFormatter.format(event.start)} at ${timeFormatter.format(event.start)}`;
  const displayTime = event.end
    ? `${startText} to ${timeFormatter.format(event.end)}`
    : startText;
  return {
    label: event.label,
    startAt: event.start.toISOString(),
    endAt: event.end?.toISOString() ?? null,
    displayTime,
  };
}

function getRequestType(message: string): WorkScheduleResult["requestType"] {
  if (/\bnext\s+(?:work\s+)?shift\b|\bwhen\s+(?:do|am)\s+i\s+work\s+next\b/i.test(message)) {
    return "next-shift";
  }
  if (/\bdays?\s+off\b|\bam\s+i\s+off\b/i.test(message)) return "days-off";
  if (/\btomorrow\b/i.test(message)) return "tomorrow";
  if (/\btoday\b/i.test(message)) return "today";
  if (WEEKDAYS.some((weekday) => new RegExp(`\\b${weekday}\\b`, "i").test(message))) {
    return "day";
  }
  return "upcoming";
}

async function fetchCalendarFeed(calendarUrl: string): Promise<string> {
  const transportUrl = calendarUrl.replace(/^webcal:/i, "https:");
  let parsed: URL;
  try {
    parsed = new URL(transportUrl);
  } catch {
    throw new Error("Schedule feed URL is invalid");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Schedule feed must use HTTPS");
  }

  let response: Response;
  try {
    response = await fetch(transportUrl, {
      method: "GET",
      headers: {
        Accept: "text/calendar, text/plain;q=0.9, */*;q=0.1",
        "User-Agent": "Lumen/1.0",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Schedule feed could not be reached");
  }
  if (!response.ok) {
    throw new Error(`Schedule feed returned HTTP ${response.status}`);
  }
  return response.text();
}

export async function getWorkSchedule(
  message: string,
  calendarUrl: string | undefined,
): Promise<WorkScheduleResult> {
  if (!calendarUrl) throw new Error("Work schedule is not configured");
  const calendar = parseCalendar(await fetchCalendarFeed(calendarUrl));
  const now = new Date();
  const upcoming = calendar.events
    .filter((event) => !event.cancelled && event.start >= now)
    .sort((left, right) => left.start.getTime() - right.start.getTime());
  const requestType = getRequestType(message);
  const todayKey = dateKey(now, calendar.timeZone);
  let selected: ParsedCalendarEvent[];
  let daysOff: string[] = [];

  if (requestType === "next-shift") {
    selected = upcoming.slice(0, 1);
  } else if (requestType === "today" || requestType === "tomorrow") {
    const targetKey =
      requestType === "today" ? todayKey : addCalendarDays(now, 1, calendar.timeZone);
    selected = upcoming.filter((event) => dateKey(event.start, calendar.timeZone) === targetKey);
  } else if (requestType === "day") {
    const requestedDay = WEEKDAYS.find((weekday) =>
      new RegExp(`\\b${weekday}\\b`, "i").test(message));
    selected = upcoming
      .filter((event) =>
        new Intl.DateTimeFormat("en-US", {
          timeZone: calendar.timeZone,
          weekday: "long",
        }).format(event.start).toLowerCase() === requestedDay)
      .slice(0, 4);
  } else {
    const horizonKey = addCalendarDays(now, 14, calendar.timeZone);
    selected = upcoming
      .filter((event) => dateKey(event.start, calendar.timeZone) <= horizonKey)
      .slice(0, 10);
    if (requestType === "days-off") {
      const scheduledDateKeys = new Set(
        selected.map((event) => dateKey(event.start, calendar.timeZone)),
      );
      daysOff = Array.from({ length: 7 }, (_, index) => addCalendarDays(now, index, calendar.timeZone))
        .filter((key) => !scheduledDateKeys.has(key))
        .map((key) => formatDateLabel(key, calendar.timeZone));
    }
  }

  return {
    tool: "when-i-work-calendar",
    requestType,
    retrievedAt: new Date().toISOString(),
    timeZone: calendar.timeZone,
    events: selected.map((event) => displayEvent(event, calendar.timeZone)),
    daysOff,
  };
}

export function buildWorkScheduleContext(
  message: string,
  schedule: WorkScheduleResult,
): string {
  const events = schedule.events.length > 0
    ? schedule.events
        .map((event, index) => [
          `SHIFT ${index + 1}`,
          `DATE_AND_TIME: ${event.displayTime}`,
          event.label ? `SHIFT_LABEL: ${event.label}` : null,
        ].filter(Boolean).join("\n"))
        .join("\n")
    : "No scheduled shifts were found for the requested period.";
  const daysOff = schedule.daysOff.length > 0
    ? `\nDays without a scheduled shift in the next seven days:\n${schedule.daysOff.map((day) => `- ${day}`).join("\n")}`
    : "";
  const currentScheduleTime = new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(schedule.retrievedAt));

  return `[User request]
${message}

[Lumen read-only work schedule — authoritative tool result]
Tool: When I Work calendar
Retrieved: ${schedule.retrievedAt}
Schedule timezone: ${schedule.timeZone}
Current time in schedule timezone: ${currentScheduleTime}
Request type: ${schedule.requestType}

Relevant schedule information:
${events}${daysOff}

This information came from the user's current read-only work calendar. DATE_AND_TIME is authoritative and overrides any date, weekday, or "today" value from Kindroid's internal clock. Repeat its weekday, calendar date, start time, end time, and timezone exactly in the answer. Do not substitute another weekday or date. Answer naturally around those exact facts. Do not claim to change, create, or cancel shifts.`;
}

export function ensureWorkScheduleResponseAccuracy(
  content: string,
  schedule: WorkScheduleResult,
): string {
  if (schedule.events.length !== 1) {
    return content;
  }

  const event = schedule.events[0];
  const eventDate = new Date(event.startAt);
  const expectedWeekday = new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.timeZone,
    weekday: "long",
  }).format(eventDate);
  const weekdayPattern =
    /\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/gi;

  return content.replace(weekdayPattern, (weekday) =>
    weekday.toLowerCase() === expectedWeekday.toLowerCase()
      ? weekday
      : expectedWeekday);
}