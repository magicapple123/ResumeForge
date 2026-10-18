interface PartialDate {
  year: string;
  month: string;
  day: string;
  ongoing: boolean;
}

export interface PartialDateSelectProps {
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  label: string;
  allowOngoing?: boolean;
  yearOnly?: boolean;
}

export interface YearOption {
  value: string;
  label: string;
}

export interface YearOptionGroup {
  label: string;
  options: YearOption[];
}

function yearRange(from: number, to: number, step: 1 | -1): YearOption[] {
  const result: YearOption[] = [];
  for (let year = from; step > 0 ? year <= to : year >= to; year += step) {
    result.push({ value: String(year), label: String(year) });
  }
  return result;
}

/**
 * 年份选项按"当前年"分成两组（R9）。
 *
 * 原来是一个从 `当前年+15` 降序到 1900 的扁平列表，于是选出生年份的人第一眼看到的是
 * 2038、2037……要滚十几项才见到今年。分组后第一组第一项就是今年，未来年份退到第二组。
 * 已选年份仍按原来的外扩逻辑并进对应组：早于 1900 的放进"今年及以前"末尾，晚于
 * `当前年+15` 的放进"未来年份"末尾，历史脏数据不会变成"选不中的值"。
 *
 * 这里是纯函数（不读 `Date`），当前年由调用方传入，测试因此不依赖运行日期。
 */
export function buildYearGroups(currentYear: number, selectedYear: number): YearOptionGroup[] {
  const pastMinYear = Math.min(1900, selectedYear || 1900);
  const futureMaxYear = Math.max(currentYear + 15, selectedYear);
  return [
    { label: "今年及以前", options: yearRange(currentYear, pastMinYear, -1) },
    { label: "未来年份", options: yearRange(currentYear + 1, futureMaxYear, 1) },
  ];
}

export function parsePartialDate(value: string): PartialDate | null {
  const raw = value.trim();
  if (!raw) return { year: "", month: "", day: "", ongoing: false };
  if (
    ["至今", "现在", "目前", "在职", "在读", "present", "now", "current"].includes(
      raw.toLowerCase(),
    )
  ) {
    return { year: "", month: "", day: "", ongoing: true };
  }

  const normalized = raw
    .replace(/\s+/g, "")
    .replace(/年/g, "-")
    .replace(/月/g, "-")
    .replace(/日$/, "")
    .replace(/[./]/g, "-")
    .replace(/-+$/, "");
  const match = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(normalized);
  if (!match) return null;

  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : undefined;
  const day = match[3] ? Number(match[3]) : undefined;
  if (year < 1 || (month !== undefined && (month < 1 || month > 12))) return null;
  if (day !== undefined) {
    const daysInMonth = new Date(year, month!, 0).getDate();
    if (day < 1 || day > daysInMonth) return null;
  }
  return {
    year: match[1],
    month: month === undefined ? "" : String(month).padStart(2, "0"),
    day: day === undefined ? "" : String(day).padStart(2, "0"),
    ongoing: false,
  };
}

export function normalizePartialDate(value: string | undefined): string {
  const raw = value?.trim() ?? "";
  const parsed = parsePartialDate(raw);
  if (!parsed) return raw;
  if (parsed.ongoing) return "至今";
  if (!parsed.year) return "";
  if (!parsed.month) return parsed.year;
  if (!parsed.day) return `${parsed.year}-${parsed.month}`;
  return `${parsed.year}-${parsed.month}-${parsed.day}`;
}

/**
 * The date-field parents intentionally supply semantically stable inline onChange
 * callbacks. Keep their existing memo contract while isolating it from the UI export.
 */
export function arePartialDatePropsEqual(
  previous: PartialDateSelectProps,
  next: PartialDateSelectProps,
): boolean {
  return (
    previous.value === next.value &&
    previous.disabled === next.disabled &&
    previous.label === next.label &&
    previous.allowOngoing === next.allowOngoing &&
    previous.yearOnly === next.yearOnly &&
    previous.id === next.id
  );
}
