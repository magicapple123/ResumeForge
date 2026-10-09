import { Checkbox, Select, Space, Typography } from "antd";
import { memo, useMemo } from "react";

interface PartialDate {
  year: string;
  month: string;
  day: string;
  ongoing: boolean;
}

interface Props {
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  label: string;
  allowOngoing?: boolean;
  yearOnly?: boolean;
}

function parsePartialDate(value: string): PartialDate | null {
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

function daysInMonth(year: string, month: string): number {
  if (!year || !month) return 31;
  return new Date(Number(year), Number(month), 0).getDate();
}

/** 月选项固定 12 项：模块级常量，任何渲染都不再重建。 */
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => {
  const month = String(index + 1).padStart(2, "0");
  return { value: month, label: month };
});

function PartialDateSelectImpl({
  id,
  value = "",
  onChange,
  disabled = false,
  label,
  allowOngoing = false,
  yearOnly = false,
}: Props) {
  const parts = parsePartialDate(value);
  const selected = parts ?? { year: "", month: "", day: "", ongoing: false };
  // 年份范围几乎恒定（1900 → 当前年+15，已选年份更大时才外扩）。这个组件在「我的资料」
  // 里同时存在十几个、每次渲染重建 ~142 项 options 是编辑态卡顿的放大器之一（见
  // deliverables/profile-input-perf-audit-2026-10-09.md），useMemo 掉。
  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const minYear = Math.min(1900, Number(selected.year) || 1900);
    const maxYear = Math.max(currentYear + 15, Number(selected.year) || 0);
    return Array.from({ length: maxYear - minYear + 1 }, (_, index) => {
      const year = String(maxYear - index);
      return { value: year, label: year };
    });
  }, [selected.year]);
  const dayOptions = useMemo(
    () =>
      Array.from({ length: daysInMonth(selected.year, selected.month) }, (_, index) => {
        const day = String(index + 1).padStart(2, "0");
        return { value: day, label: day };
      }),
    [selected.year, selected.month],
  );
  const commit = (year: string, month: string, day: string) => {
    if (!year) {
      onChange?.("");
      return;
    }
    onChange?.(day ? `${year}-${month}-${day}` : month ? `${year}-${month}` : year);
  };
  const unsupported = value.trim() && !parts;

  return (
    <div className="profile-partial-date-select">
      <Space.Compact block className="profile-partial-date-select__controls">
        <Select
          id={id}
          aria-label={yearOnly ? label : `${label}年份`}
          value={selected.year || undefined}
          disabled={disabled || selected.ongoing}
          allowClear
          placeholder="年"
          options={years}
          onChange={(year?: string) => {
            const nextMonth = year && selected.month ? selected.month : "";
            const nextDay =
              nextMonth && Number(selected.day) <= daysInMonth(year ?? "", nextMonth)
                ? selected.day
                : "";
            commit(year ?? "", nextMonth, nextDay);
          }}
        />
        {!yearOnly && (
          <>
            <Select
              aria-label={`${label}月份`}
              value={selected.month || undefined}
              disabled={disabled || selected.ongoing || !selected.year}
              allowClear
              placeholder="月"
              options={MONTH_OPTIONS}
              onChange={(month?: string) => {
                const nextMonth = month ?? "";
                const nextDay =
                  nextMonth && Number(selected.day) <= daysInMonth(selected.year, nextMonth)
                    ? selected.day
                    : "";
                commit(selected.year, nextMonth, nextDay);
              }}
            />
            <Select
              aria-label={`${label}日期`}
              value={selected.day || undefined}
              disabled={disabled || selected.ongoing || !selected.year || !selected.month}
              allowClear
              placeholder="日"
              options={dayOptions}
              onChange={(day?: string) => commit(selected.year, selected.month, day ?? "")}
            />
          </>
        )}
      </Space.Compact>
      {allowOngoing ? (
        <Checkbox
          checked={selected.ongoing}
          disabled={disabled}
          style={{ marginTop: 6 }}
          onChange={(event) => onChange?.(event.target.checked ? "至今" : "")}
        >
          至今
        </Checkbox>
      ) : null}
      {unsupported ? (
        <Typography.Text type="warning" style={{ display: "block", marginTop: 4 }}>
          当前日期格式无法识别；请选择日期后保存，旧值暂时保留。
        </Typography.Text>
      ) : null}
    </div>
  );
}

/**
 * memo 比较器（导出为纯函数，便于单测）：这个组件同时存在十几个，调用方
 * （WebFormProfileField / WebFormProfileRecordGroup）每次渲染都新建内联 onChange，
 * 默认浅比较会全部失效——这里只按渲染结果相关的 props 比较，**故意忽略 onChange**：
 * 它的行为按字段收口、恒定不变，引用不稳定但语义等价。
 */
export function arePartialDatePropsEqual(previous: Props, next: Props): boolean {
  return (
    previous.value === next.value &&
    previous.disabled === next.disabled &&
    previous.label === next.label &&
    previous.allowOngoing === next.allowOngoing &&
    previous.yearOnly === next.yearOnly &&
    previous.id === next.id
  );
}

export default memo(PartialDateSelectImpl, arePartialDatePropsEqual);
