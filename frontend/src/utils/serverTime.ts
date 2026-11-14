// SPDX-License-Identifier: Apache-2.0
/**
 * 服务端时间戳的**唯一渲染入口**。
 *
 * ## 为什么需要它
 *
 * 后端所有 `*_at` 字段都是 **naive UTC**：`backend/app/models/profile.py` 里的
 * `utcnow()` 返回 `datetime.now(UTC).replace(tzinfo=None)`，pydantic 直出成
 * `"2026-11-03T15:50:11"`——**不带偏移量**。而前端两条旧写法都把它当本地时间：
 *
 * 1. `new Date("2026-11-03T15:50:11")`：ECMAScript 规定"无偏移按本地时区解析"，
 *    于是 UTC 15:50 被读成东八区 15:50（早 8 小时）；
 * 2. `value.replace("T", " ").slice(0, 16)`：连解析都没有，直接显示 UTC 墙上时间
 *    （同样早 8 小时，且跨日时连日期都错）。
 *
 * 因此这里统一做「**补 Z → 按设备时区格式化**」，存量数据不用改。
 *
 * ## 边界：只服务系统时间戳
 *
 * 用户自己填的"墙上时间"（简历起止年月、资料里的日期文本、只到日的 `posted_at`）
 * **不得**经过本工具——它们是没有时区的日历文本，套时区会整体错位。
 *
 * ## 格式为什么手写
 *
 * 输出固定 `YYYY-MM-DD HH:mm`（与旧的 16 位一致）。不用 `toLocaleString()` 的默认
 * 格式：它会带英文月份、随浏览器 locale 变，快照与测试都会"谁跑谁红"。
 */

/** 已带偏移量（`Z` / `+08:00` / `+0800`）时不再追加，否则会拼出 `...ZZ`。 */
const OFFSET_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** `Intl.DateTimeFormat` 建实例不便宜，按 timeZone 缓存（键 `""` = 设备时区）。 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? "";
  const cached = FORMATTERS.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    // h23 而不是 hour12:false：后者在部分 ICU 版本上把午夜给成 "24"。
    hourCycle: "h23",
  });
  FORMATTERS.set(key, created);
  return created;
}

interface ClockParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

function readParts(date: Date, timeZone: string | undefined): ClockParts {
  const found: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(date)) {
    if (part.type !== "literal") found[part.type] = part.value;
  }
  return {
    year: found.year ?? "0000",
    month: found.month ?? "01",
    day: found.day ?? "01",
    hour: found.hour ?? "00",
    minute: found.minute ?? "00",
    second: found.second ?? "00",
  };
}

export interface FormatServerTimeOptions {
  /** 输出到秒（`YYYY-MM-DD HH:mm:ss`）；缺省只到分钟。 */
  seconds?: boolean;
  /** 只输出日期（`YYYY-MM-DD`），给表格日期列用。 */
  dateOnly?: boolean;
  /**
   * 显式指定时区（IANA 名）。缺省 = 设备时区，这也是产品行为。
   * 只给测试用：断言必须显式传，否则会随跑测试那台机器的 `TZ` 漂。
   */
  timeZone?: string;
}

/**
 * 解析服务端时间戳：无偏移量时按 **UTC** 解释（补 `Z`，幂等）。
 *
 * @returns 解析失败返回 `null`
 */
export function parseServerTime(value: string): Date | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  const date = new Date(OFFSET_SUFFIX.test(text) ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 把服务端时间戳按设备时区渲染成 `YYYY-MM-DD HH:mm`（可选到秒 / 只到日）。
 *
 * 无法解析时**原样返回**输入，避免界面上出现 "Invalid Date"。
 */
export function formatServerTime(value: string, options: FormatServerTimeOptions = {}): string {
  const date = parseServerTime(value);
  if (!date) return value;
  const parts = readParts(date, options.timeZone);
  const dateText = `${parts.year}-${parts.month}-${parts.day}`;
  if (options.dateOnly) return dateText;
  const clock = options.seconds
    ? `${parts.hour}:${parts.minute}:${parts.second}`
    : `${parts.hour}:${parts.minute}`;
  return `${dateText} ${clock}`;
}


/**
 * 秒级时间戳 → 本地日期字符串（只给"到期/过期"这类只显示日期的场景）。
 *
 * 服务端预算里发的是 epoch 秒（如录像 7 天保留期的 `expires_at`），不是 ISO 串，
 * 所以不能走 `formatServerTime`；但"裸 `new Date(...).toLocaleDateString()` 散落在页面里"
 * 同样会让 `serverTime.guard` 变红——这里收口一份，页面只调它。
 */
export function formatEpochDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString();
}
