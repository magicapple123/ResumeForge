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
 * - 已设置的断页以芯片列出（**板块级与条目级同列**），可逐个清除，也可「恢复自然分页」
 *   一键清全部板块断页（条目级不动，所以另有逐条清除）；
 * - 逐板块微调（选择器 + 断页/标题跟随开关）与条目级开关收进可折叠分组，默认不占高度。
 *
 * ## 条目级断页为什么也要在清单里（2026-10-29）
 *
 * 条目级控件只在"选中这一条"时出现，而「恢复自然分页」明确不碰条目级：用户设过某条断页、
 * 又选了别的内容之后，那条设置既看不见也清不掉（精确预览里却看得见那处断页）。所以已设置
 * 清单必须同时列出条目级，并把"恢复自然分页不会清它"写在旁边。
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
 * 续页信息"在 HTML/PDF/Word 上的等级；没有矩阵时如实说明"先做一次检查才有矩阵"（并指出
 * 去哪做），不另写判定。这属于低频参考信息，收进可折叠分组，不抢主流程的高度。
 */
import { InfoCircleOutlined } from "@ant-design/icons";
import { App as AntApp, Button, Collapse, Flex, Segmented, Select, Tooltip } from "antd";
import { useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ResumeLayout } from "../../../types";
import {
  clearSectionsBreakBefore,
  countManualBreaks,
  pruneStalePagination,
  readPaginationDomain,
  sectionPaginationMode,
  setContinuation,
  setEntryBreak,
  setSectionBreak,
  setSectionsBreakBefore,
  type SectionPaginationMode,
} from "../../../features/resume-pagination/paginationDomain";
import type { PaginationEntryOption } from "../../../features/resume-pagination/paginationEntryLabels";
import PageThumbnailStrip from "./PageThumbnailStrip";
import { capabilityLines } from "./paginationCapability";
import { BreakChip, BreakControls, ContinuationControls, SubGroupLabel } from "./paginationParts";
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
  /**
   * 正文里**全部**可设断页的条目（可选）。只用来给「已设置断页」清单里的条目芯片取名：
   * 用户设过断页的条目可能早已不在当前选中范围内，光靠 `entry` 取不到名字。
   *
   * 数据源必须是 `paginationEntryOptions`（W4 七个分区 + skills）。拿 W4 的条目下拉清单
   * 直接喂（`FIELD_LAYOUT_SECTIONS`，不含 skills），会让技能条目的芯片落到
   * `pagination.breaks.unknownEntry`「已删除的条目」——内容明明还在。
   */
  entries?: PaginationEntryOption[];
  /**
   * 正文里**仍然存在**的条目 id（可选）。传了就表示"可以核对"：每次改写分页意图前先把
   * 指向已删条目的残留意图裁掉（`pruneStalePagination`），否则用户删了条目、芯片却再也
   * 清不掉。不传 = 不裁（宿主还没接内容时行为不变）。
   */
  validEntryIds?: readonly string[];
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
  /** W11 能力矩阵（原样字典）；不传时只说明"先做一次检查才有矩阵"。 */
  capabilities?: Record<string, string> | null;
  onChange: (layout: ResumeLayout) => void;
}

export default function PaginationControls({
  layout,
  entry,
  entries = [],
  validEntryIds,
  section,
  onSectionChange,
  sections = [],
  activeSections,
  disabled = false,
  capabilities,
  onChange,
}: Props) {
  useLocale();
  // 二次确认用 App 上下文的 modal（与其它不可撤销操作同一套反馈口径）。
  const { modal } = AntApp.useApp();
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
  // 条目芯片的名字来源：宿主给的「全部条目」。查不到（条目已被删）时用一句兜底文案，
  // 而不是把 id 摊给用户看——那条断页仍然要能清掉。
  const entryLabels: Record<string, string> = {};
  for (const item of entries) entryLabels[item.id] = item.label;
  const labelOfEntry = (id: string) =>
    entryLabels[id] || t("pagination.breaks.unknownEntry");
  // 派生判定只看「有内容」的板块（宿主可选传入）；写入/清除仍是全量板块清单。
  const activeKeySet = activeSections ? new Set(activeSections) : null;
  const consideredKeys = activeKeySet
    ? sectionKeys.filter((key) => activeKeySet.has(key))
    : sectionKeys;
  const mode = sectionPaginationMode(
    domain,
    consideredKeys.length > 0 ? consideredKeys : sectionKeys,
  );
  // 全量计数：回答"还有没有断页"以及"切回自然填充会清掉几个"（含残留的已删板块键）。
  const sectionBreakCount = countManualBreaks(domain).sections;
  // 芯片只列**真正设了断页**的板块；残留的已删板块键用原键名兜底展示（仍可清除）。
  const sectionBreakKeys = Object.keys(domain?.sections ?? {}).filter(
    (key) => domain?.sections[key]?.break_before === "page",
  );
  // 条目级断页：与板块级并列列出。以前只在"选中这条"时才看得见，设过就再也找不到，
  // 「恢复自然分页」又明确不碰条目级——于是用户既看不见也清不掉。
  const entryBreakKeys = Object.keys(domain?.entries ?? {}).filter(
    (key) => domain?.entries[key]?.break_before === "page",
  );
  const entryBreakCount = entryBreakKeys.length;
  // 小结/折叠头用**有内容板块**的计数：空板块写了断页也不该说成"4 个板块从新页开始"。
  const activeBreakCount = consideredKeys.filter(
    (key) => domain?.sections[key]?.break_before === "page",
  ).length;

  /**
   * 裁剪用的两份"活对象清单"。
   *
   * 两侧**独立**判断"这一侧到底知不知道清单"：不知道就把**现有键**当成有效键（等价于不裁这一
   * 侧），不要用"另一侧有没有清单"去连带决定。以前两者 AND 在一起，于是宿主不传板块清单
   * （只读宿主/没拿到模板目录）时，条目残留永远裁不掉——那正是"用户删了条目、芯片却清不掉"
   * 这一类问题的另一半。条目清单为空同样按"不知道"处理：`content` 可空，空清单更可能是正文
   * 还没加载到宿主，而误裁是静默且不可撤销的（残留仍会以芯片列出、可逐条清）。
   */
  const prunableEntryIds =
    validEntryIds && validEntryIds.length > 0
      ? validEntryIds
      : Object.keys(domain?.entries ?? {});
  const prunableSectionKeys =
    sectionKeys.length > 0 ? sectionKeys : Object.keys(domain?.sections ?? {});

  const update = (next: (config: ResumeLayout["format_config"]) => ResumeLayout["format_config"]) =>
    onChange({
      ...layout,
      // 先裁掉指向已删条目/板块的残留意图，再改：否则"删了条目 → 芯片还在 → 点了也没东西
      // 可写"会一直循环。
      format_config: next(
        pruneStalePagination(layout.format_config, prunableEntryIds, prunableSectionKeys),
      ),
    });

  /**
   * 清掉**全部板块**断页前先确认。
   *
   * 「切回自然填充」这一下会一次抹掉所有板块的「从新页开始」且不可撤销——用户对它的
   * 心理模型往往只是"换一种排法"，不是"删掉我设过的 4 个断页"。条目级意图与续页信息
   * 不受影响，这句也写在确认文案里，免得用户以为连带清掉了别的。
   */
  const confirmClearSectionsBreakBefore = () => {
    const clear = () => update(clearSectionsBreakBefore);
    // 极少数宿主没套 antd `<App>`（诊断页/单测）：没有 modal 时照旧直接执行，
    // 不要静默吞掉点击（那样按钮看起来"点了没反应"，比少一次确认更糟）。
    if (typeof modal?.confirm !== "function") {
      clear();
      return;
    }
    modal.confirm({
      title: t("pagination.mode.confirmTitle"),
      content: t("pagination.mode.confirmBody", { count: sectionBreakCount }),
      okText: t("pagination.mode.confirmOk"),
      cancelText: t("pagination.mode.confirmCancel"),
      onOk: clear,
    });
  };

  /** 全局「板块分页方式」：写/清板块级断页；条目级意图一律不碰。 */
  const changeMode = (next: SectionPaginationMode) => {
    if (next === mode) return;
    if (next === "page") {
      if (sectionKeys.length === 0) return;
      update((config) => setSectionsBreakBefore(config, sectionKeys));
      return;
    }
    if (sectionBreakCount === 0) return;
    confirmClearSectionsBreakBefore();
  };

  const clearOneSectionBreak = (key: string) =>
    update((config) => setSectionBreak(config, key, { break_before: null }));

  const clearOneEntryBreak = (id: string) =>
    update((config) => setEntryBreak(config, id, { break_before: null }));

  /** 「恢复自然分页」按钮本身就是明确的动作 + 提示，不再叠一层确认框。 */
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
          {mode === "flow" && activeBreakCount > 0 ? (
            <span className="resume-pagination-help" data-testid="pagination-mode-partial">
              {t("pagination.mode.partial", { count: activeBreakCount })}
            </span>
          ) : null}
        </div>
      ) : null}

      {sectionBreakCount + entryBreakCount > 0 ? (
        <div className="resume-pagination-group" data-testid="pagination-section-breaks">
          <Flex gap={8} align="center" wrap>
            <span className="resume-pagination-label">{t("pagination.breaks.title")}</span>
            {/* 「恢复自然分页」只清板块级：没有板块断页时不显示，免得点了没反应。 */}
            {sectionBreakCount > 0 ? (
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
            ) : null}
          </Flex>
          {entryBreakCount > 0 ? (
            <span className="resume-pagination-help">{t("pagination.breaks.entryHint")}</span>
          ) : null}
          <Flex gap={6} wrap className="resume-pagination-break-list">
            {sectionBreakKeys.map((key) => (
              <BreakChip
                key={key}
                label={labelOf(key)}
                clearLabel={t("pagination.breaks.clearOne", { label: labelOf(key) })}
                disabled={disabled}
                onClear={() => clearOneSectionBreak(key)}
              />
            ))}
            {entryBreakKeys.map((id) => (
              <BreakChip
                key={`entry-${id}`}
                label={labelOfEntry(id)}
                clearLabel={t("pagination.breaks.clearEntry", { label: labelOfEntry(id) })}
                disabled={disabled}
                onClear={() => clearOneEntryBreak(id)}
              />
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
                    activeBreakCount > 0
                      ? t("pagination.sections.summary", { count: activeBreakCount })
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

      {/* 没选中条目时的指路：条目级控件不是"没有"，而是"选中一条才出现"。 */}
      {!entry && sections.length > 0 ? (
        <span className="resume-pagination-help">{t("pagination.entry.pick")}</span>
      ) : null}

      {/* 页缩略图自包含：订阅 W08 报告快照，不需要 shell 额外传参。 */}
      <PageThumbnailStrip />

      <ContinuationControls
        value={continuation}
        disabled={disabled}
        onChange={(changes) => update((config) => setContinuation(config, changes))}
      />

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
