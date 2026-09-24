import { randomUUID } from "node:crypto";

export const ASSISTANT_TRACE_HEADER = "x-assistant-trace-id";
export const ASSISTANT_TRACE_VERSION = "assistant-trace-v1";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveAssistantTraceId(candidate?: string): string {
  return candidate && UUID_PATTERN.test(candidate) ? candidate : randomUUID();
}

export function redactAssistantTraceText(value: string, limit: number): string {
  return value
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(authorization|api[_ -]?key|token|secret|password)\b\s*[:=]\s*["']?[^"',\s;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /([?&](?:access_token|api[_-]?key|token|key|secret|signature|sig|auth)=)[^&#\s]*/gi,
      "$1[REDACTED]",
    )
    .replace(/https?:\/\/[^\s)]+/gi, (url) =>
      url.replace(/([?&](?:access_token|api[_-]?key|token|key|secret|signature|sig|auth)=)[^&#\s]*/gi, "$1[REDACTED]"),
    )
    .slice(0, limit);
}

export function summarizeAssistantTraceError(error: unknown) {
  const candidate =
    error && typeof error === "object"
      ? (error as { name?: unknown; message?: unknown; status?: unknown })
      : null;
  const status =
    typeof candidate?.status === "number" ? candidate.status : undefined;

  return {
    errorName:
      typeof candidate?.name === "string" ? candidate.name : "UnknownError",
    ...(status === undefined ? {} : { status }),
    ...(typeof candidate?.message === "string"
      ? { message: redactAssistantTraceText(candidate.message, 180) }
      : {}),
  };
}