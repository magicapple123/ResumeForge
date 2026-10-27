// SPDX-License-Identifier: Apache-2.0
import { Checkbox, Select, Space, Typography } from "antd";
import { memo, useEffect, useMemo, useRef } from "react";
import {
  arePartialDatePropsEqual,
  buildYearGroups,
  parsePartialDate,
  type PartialDateSelectProps as Props,
} from "./partialDate";
import "../../styles/partialDate.css";

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
  disabled,
  label,
  allowOngoing = false,
  yearOnly = false,
}: Props) {
  const parts = parsePartialDate(value);
  const selected = parts ?? { year: "", month: "", day: "", ongoing: false };
  /**
   * 取消勾选「至今」时要恢复的那个日期。
   *
   * 勾选前组件收到的最后一个**具体日期**（非「至今」、非空）记在这里：勾上「至今」会把
   * 年月日三个下拉一起锁住、值也被替换成「至今」，取消时若不还回去就只能写空——
   * 用户实测 2004-11-10 勾上再取消，值变空（原值被"至今"吞了）。
   *
   * 用 ref 而不是 state：它不参与渲染，只做"上一次的值"这一件事；跟着 `value` 走，
   * 因此外部改写（切条目、撤销、服务端刷新）也会同步过来。从来没有具体值时保持空串，
   * 取消勾选就是空——与勾选前的状态一致。
   */
  const lastConcreteRef = useRef("");
  useEffect(() => {
    if (!selected.ongoing && value.trim()) lastConcreteRef.current = value;
  }, [value, selected.ongoing]);
  // 年份范围几乎恒定（1900 → 当前年+5，已选年份更大时才外扩），分两组渲染。这个组件在
  // 「我的资料」里同时存在十几个、每次渲染重建 ~130 项 options 是编辑态卡顿的放大器之一
  // （见 deliverables/profile-input-perf-audit-2026-10-09.md），useMemo 掉。
  const years = useMemo(
    () => buildYearGroups(new Date().getFullYear(), Number(selected.year) || 0),
    [selected.year],
  );
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

  // 禁用语义：只有存在**明确禁用原因**（调用方传了 disabled、或"至今"锁年月、
  // 年/月尚未选锁下级）时才传 true；否则传 undefined——antd Select 的合并规则是
  // `mergedDisabled = customDisabled ?? contextDisabled`，显式传 false 会覆盖
  // Form/ConfigProvider 层的禁用上下文（「我的资料」非编辑态日期仍可改的根因）。
  const yearDisabled = disabled || selected.ongoing || undefined;
  const monthDayDisabled = disabled || selected.ongoing || !selected.year || undefined;

  return (
    <div className="profile-partial-date-select">
      <Space.Compact block className="profile-partial-date-select__controls">
        <Select
          id={id}
          aria-label={yearOnly ? label : `${label}年份`}
          value={selected.year || undefined}
          disabled={yearDisabled}
          allowClear
          placeholder="年"
          options={years}
          // 弹层高度给足：过去一组（今年 → 1900）很长，"未来年份"在它后面。320px 大致能
          // 一屏看到当前年附近十几项，滚一下就能摸到未来 5 年，不必盲滚。
          listHeight={320}
          // 弹出层按选项内容自适应，不跟随被压窄的控件：否则「2024」会被控件宽度
          // 截成「20」，用户看不出自己选的是哪一年。
          popupMatchSelectWidth={false}
          // antd 6 起 popupClassName 已废弃，改走 classNames.popup.root
          // （样式在 styles/partialDate.css，给年份弹层一个最小宽度兜底）。
          classNames={{ popup: { root: "profile-year-select-popup" } }}
          // 控件本身也要留住最小宽度（Space.Compact 等分时会把它压到几十像素）。
          style={{ minWidth: 80 }}
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
              disabled={monthDayDisabled}
              allowClear
              placeholder="月"
              options={MONTH_OPTIONS}
              popupMatchSelectWidth={false}
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
              disabled={monthDayDisabled || !selected.month || undefined}
              allowClear
              placeholder="日"
              options={dayOptions}
              popupMatchSelectWidth={false}
              onChange={(day?: string) => commit(selected.year, selected.month, day ?? "")}
            />
          </>
        )}
      </Space.Compact>
      {allowOngoing ? (
        <Checkbox
          className="profile-partial-date-select__ongoing"
          checked={selected.ongoing}
          disabled={disabled || undefined}
          onChange={(event) =>
            // 取消勾选恢复勾选前的具体日期（不是置空）：见 `lastConcreteRef` 的说明。
            onChange?.(event.target.checked ? "至今" : lastConcreteRef.current)
          }
        >
          至今
        </Checkbox>
      ) : null}
      {unsupported ? (
        <Typography.Text type="warning" style={{ flexBasis: "100%", marginTop: 4 }}>
          当前日期格式无法识别；请选择日期后保存，旧值暂时保留。
        </Typography.Text>
      ) : null}
    </div>
  );
}

export default memo(PartialDateSelectImpl, arePartialDatePropsEqual);
