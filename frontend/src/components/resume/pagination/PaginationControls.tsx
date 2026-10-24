// SPDX-License-Identifier: Apache-2.0
/**
 * W08 分页设置区：条目级/板块级断页意图 + 续页信息 + 格式支持说明。
 *
 * ## 只写意图，不画假分页线
 *
 * 草稿预览是 CSS 连续流（不是分页媒体），手动断页在草稿里**结构性地看不到**。契约要求
 * 界面在控件旁常驻一句说明并引导用精确预览核对，**不许**为了让预览"看起来生效"而画
 * 假分页线。所以本组件不注入任何预览探针。
 *
 * ## 落点
 *
 * 写 `format_config.pagination`（W08-BE 唯一解析）；保存沿用宿主的版式保存链路。
 * 条目意图以稳定对象 id 为键，板块意图以板块键为键——不存下标/页码。
 *
 * ## 格式支持
 *
 * 若宿主传入 W11 的能力矩阵（`PreflightOut.capabilities`），按矩阵显示"手动分页/标题跟随/
 * 续页信息"在 HTML/PDF/Word 上的等级；没有矩阵时如实说明"以检查模块为准"，不另写判定。
 */
import { Alert, Flex, Select, Space, Switch, Tooltip, Typography } from "antd";
import { t, type MessageKey } from "../../../i18n";
import type { ResumeLayout } from "../../../types";
import {
  readPaginationDomain,
  setContinuation,
  setEntryBreak,
  setSectionBreak,
  type EntryBreak,
} from "../../../features/resume-pagination/paginationDomain";
import {
  FORMAT_LABEL_KEY,
  LEVEL_LABEL_KEY,
  parseCapabilities,
} from "../../../features/resume-preflight/capabilities";

/** 跟随行数候选：0（不跟随）/1–3（与后端 keep_with_next 0–3 同域）。 */
const KEEP_OPTIONS = [0, 1, 2, 3] as const;

/** 与分页最相关的矩阵能力键。 */
const CAPABILITY_KEYS = ["manual_page_break", "keep_with_next", "page_numbers"] as const;
const CAPABILITY_LABEL: Record<string, MessageKey> = {
  manual_page_break: "pagination.capability.entryBreak",
  keep_with_next: "pagination.capability.keepWithNext",
  page_numbers: "pagination.capability.pageNumbers",
};
const FORMATS = ["html", "pdf", "docx"] as const;

export interface PaginationSectionOption {
  key: string;
  label: string;
}

interface Props {
  layout: ResumeLayout;
  /** 选中的条目（有稳定 id 才显示条目级控件）。 */
  entry?: { id: string; label: string } | null;
  /** 板块级控件作用的板块（由宿主选中状态提供）。 */
  section?: string | null;
  onSectionChange?: (sectionKey: string) => void;
  sections?: PaginationSectionOption[];
  disabled?: boolean;
  /** W11 能力矩阵（原样字典）；不传时只显示"以检查模块为准"。 */
  capabilities?: Record<string, string> | null;
  onChange: (layout: ResumeLayout) => void;
}

function keepLabel(count: number): string {
  return count === 0
    ? t("pagination.keepWithNext.none")
    : t("pagination.keepWithNext.lines", { count });
}

/** 一条意图的两三个开关（条目/板块共用；板块不支持 allow_split）。 */
function BreakControls({
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

/** 能力矩阵 → "PDF 手动分页 不支持"这种短句（只列非 supported）。 */
function capabilityLines(capabilities: Record<string, string>): string[] {
  const matrix = parseCapabilities(capabilities);
  const lines: string[] = [];
  for (const capability of CAPABILITY_KEYS) {
    const cell = matrix.rows.find((row) => row.capability === capability);
    if (!cell) continue;
    const labelKey = CAPABILITY_LABEL[capability];
    const name = labelKey ? t(labelKey) : capability;
    for (const format of FORMATS) {
      const level = cell.levels[format] ?? "unknown";
      if (level === "supported") continue;
      const formatKey = FORMAT_LABEL_KEY[format];
      const formatLabel = formatKey ? t(formatKey) : format;
      lines.push(`${formatLabel} ${name} ${t(LEVEL_LABEL_KEY[level])}`);
    }
  }
  return lines;
}

export default function PaginationControls({
  layout,
  entry,
  section,
  onSectionChange,
  sections = [],
  disabled = false,
  capabilities,
  onChange,
}: Props) {
  const domain = readPaginationDomain(layout.format_config);
  const entryBreak = entry ? (domain?.entries[entry.id] ?? {}) : null;
  const sectionBreak = section ? (domain?.sections[section] ?? {}) : null;
  const continuation = domain?.continuation ?? {};
  const lines = capabilities ? capabilityLines(capabilities) : [];

  const update = (next: (config: ResumeLayout["format_config"]) => ResumeLayout["format_config"]) =>
    onChange({ ...layout, format_config: next(layout.format_config) });

  return (
    <section className="resume-pagination-panel" aria-label={t("pagination.group.title")}>
      <Alert type="info" showIcon title={t("pagination.draft.note")} />

      {entryBreak ? (
        <Flex vertical gap={4} data-testid="pagination-entry">
          <Space size={6}>
            <Typography.Text strong>{t("pagination.scope.entry")}</Typography.Text>
            <Typography.Text type="secondary">{entry?.label}</Typography.Text>
          </Space>
          <BreakControls
            value={entryBreak}
            disabled={disabled}
            allowSplit
            onChange={(changes) => update((config) => setEntryBreak(config, entry!.id, changes))}
          />
        </Flex>
      ) : null}

      {sections.length > 0 || sectionBreak ? (
        <Flex vertical gap={4} data-testid="pagination-section">
          <Space size={6} wrap>
            <Typography.Text strong>{t("pagination.scope.section")}</Typography.Text>
            {onSectionChange ? (
              <Select
                size="small"
                style={{ width: 150 }}
                value={section ?? undefined}
                placeholder={t("pagination.scope.sectionAria")}
                aria-label={t("pagination.scope.sectionAria")}
                options={sections.map((item) => ({ value: item.key, label: item.label }))}
                disabled={disabled}
                onChange={(next) => onSectionChange(next)}
              />
            ) : null}
          </Space>
          {section && sectionBreak !== null ? (
            <BreakControls
              value={sectionBreak}
              disabled={disabled}
              allowSplit={false}
              onChange={(changes) => update((config) => setSectionBreak(config, section, changes))}
            />
          ) : null}
        </Flex>
      ) : null}

      {!entryBreak && !section ? (
        <Typography.Text type="secondary">{t("pagination.scope.pick")}</Typography.Text>
      ) : null}

      <Flex vertical gap={4} data-testid="pagination-continuation">
        <Typography.Text strong>{t("pagination.continuation.title")}</Typography.Text>
        <Flex gap={12} wrap>
          <Space size={4}>
            <Switch
              size="small"
              checked={continuation.repeat_name === true}
              disabled={disabled}
              aria-label={t("pagination.continuation.repeatName")}
              onChange={(checked) =>
                update((config) => setContinuation(config, { repeat_name: checked }))
              }
            />
            <Typography.Text>{t("pagination.continuation.repeatName")}</Typography.Text>
          </Space>
          <Space size={4}>
            <Switch
              size="small"
              checked={continuation.page_numbers === true}
              disabled={disabled}
              aria-label={t("pagination.continuation.pageNumbers")}
              onChange={(checked) =>
                update((config) => setContinuation(config, { page_numbers: checked }))
              }
            />
            <Typography.Text>{t("pagination.continuation.pageNumbers")}</Typography.Text>
          </Space>
        </Flex>
        <Typography.Text type="secondary">{t("pagination.continuation.note")}</Typography.Text>
      </Flex>

      <Flex vertical gap={2} data-testid="pagination-capability">
        <Typography.Text strong>{t("pagination.capability.title")}</Typography.Text>
        {capabilities ? (
          lines.length > 0 ? (
            lines.map((line) => (
              <Typography.Text key={line} type="secondary">
                {line}
              </Typography.Text>
            ))
          ) : (
            <Typography.Text type="secondary">
              {t("pagination.capability.allSupported")}
            </Typography.Text>
          )
        ) : (
          <Typography.Text type="secondary">{t("pagination.capability.pending")}</Typography.Text>
        )}
      </Flex>
    </section>
  );
}
