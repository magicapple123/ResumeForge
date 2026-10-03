/** 前端本地诊断事件：只保留脱敏的错误与状态，不上传简历内容。 */

const MAX_EVENTS = 100;
const SENSITIVE_KEY = /token|secret|password|passwd|api.?key|cookie|email|phone|value/i;
const events: Array<{ at: string; event: string; details: Record<string, unknown> }> = [];

function safe(value: unknown): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 160)}…` : value;
  return String(value);
}

export function recordClientDiagnostic(event: string, details: Record<string, unknown> = {}): void {
  events.push({
    at: new Date().toISOString(),
    event,
    details: Object.fromEntries(
      Object.entries(details).map(([key, value]) => [
        key,
        SENSITIVE_KEY.test(key) ? "<redacted>" : safe(value),
      ]),
    ),
  });
  while (events.length > MAX_EVENTS) events.shift();
}

export function clientDiagnosticSnapshot(): typeof events {
  return events.slice();
}
