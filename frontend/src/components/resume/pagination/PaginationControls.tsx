// SPDX-License-Identifier: Apache-2.0
/**
 * W08 分页设置区：**板块分页方式（全局）+ 逐板块/条目级断页意图 + 续页信息 + 页缩略图**。
 *
 * ## 为什么把「板块分页方式」做成显式全局控件（2026-10-25）
 *
 * 精确模式下板块**默认自然续排**：只有给某个板块显式设了「从新页开始」才会断页。
 * 旧界面把这个开关藏在"先在板块选择器里选一个板块才出现"的控件里，用户既看不到已设的
 * 断页、也清不掉——多页简历第一页大量留白时无从判断原因。现在：
 *
 * - 全局 `Segmented` 直接回答"整份简历按模块断开（每板块新页）还是自然填充"，
 *   默认值与真实行为一致（自然填充）；部分板块有断页时在下方用一句小结点名数量；
 * - 已设置的板块断页以芯片列出，可逐个清除，也可「恢复自然分页」一键清全部；
 * - 逐板块微调（选择器 + 断页/标题跟随开关）与条目级开关收进可折叠分组，默认不占高度。
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
 * 这属于低频参考信息，收进可折叠分组，不抢主流程的高度。
 */
import { CloseOutlined, InfoCircleOutlined } from "@ant-design/icons";
import {
  Button,
  Collapse,
  Flex,
  Segmented,
  Select,
  Space,
  Switch,
  Tooltip,
  Typography,
} from "antd";
import { useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ResumeLayout } from "../../../types";
import {
  clearSectionsBreakBefore,
  countManualBreaks,
  readPaginationDomain,
  sectionPaginationMode,
  setContinuation,
  setEntryBreak,
  setSectionBreak,
  setSectionsBreakBefore,
  type SectionPaginationMode,
} from "../../../features/resume-pagination/paginationDomain";
import PageThumbnailStrip from "./PageThumbnailStrip";
import { capabilityLines } from "./paginationCapability";
import { BreakControls, SubGroupLabel } from "./paginationParts";
import "./pagination.css";

/** 两个可折叠分组 + 格式支持分组的 key（Collapse 受控值）。 */
const SECTION_SETTINGS_KEY = "sections";
const ENTRY_SETTINGS_KEY = "entry";
const CAPABILITY_KEY = "capability";

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
  /**
   * 「有内容」的板块键（可选）。全局「每板块新页」的**派生判定**只看这些板块：
   * 空板块没有断页不应把整份简历判成"自然填充"。不传时退回 sections 全量
   * （宿主还没接内容时行为不变）；**写入 / 清除**始终作用于 sections 全量，
   * 因为空板块写断页在导出端是无害的（见 paginationDomain.setSectionsBreakBefore）。
   */
  activeSections?: readonly string[];
  disabled?: boolean;
  /** W11 能力矩阵（原样字典）；不传时只显示"以检查模块为准"。 */
  capabilities?: Record<string, string> | null;
  onChange: (layout: ResumeLayout) => void;
}

export default function PaginationControls({
  layout,
  entry,
  section,
  onSectionChange,
  sections = [],
  activeSections,
  disabled = false,
  capabilities,
  onChange,
}: Props) {
  useLocale();
  const domain = readPaginationDomain(layout.format_config);
  const entryBreak = entry ? (domain?.entries[entry.id] ?? {}) : null;
  const sectionBreak = section ? (domain?.sections[section] ?? {}) : null;
  const continuation = domain?.continuation ?? {};
  const lines = capabilities ? capabilityLines(capabilities) : [];

  // 条目级分组在"换成另一条"时自动展开（新选中对象的控件要能一眼看到），
  // 用户手动收起后同一对象内保持收起——不用 effect 同步，避免多一轮渲染。
  const [closedEntryId, setClosedEntryId] = useState<string | null>(null);
  const entryActiveKeys = entry && closedEntryId !== entry.id ? [ENTRY_SETTINGS_KEY] : [];

  const sectionKeys = sections.map((item) => item.key);
  const sectionLabels: Record<string, string> = {};
  for (const item of sections) sectionLabels[item.key] = item.label;
  const labelOf = (key: string) => sectionLabels[key] ?? key;
  // 派生判定只看「有内容」的板块（宿主可选传入）；写入/清除仍是全量板块清单。
  const activeKeySet = activeSections ? new Set(activeSections) : null;
  const consideredKeys = activeKeySet
    ? sectionKeys.filter((key) => activeKeySet.has(key))
    : sectionKeys;
  const mode = sectionPaginationMode(
    domain,
    consideredKeys.length > 0 ? consideredKeys : sectionKeys,
  );
  const sectionBreakCount = countManualBreaks(domain).sections;
  // 芯片只列**真正设了断页**的板块；残留的已删板块键用原键名兜底展示（仍可清除）。
  const sectionBreakKeys = Object.keys(domain?.sections ?? {}).filter(
    (key) => domain?.sections[key]?.break_before === "page",
  );

  const update = (next: (config: ResumeLayout["format_config"]) => ResumeLayout["format_config"]) =>
    onChange({ ...layout, format_config: next(layout.format_config) });

  /** 全局「板块分页方式」：写/清板块级断页；条目级意图一律不碰。 */
  const changeMode = (next: SectionPaginationMode) => {
    if (next === mode) return;
    if (next === "page") {
      if (sectionKeys.length === 0) return;
      update((config) => setSectionsBreakBefore(config, sectionKeys));
      return;
    }
    if (sectionBreakCount === 0) return;
    update(clearSectionsBreakBefore);
  };

  const clearOneSectionBreak = (key: string) =>
    update((config) => setSectionBreak(config, key, { break_before: null }));

  const restoreNaturalPagination = () => {
    if (sectionBreakCount === 0) return;
    update(clearSectionsBreakBefore);
  };

  return (
    <section className="resume-pagination-panel" aria-label={t("pagination.group.title")}>
      {/* 草稿说明弱化为一行：它解释「为什么草稿里看不到断页」，不需要 Alert 的视觉重量。 */}
      <Flex gap={6} align="flex-start" className="resume-pagination-note">
        <InfoCircleOutlined className="resume-pagination-note-icon" />
        <span className="resume-pagination-note-text">{t("pagination.draft.note")}</span>
      </Flex>

      {sections.length > 0 ? (
        <div className="resume-pagination-group" data-testid="pagination-mode">
          <Flex gap={8} align="center" wrap>
            <span className="resume-pagination-label">{t("pagination.mode.title")}</span>
            <Segmented
              size="small"
              value={mode}
              disabled={disabled}
              aria-label={t("pagination.mode.aria")}
              options={[
                { value: "flow", label: t("pagination.mode.flow") },
                { value: "page", label: t("pagination.mode.page") },
              ]}
              onChange={(next) => changeMode(next as SectionPaginationMode)}
            />
          </Flex>
          <span className="resume-pagination-help">{t("pagination.mode.note")}</span>
          {mode === "flow" && sectionBreakCount > 0 ? (
            <span className="resume-pagination-help" data-testid="pagination-mode-partial">
              {t("pagination.mode.partial", { count: sectionBreakCount })}
            </span>
          ) : null}
        </div>
      ) : null}

      {sectionBreakCount > 0 ? (
        <div className="resume-pagination-group" data-testid="pagination-section-breaks">
          <Flex gap={8} align="center" wrap>
            <span className="resume-pagination-label">{t("pagination.breaks.title")}</span>
            <Tooltip title={t("pagination.breaks.restoreHint")}>
              <Button
                size="small"
                type="link"
                className="resume-pagination-restore"
                disabled={disabled}
                onClick={restoreNaturalPagination}
              >
                {t("pagination.breaks.restore")}
              </Button>
            </Tooltip>
          </Flex>
          <Flex gap={6} wrap className="resume-pagination-break-list">
            {sectionBreakKeys.map((key) => (
              <span key={key} className="resume-pagination-break-chip">
                <span className="resume-pagination-break-label">{labelOf(key)}</span>
                <Tooltip title={t("pagination.breaks.clearOne", { label: labelOf(key) })}>
                  <Button
                    type="text"
                    size="small"
                    className="resume-pagination-break-clear"
                    aria-label={t("pagination.breaks.clearOne", { label: labelOf(key) })}
                    icon={<CloseOutlined />}
                    disabled={disabled}
                    onClick={() => clearOneSectionBreak(key)}
                  />
                </Tooltip>
              </span>
            ))}
          </Flex>
        </div>
      ) : null}

      {sections.length > 0 ? (
        <Collapse
          ghost
          size="small"
          className="resume-pagination-subgroup"
          items={[
            {
              key: SECTION_SETTINGS_KEY,
              label: (
                <SubGroupLabel
                  text={t("pagination.sections.settings")}
                  extra={
                    sectionBreakCount > 0
                      ? t("pagination.sections.summary", { count: sectionBreakCount })
                      : undefined
                  }
                />
              ),
              children: (
                <Flex vertical gap={8} data-testid="pagination-section">
                  {onSectionChange ? (
                    <Select
                      size="small"
                      style={{ width: "100%", maxWidth: 220 }}
                      value={section ?? undefined}
                      placeholder={t("pagination.scope.sectionAria")}
                      aria-label={t("pagination.scope.sectionAria")}
                      options={sections.map((item) => ({ value: item.key, label: item.label }))}
                      disabled={disabled}
                      onChange={(next) => onSectionChange(next)}
                    />
                  ) : null}
                  {section ? (
                    <BreakControls
                      value={sectionBreak ?? {}}
                      disabled={disabled}
                      allowSplit={false}
                      onChange={(changes) =>
                        update((config) => setSectionBreak(config, section, changes))
                      }
                    />
                  ) : (
                    <span className="resume-pagination-help">{t("pagination.sections.pick")}</span>
                  )}
                </Flex>
              ),
            },
          ]}
        />
      ) : null}

      {entry ? (
        <div data-testid="pagination-entry">
          <Collapse
            ghost
            size="small"
            className="resume-pagination-subgroup"
            activeKey={entryActiveKeys}
            onChange={(keys) => {
              const open = (keys as string[]).includes(ENTRY_SETTINGS_KEY);
              setClosedEntryId(open ? null : entry.id);
            }}
            items={[
              {
                key: ENTRY_SETTINGS_KEY,
                label: (
                  <SubGroupLabel
                    text={t("pagination.entry.title")}
                    extra={entry.label || undefined}
                  />
                ),
                children: (
                  <BreakControls
                    value={entryBreak ?? {}}
                    disabled={disabled}
                    allowSplit
                    onChange={(changes) =>
                      update((config) => setEntryBreak(config, entry.id, changes))
                    }
                  />
                ),
              },
            ]}
          />
        </div>
      ) : null}

      {/* 页缩略图自包含：订阅 W08 报告快照，不需要 shell 额外传参。 */}
      <PageThumbnailStrip />

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

      <Collapse
        ghost
        size="small"
        className="resume-pagination-subgroup"
        items={[
          {
            key: CAPABILITY_KEY,
            label: <SubGroupLabel text={t("pagination.capability.title")} />,
            children: (
              <Flex vertical gap={2} data-testid="pagination-capability">
                {capabilities ? (
                  lines.length > 0 ? (
                    lines.map((line) => (
                      <span key={line} className="resume-pagination-help">
                        {line}
                      </span>
                    ))
                  ) : (
                    <span className="resume-pagination-help">
                      {t("pagination.capability.allSupported")}
                    </span>
                  )
                ) : (
                  <span className="resume-pagination-help">
                    {t("pagination.capability.pending")}
                  </span>
                )}
              </Flex>
            ),
          },
        ]}
      />
    </section>
  );
}
