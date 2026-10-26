// SPDX-License-Identifier: Apache-2.0
/**
 * 分页面板的**小块展示组件**（2026-10-25 从 `PaginationControls` 拆出，守 500 行预算）。
 *
 * 两块都与"写分页意图"无关：断页开关组与可折叠分组标题。搬出来之后主组件只剩
 * "读域 / 全局模式 / 分组组装"，行数回落到预算内；渲染与 aria 一字未变。
 * 能力矩阵短句是纯函数，另放 `paginationCapability.ts`（避免 fast-refresh 警告）。
 */
import { Flex, Select, Space, Switch, Tooltip, Typography } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { EntryBreak } from "../../../features/resume-pagination/paginationDomain";

/** 跟随行数候选：0（不跟随）/1–3（与后端 keep_with_next 0–3 同域）。 */
const KEEP_OPTIONS = [0, 1, 2, 3] as const;

function keepLabel(count: number): string {
  return count === 0
    ? t("pagination.keepWithNext.none")
    : t("pagination.keepWithNext.lines", { count });
}

/** 一条意图的两三个开关（条目/板块共用；板块不支持 allow_split）。 */
export function BreakControls({
  value,
  disabled,
  allowSplit,
  onChange,
}: {
  value: EntryBreak;
  disabled: boolean;
  allowSplit: boolean;
  onChange: (
    next: Partial<Record<"break_before" | "keep_with_next" | "allow_split", unknown>>,
  ) => void;
}) {
  useLocale();
  return (
    <Flex gap={12} wrap align="center">
      <Space size={4}>
        <Tooltip title={t("pagination.breakBefore.hint")}>
          <Switch
            size="small"
            checked={value.break_before === "page"}
            disabled={disabled}
            aria-label={t("pagination.breakBefore")}
            onChange={(checked) => onChange({ break_before: checked ? "page" : null })}
          />
        </Tooltip>
        <Typography.Text>{t("pagination.breakBefore")}</Typography.Text>
      </Space>
      <Space size={4}>
        <Typography.Text type="secondary">{t("pagination.keepWithNext")}</Typography.Text>
        <Select
          size="small"
          style={{ width: 118 }}
          value={typeof value.keep_with_next === "number" ? value.keep_with_next : 0}
          disabled={disabled}
          aria-label={t("pagination.keepWithNext.aria", { label: t("pagination.keepWithNext") })}
          options={KEEP_OPTIONS.map((count) => ({ value: count, label: keepLabel(count) }))}
          onChange={(next) => onChange({ keep_with_next: next === 0 ? null : next })}
        />
      </Space>
      {allowSplit ? (
        <Space size={4}>
          <Tooltip title={t("pagination.allowSplit.hint")}>
            <Switch
              size="small"
              checked={value.allow_split === true}
              disabled={disabled}
              aria-label={t("pagination.allowSplit")}
              onChange={(checked) => onChange({ allow_split: checked ? true : null })}
            />
          </Tooltip>
          <Typography.Text>{t("pagination.allowSplit")}</Typography.Text>
        </Space>
      ) : null}
    </Flex>
  );
}

/** 可折叠小分组标题：12px/600 secondary，与参数栏的区块小标题同一档。 */
export function SubGroupLabel({ text, extra }: { text: string; extra?: string }) {
  return (
    <Flex gap={8} align="center" wrap>
      <span className="resume-pagination-sublabel">{text}</span>
      {extra ? <span className="resume-pagination-help">{extra}</span> : null}
    </Flex>
  );
}
