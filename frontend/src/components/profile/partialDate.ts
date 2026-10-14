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
