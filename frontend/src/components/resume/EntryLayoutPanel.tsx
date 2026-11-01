// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目字段排版」面板（v2；替换 v1 的 FieldLayoutPanel，计划 §9.4）。
 *
 * 选板块 / 条目 → 条目头布局三选一、列数、对齐、列间距、灰色短字段顺序与显示、
 * 隐藏字段恢复。板块不再硬编码七个分区：选项来自 `document.sections`（含自建板块）。
 *
 * 生效值与写回都在 `features/resume-layout/entryLayoutModel`（纯函数、可单测）：
 * - 板块级 = `section.layout`；条目级 = `entry.layout`（null 表示继承板块）；
 * - 锁排版 / 锁内容会禁用对应控件并说明原因，不静默失败。
 *
 * R-11（审计）重排：面板从"一列裸控件"改成三段结构，每个决定都有标题可依：
 * 1. 顶部浅底卡片收「板块 / 应用范围 / 条目」——选对象的东西聚在一处；
 * 2. 三个分组标题 `条目标题布局` / `分栏` / `断页（仅这一条）`，之间 1px 分隔；
 * 3. **条目行与条目标题布局始终渲染**（范围=整个板块时禁用而不是消失）——切范围时
 *    面板高度不跳，鼠标下的分段控件不会移位；
 * 4. 「继承」成为每个分栏控件的第一个选项（哨兵 `"inherit"`，见
 *    `EntryLayoutInheritanceControls`），删掉右侧来源标记与逐项恢复按钮；
 * 5. 字段检查器移到**面板底部**——选中字段时它只会往下长，参数区位置不动。
 *
 * 本组件只做「选板块/条目 + 组合」，三块独立 UI 按职责拆到 `entryLayout/`：
 * - `EntryLayoutPagination`：条目级断页（Q08/Q09）；
 * - `EntryLayoutShortFields`：灰色短字段顺序与显示（Q07/Q08/Q20 + R-10）；
 * - `EntryLayoutNodeInspector`：选中字段的就地编辑（两处渲染共用）。
 */
import { Button, Empty, Segmented, Select, Typography } from "antd";
import { useCallback, useMemo, useState } from "react";
import { useLocale } from "../../i18n/i18nContext";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import type { ResumeDocument, SectionLayout, EntryLayout } from "../../types/resumeDocument";
import { findItem } from "../../features/resume-document/paths";
import { entryDisplayLabel } from "../../features/resume-document/summarize";
import type { DocumentFieldCatalog } from "../../types/resumeDocument";
import EntryLayoutInheritanceControls from "./EntryLayoutInheritanceControls";
import type { LayoutPatch } from "./EntryLayoutInheritanceControls";
import EntryLayoutNodeInspector from "./entryLayout/EntryLayoutNodeInspector";
import EntryLayoutPagination from "./entryLayout/EntryLayoutPagination";
import EntryLayoutShortFields from "./entryLayout/EntryLayoutShortFields";
import { usePanelNarrow } from "./entryLayout/usePanelNarrow";
import { sectionKeyLabel } from "./sectionLabels";
import "./entry-layout-panel.css";
import {
  effectiveAlign,
  effectiveColumns,
  effectiveGap,
  effectiveHead,
  entryLayoutOverrides,
  hasEntries,
  patchEntryLayout,
  patchSectionLayout,
  resetEntryLayout,
  resetSectionLayout,
} from "../../features/resume-layout/entryLayoutModel";

const HEAD_LABEL_KEYS: Record<EntryLayout["head"], MessageKey> = {
  split: "structure.layout.head.split",
  stacked: "structure.layout.head.stacked",
  meta_first: "structure.layout.head.meta_first",
};

/**
 * 只把 patch 里**真正传了值**的键写回。
 *
 * `undefined` 表示"这次没改这一项"，不能参与合并：条目级布局里 `null` 是"继承"
 * （合法值），而 `undefined` 会把同一条目已有的覆盖项抹掉——例如选「继承」列数时
 * 顺手清掉对齐方式与列间距。
 */
function definedPatch<T extends object>(source: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
}

export interface EntryLayoutPanelProps {
  document: ResumeDocument;
  /** 唯一回流口（宿主记历史、标脏、保存）。 */
  onChange: (next: ResumeDocument) => void;
  /** 结构面板 / 编辑器当前选中路径：面板据此预选板块与条目。 */
  selectedPath?: string | null;
  onSelectPath?: (path: string | null) => void;
  disabled?: boolean;
  fieldCatalog?: DocumentFieldCatalog | null;
  onNotice?: (message: string, tone?: "info" | "warning") => void;
  className?: string;
}

export default function EntryLayoutPanel({
  document,
  onChange,
  selectedPath,
  onSelectPath,
  disabled = false,
  fieldCatalog = null,
  onNotice,
  className,
}: EntryLayoutPanelProps) {
  useLocale();
  // R-11-8：面板自己的宽度决定分段控件是否竖排（antd 的 vertical 属性，
  // 纯 CSS 改 flex-direction 会让选中项失去高亮，见 usePanelNarrow 的注释）。
  const { ref: panelRef, narrow } = usePanelNarrow<HTMLDivElement>();
  const sections = document.sections;
  const pathSection = selectedPath?.split(".")[0] ?? "";
  const pathEntry = selectedPath?.split(".")[1] ?? "";
  const [sectionKey, setSectionKey] = useState<string>(pathSection || sections[0]?.key || "");
  const [entryId, setEntryId] = useState<string>(pathEntry || "");
  // 外部选中变化（结构面板/纸面点击）→ 跟随切板块与条目。
  // 渲染期对齐（React 官方「props 变化时调整 state」模式）：不在 effect 里同步 setState，
  // 既避开级联渲染，也不会先渲染一帧旧选中。
  const [lastExternalPath, setLastExternalPath] = useState(selectedPath ?? "");
  if ((selectedPath ?? "") !== lastExternalPath) {
    setLastExternalPath(selectedPath ?? "");
    if (pathSection && sections.some((section) => section.key === pathSection)) {
      setSectionKey(pathSection);
      if (pathEntry) setEntryId(pathEntry);
    }
  }

  const section = useMemo(
    () => sections.find((candidate) => candidate.key === sectionKey) ?? sections[0] ?? null,
    [sectionKey, sections],
  );
  // Q08：条目名与结构树/分页面板同一个函数（title 值 → 首个非空正文值截断），
  // 只有拿到空名时才编号，避免所有条目都显示「未命名条目 N」。
  // 兜底文案在渲染期取（t() 不进 memo），否则切语言后 memo 会缓存旧文案。
  const untitledEntryLabel = t("structure.badge.untitledEntry");
  const entries = useMemo(() => {
    const sectionEntries = section?.entries ?? [];
    return sectionEntries.map((candidate, index) => ({
      id: candidate.id ?? "",
      label: entryDisplayLabel(candidate) || `${untitledEntryLabel} ${index + 1}`,
    }));
  }, [section, untitledEntryLabel]);
  const entry = useMemo(
    () =>
      section?.entries.find((candidate) => candidate.id === entryId) ?? section?.entries[0] ?? null,
    [entryId, section],
  );
  const selectedItem = useMemo(() => findItem(document, selectedPath), [document, selectedPath]);
  const [scope, setScope] = useState<"section" | "entry">("entry");
  // 条目被删/切换板块后，保证 entryId 指向现存条目（同样是渲染期对齐，不进 effect）。
  if (entry && entry.id && entry.id !== entryId) setEntryId(entry.id);
  if (!entry && entryId) setEntryId("");

  const layoutLocked = entry?.lock_layout === true;
  const contentLocked = entry?.lock_content === true;
  const controlsDisabled = disabled || layoutLocked;
  const columns = effectiveColumns(section, scope === "entry" ? entry : null);
  const align = effectiveAlign(section, scope === "entry" ? entry : null);
  const gap = effectiveGap(section, scope === "entry" ? entry : null);

  const sectionLabel = (key: string, fallback: string): string => sectionKeyLabel(key, fallback);

  const patchLayout = useCallback(
    (patch: LayoutPatch) => {
      if (!section) return;
      if (scope === "entry" && entry?.id) {
        onChange(
          patchEntryLayout(
            document,
            section.key,
            entry.id,
            definedPatch({
              // `null` 是"恢复继承"的合法值：继承选项直接把它写回条目级。
              columns: patch.columns as EntryLayout["columns"],
              align: patch.align as EntryLayout["align"],
              gap: patch.gap,
              head: patch.head,
            }) as Partial<EntryLayout>,
          ),
        );
        return;
      }
      onChange(
        patchSectionLayout(
          document,
          section.key,
          definedPatch({
            columns: patch.columns as SectionLayout["columns"],
            align: patch.align as SectionLayout["align"],
            gap: patch.gap,
          }) as Partial<SectionLayout>,
        ),
      );
    },
    [document, entry, onChange, scope, section],
  );

  const resetScope = () => {
    if (!section) return;
    if (scope === "entry" && entry?.id) {
      onChange(resetEntryLayout(document, section.key, entry.id));
      return;
    }
    onChange(resetSectionLayout(document, section.key));
  };

  if (!section) {
    return <div className="rf-entry-layout-empty">{t("structure.layout.empty")}</div>;
  }
  const noEntries = !hasEntries(section);
  /**
   * Q07：行内板块（技能/语言）与单段板块（个人总结）在 planner 里不产生 EntryPlan 的
   * 条目级排版/分页落点（inline 只产 rows，text 只产一段正文），所以这里不渲染条目级
   * 控件——否则就是"调了没反应"的无效控件。它们仍然保留板块选择器与字段检查器。
   */
  const entriesKind = section.kind === "entries";

  const sectionSelectRow = (
    <div className="rf-entry-layout-row">
      <span className="rf-entry-layout-label">{t("structure.layout.section")}</span>
      <Select
        size="small"
        value={section.key}
        disabled={disabled}
        style={{ flex: 1, minWidth: 0 }}
        aria-label={t("structure.layout.section")}
        options={sections.map((candidate) => ({
          value: candidate.key,
          label: sectionLabel(candidate.key, candidate.title),
        }))}
        onChange={(value) => {
          setSectionKey(value);
          setEntryId("");
        }}
      />
    </div>
  );

  if (!entriesKind) {
    return (
      <div className={`rf-entry-layout${className ? ` ${className}` : ""}`}>
        {sectionSelectRow}
        <div className="rf-entry-layout-hint" data-entry-layout-not-entries="1">
          <Typography.Text strong>{t("structure.layout.notEntries")}</Typography.Text>
          <div className="rf-entry-layout-fields-hint">{t("structure.layout.notEntriesHint")}</div>
        </div>
        {selectedItem ? (
          <EntryLayoutNodeInspector
            document={document}
            path={selectedPath ?? ""}
            item={selectedItem.item}
            sectionKey={selectedItem.section.key}
            entry={selectedItem.entry}
            catalog={fieldCatalog}
            disabled={disabled}
            onChange={onChange}
          />
        ) : null}
      </div>
    );
  }

  const entryScoped = scope === "entry" && entry !== null;

  return (
    <div className={`rf-entry-layout${className ? ` ${className}` : ""}`} ref={panelRef}>
      <div className="rf-entry-layout-hint">{t("structure.layout.hint")}</div>

      {/* R-11-1：板块 / 应用范围 / 条目收进一块浅底卡片。 */}
      <div className="rf-entry-layout-card" data-entry-layout-card="1">
        {sectionSelectRow}
        <div className="rf-entry-layout-row">
          <span className="rf-entry-layout-label">{t("structure.layout.scope")}</span>
          <Segmented
            className="rf-entry-layout-control"
            size="small"
            block
            vertical={narrow}
            value={scope}
            disabled={disabled || noEntries}
            aria-label={t("structure.layout.scope")}
            options={[
              { value: "entry", label: t("structure.layout.scope.entry") },
              { value: "section", label: t("structure.layout.scope.section") },
            ]}
            onChange={(value) => setScope(value as "section" | "entry")}
          />
        </div>
        {/* R-11-2：条目行始终渲染（范围=整个板块时禁用），切范围高度不跳。 */}
        <div className="rf-entry-layout-row">
          <span className="rf-entry-layout-label">{t("structure.layout.entry")}</span>
          <Select
            size="small"
            value={entry?.id ?? undefined}
            disabled={disabled || noEntries || scope === "section"}
            style={{ flex: 1, minWidth: 0 }}
            aria-label={t("structure.layout.entry")}
            placeholder={noEntries ? t("structure.layout.entryEmpty") : undefined}
            options={entries.map((option) => ({ value: option.id, label: option.label }))}
            onChange={(value) => {
              setEntryId(value);
              onSelectPath?.(`${section.key}.${value}`);
            }}
          />
        </div>
      </div>

      {layoutLocked ? (
        <div className="rf-entry-layout-locked">{t("structure.layout.locked")}</div>
      ) : null}
      {contentLocked ? (
        <div className="rf-entry-layout-locked">{t("structure.layout.lockedContent")}</div>
      ) : null}

      {/* R-11-3：统一分组标题 + 1px 分隔；head 是条目属性，范围=整个板块时禁用。 */}
      <section className="rf-entry-layout-group" aria-label={t("structure.layout.head")}>
        <div className="rf-entry-layout-group-title">{t("structure.layout.head")}</div>
        <Segmented
          className="rf-entry-layout-control"
          size="small"
          block
          vertical={narrow}
          value={effectiveHead(entry)}
          disabled={controlsDisabled || contentLocked || scope === "section"}
          aria-label={t("structure.layout.head")}
          options={(["split", "stacked", "meta_first"] as const).map((value) => ({
            value,
            label: t(HEAD_LABEL_KEYS[value]),
          }))}
          onChange={(value) => patchLayout({ head: value as EntryLayout["head"] })}
        />
      </section>

      <section className="rf-entry-layout-group" aria-label={t("structure.layout.group.columns")}>
        <div className="rf-entry-layout-group-title">{t("structure.layout.group.columns")}</div>
        <EntryLayoutInheritanceControls
          columns={columns}
          align={align}
          gap={gap}
          overrides={entryScoped && entry ? entryLayoutOverrides(entry) : null}
          disabled={controlsDisabled}
          narrow={narrow}
          onPatch={patchLayout}
        />
      </section>

      {/*
        R-11：断页组与灰字段顺序块**始终渲染**（范围=整个板块时整块禁用）。
        它们本来只对条目有意义，但如果按范围隐藏，切范围时面板会整体缩短 600+px
        ——正是验收里「切范围时面板总高不变」要治的那个跳。禁用 + 分组标题里的
        「（仅这一条）」已经说清"为什么现在不能改"。
      */}
      {entry ? (
        <EntryLayoutPagination
          document={document}
          sectionKey={section.key}
          entry={entry}
          disabled={controlsDisabled || scope === "section"}
          onChange={onChange}
          onNotice={onNotice}
        />
      ) : null}

      {entry ? (
        <EntryLayoutShortFields
          document={document}
          sectionKey={section.key}
          entry={entry}
          fieldCatalog={fieldCatalog}
          disabled={disabled || scope === "section"}
          layoutLocked={layoutLocked}
          onChange={onChange}
        />
      ) : null}

      <div className="rf-entry-layout-actions">
        <Button
          size="small"
          disabled={scope === "entry" ? controlsDisabled : disabled}
          onClick={resetScope}
        >
          {t("structure.layout.reset")}
        </Button>
      </div>
      {scope === "entry" && noEntries ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("structure.layout.entryEmpty")}
        />
      ) : null}

      {/* R-11-6：字段检查器在面板**底部**——选中字段时它只往下长，上面的参数区不动。 */}
      {selectedItem ? (
        <EntryLayoutNodeInspector
          document={document}
          path={selectedPath ?? ""}
          item={selectedItem.item}
          sectionKey={selectedItem.section.key}
          entry={selectedItem.entry}
          catalog={fieldCatalog}
          disabled={disabled}
          onChange={onChange}
        />
      ) : null}
    </div>
  );
}
