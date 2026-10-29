// SPDX-License-Identifier: Apache-2.0
/**
 * 分页面板的**小块展示组件**（2026-10-25 从 `PaginationControls` 拆出，守 500 行预算）。
 *
 * 三块都与"写分页意图"无关：断页开关组、可折叠分组标题、一枚断页芯片。搬出来之后主组件
 * 只剩"读域 / 全局模式 / 分组组装"，行数回落到预算内；渲染与 aria 一字未变。
 * 能力矩阵短句是纯函数，另放 `paginationCapability.ts`（避免 fast-refresh 警告）。
 */
import { CloseOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { Button, Flex, Select, Space, Switch, Tooltip, Typography } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type {
  EntryBreak,
  PaginationContinuation,
} from "../../../features/resume-pagination/paginationDomain";

/** 跟随行数候选：0（默认：不显式设置，按模板处理）/1–3（与后端 keep_with_next 0–3 同域）。 */
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
        {/* 说明包在文字标签上（不是包 Select）：用户读文案时才知道"标题跟随"是干什么的。 */}
        <Tooltip title={t("pagination.keepWithNext.hint")}>
          <Typography.Text type="secondary">{t("pagination.keepWithNext")}</Typography.Text>
        </Tooltip>
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

/**
 * 续页信息（一行两个开关）。
 *
 * 拆到这里是为了守住 `PaginationControls` 的 500 行预算：它只是一组受控开关，
 * 语义（"只在精确 PDF / Word 生效"）由标题旁的 Tooltip 说明，与主组件的读域逻辑无关。
 */
export function ContinuationControls({
  value,
  disabled,
  onChange,
}: {
  value: PaginationContinuation;
  disabled: boolean;
  onChange: (changes: Partial<PaginationContinuation>) => void;
}) {
  useLocale();
  return (
    <Flex
      gap="6px 12px"
      wrap
      align="center"
      className="resume-pagination-continuation"
      data-testid="pagination-continuation"
    >
      <Flex gap={4} align="center">
        <span className="resume-pagination-label">{t("pagination.continuation.title")}</span>
        <Tooltip title={t("pagination.continuation.note")}>
          <InfoCircleOutlined
            className="resume-pagination-info"
            tabIndex={0}
            role="img"
            aria-label={t("pagination.continuation.note")}
          />
        </Tooltip>
      </Flex>
      <Space size={4}>
        <Switch
          size="small"
          checked={value.repeat_name === true}
          disabled={disabled}
          aria-label={t("pagination.continuation.repeatName")}
          onChange={(checked) => onChange({ repeat_name: checked })}
        />
        <Typography.Text>{t("pagination.continuation.repeatName")}</Typography.Text>
      </Space>
      <Space size={4}>
        <Switch
          size="small"
          checked={value.page_numbers === true}
          disabled={disabled}
          aria-label={t("pagination.continuation.pageNumbers")}
          onChange={(checked) => onChange({ page_numbers: checked })}
        />
        <Typography.Text>{t("pagination.continuation.pageNumbers")}</Typography.Text>
      </Space>
    </Flex>
  );
}

/**
 * 一枚「已设置断页」芯片：对象名 + 一个「×」。
 *
 * 板块芯片与条目芯片**同一个形状**（`.resume-pagination-break-chip`）：两层断页在同一份
 * 清单里并排列出，用户才能看出"哪几个板块、哪几条内容"各自从新页开始。清除按钮的
 * 无障碍名由调用方传入（板块说"板块断页"、条目说"条目断页"），本组件不含文案。
 */
export function BreakChip({
  label,
  clearLabel,
  disabled,
  onClear,
}: {
  label: string;
  clearLabel: string;
  disabled: boolean;
  onClear: () => void;
}) {
  return (
    <span className="resume-pagination-break-chip">
      <span className="resume-pagination-break-label">{label}</span>
      <Tooltip title={clearLabel}>
        <Button
          type="text"
          size="small"
          className="resume-pagination-break-clear"
          aria-label={clearLabel}
          icon={<CloseOutlined />}
          disabled={disabled}
          onClick={onClear}
        />
      </Tooltip>
    </span>
  );
}
