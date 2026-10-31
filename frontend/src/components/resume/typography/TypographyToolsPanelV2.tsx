// SPDX-License-Identifier: Apache-2.0
/**
 * v2 局部排版工具容器（task-12）：对象级排版 / 文字级别 / 格式刷 / 多选批量 / 同类段落。
 *
 * ## 自包含
 *
 * 条目选择由本组件自己提供（v2 `entry.id` 列表），**不依赖结构面板或旧大纲**；
 * 宿主只需要给 `document / layout / onChange` 与（可选）当前选中路径。
 *
 * ## 只改 format_config
 *
 * 所有写入都落到 `layout.format_config` 的既有域（roles / objects / object_roles），
 * **不动正文**。`onDocumentChange` 只为宿主统一签名保留，本组件保证不调用它
 * （测试里钉住这条不变量）。
 *
 * ## 选择语义
 *
 * - `selectedPath`（宿主控制）：当前聚焦条目 → 对象面板、格式刷来源；
 * - `multiSelectedPaths`（可选，宿主控制）：批量目标；不传时由本组件的选择列表自管；
 * - 多选路径里的 header / 板块 / 失效路径会被忽略，不会把非法对象 id 写进 format_config。
 *
 * ## 回调
 *
 * 每次写入只调用**一次** `onLayoutChange`（宿主 = 历史一步）；随后按 format_config
 * 差异触发 `onRoleStyleChange` / `onObjectStyleChange`，宿主可用于来源高亮 / 埋点 / Toast。
 */
import { App, Select, Space, Typography } from "antd";
import { useMemo, useState } from "react";
import type { RefObject } from "react";
import type { ResumeLayout, ResumeTemplateCatalog } from "../../../types";
import type { DocumentFieldCatalog, ResumeDocument } from "../../../types/resumeDocument";
import type { ResumePreviewHandle } from "../../ResumePreview";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { OBJECT_STYLE_PROPS, ROLE_STYLE_PROPS } from "../../../features/resume-layout/styleCatalog";
import {
  entryStyleScopeRole,
  type EntryStyleScope,
} from "../../../features/resume-layout/entryStyleScopes";
import type { ResumeRoleKey } from "../../../features/resume-layout/styleCatalog";
import {
  explicitObjectProps,
  readObjectStyle,
  readStyleDomains,
  resolvedPropValue,
  roleBaseRatio,
  type ResumeRoleStyle,
} from "../../../features/resume-layout/styleOverrides";
import {
  readStyleCatalog,
  templateRoleDefaults,
} from "../../../features/resume-layout/styleCatalogExtensions";
import {
  applyPainterPatch,
  freezeObjectRoleStyle,
  freezeObjectStyle,
  painterPatch,
} from "../../../features/resume-layout/stylePainter";
import ObjectStylePanel from "./ObjectStylePanel";
import FormatPainterButton from "./FormatPainterButton";
import MultiStyleBar from "./MultiStyleBar";
import RoleStylePanel from "./RoleStylePanel";
import TextLevelBar from "./TextLevelBar";
import {
  changedStyleTargets,
  entryIdFromPath,
  entryIdsFromPaths,
  findEntryById,
  optionsForIds,
  pathsFromEntryIds,
  scopeForDocumentPath,
  styleChangeIsEmpty,
  typographyEntryOptions,
} from "./v2Selection";

/** 对象面板默认继承的段落角色：条目的正文/要点都按 body 继承（与旧挂载一致）。 */
const OBJECT_ROLE: ResumeRoleKey = "body";

export interface TypographyToolsPanelV2Props {
  /** v2 文档：选择列表 + 纸面路径 → 条目 id 的唯一来源。 */
  document: ResumeDocument;
  layout: ResumeLayout;
  /** 所有排版写入的出口：只改 `format_config`（角色/对象样式），不改正文。 */
  onLayoutChange: (next: ResumeLayout) => void;
  /**
   * 宿主统一签名保留；本组件**不会调用**（排版工具不动正文）。
   * 测试钉住这条不变量，避免将来误传一次 document 写入把历史弄脏。
   */
  onDocumentChange?: (next: ResumeDocument) => void;
  /** 当前聚焦条目的路径（可以是条目路径或条目内字段路径）。 */
  selectedPath?: string | null;
  /** 宿主控制的多选条目路径（`section.entryId`）；不传时组件内部自管。 */
  multiSelectedPaths?: string[];
  /** 多选变化（路径列表）；宿主可用它做自己的选中态同步。 */
  onMultiSelectedPathsChange?: (paths: string[]) => void;
  previewRef: RefObject<ResumePreviewHandle | null>;
  fieldCatalog?: DocumentFieldCatalog | null;
  /** 模板目录（角色默认值/基准字号）；缺省时面板用中性兜底。 */
  catalog?: ResumeTemplateCatalog;
  disabled?: boolean;
  /** 是否包含「同类段落」角色面板（默认 true；宿主已有独立角色分组时传 false 防重复）。 */
  includeRoleStyles?: boolean;
  /** 角色域被写时触发（值为发生变化的角色 key 列表）。 */
  onRoleStyleChange?: (roles: ResumeRoleKey[]) => void;
  /** 对象域 / 对象角色域被写时触发。 */
  onObjectStyleChange?: (objectIds: string[], objectRoleKeys: string[]) => void;
}

export default function TypographyToolsPanelV2({
  document,
  layout,
  onLayoutChange,
  onDocumentChange,
  selectedPath = null,
  multiSelectedPaths,
  onMultiSelectedPathsChange,
  previewRef,
  fieldCatalog = null,
  catalog,
  disabled = false,
  includeRoleStyles = true,
  onRoleStyleChange,
  onObjectStyleChange,
}: TypographyToolsPanelV2Props) {
  useLocale();
  void onDocumentChange;
  const { message } = App.useApp();
  const options = useMemo(
    () => typographyEntryOptions(document, fieldCatalog),
    [document, fieldCatalog],
  );
  const [internalMultiIds, setInternalMultiIds] = useState<string[]>([]);
  const [painter, setPainter] = useState<ResumeRoleStyle | null>(null);
  const controlledMulti = multiSelectedPaths !== undefined;
  const multiIds = controlledMulti ? entryIdsFromPaths(multiSelectedPaths) : internalMultiIds;
  const multiOptions = optionsForIds(options, multiIds);
  const focused = options.find((option) => option.id === entryIdFromPath(selectedPath)) ?? null;
  const domains = readStyleDomains(layout.format_config);
  const sourcePatch = painterPatch(domains, focused?.id ?? null);
  // Q12：条目内容（无关项判断）与纸面路径推出的默认作用范围。
  const focusedEntry = findEntryById(document, focused?.id);
  const pickedScope = scopeForDocumentPath(document, selectedPath);
  // Q14：格式刷按钮要显示"可复制几项、哪几项"（复制的是对象层显式差异）。
  const painterSourceProps = focused
    ? explicitObjectProps(readObjectStyle(domains, focused.id))
    : [];
  // 格式刷目标：多选条目里排除来源本身（把来源再刷一遍是无声无操作）。
  const painterTargetIds = multiOptions
    .map((option) => option.id)
    .filter((id) => id !== focused?.id);
  const styleCatalog = readStyleCatalog(catalog ?? undefined);
  const defaults = templateRoleDefaults(styleCatalog, layout.template, OBJECT_ROLE);
  const baseRatio = roleBaseRatio(defaults);

  const commit = (next: ResumeLayout) => {
    onLayoutChange(next);
    const summary = changedStyleTargets(layout.format_config, next.format_config);
    if (styleChangeIsEmpty(summary)) return;
    if (summary.roles.length > 0) onRoleStyleChange?.(summary.roles);
    if (summary.objectIds.length > 0 || summary.objectRoleKeys.length > 0) {
      onObjectStyleChange?.(summary.objectIds, summary.objectRoleKeys);
    }
  };

  const setMulti = (ids: string[]) => {
    if (!controlledMulti) setInternalMultiIds(ids);
    onMultiSelectedPathsChange?.(pathsFromEntryIds(options, ids));
  };

  /**
   * Q14：把当前生效值固定成显式覆盖，**按当前作用范围**执行。
   *
   * 整条 → `objects[<id>]`（既有行为）；条目头 / 正文 / 灰字 → `object_roles["<id>:<角色>"]`，
   * 只固定该角色的属性，不污染同一条的其它范围。
   */
  const freeze = (scope: EntryStyleScope = "object") => {
    if (!focused) return;
    const scopeRole = entryStyleScopeRole(scope);
    if (scopeRole === null) {
      const resolved: ResumeRoleStyle = {};
      for (const prop of OBJECT_STYLE_PROPS) {
        const value = resolvedPropValue(domains, {
          role: OBJECT_ROLE,
          prop,
          objectId: focused.id,
          templateDefaults: defaults,
        });
        if (value !== undefined) resolved[prop] = value;
      }
      commit({
        ...layout,
        format_config: freezeObjectStyle(layout.format_config, focused.id, resolved, baseRatio),
      });
      message.success(t("typography.painter.frozen"));
      return;
    }
    const roleDefaults = templateRoleDefaults(styleCatalog, layout.template, scopeRole);
    const roleBase = roleBaseRatio(roleDefaults);
    const resolved: ResumeRoleStyle = {};
    for (const prop of ROLE_STYLE_PROPS[scopeRole]) {
      const value = resolvedPropValue(domains, {
        role: scopeRole,
        prop,
        objectId: focused.id,
        templateDefaults: roleDefaults,
      });
      if (value !== undefined) resolved[prop] = value;
    }
    commit({
      ...layout,
      format_config: freezeObjectRoleStyle(
        layout.format_config,
        focused.id,
        scopeRole,
        resolved,
        roleBase,
      ),
    });
    message.success(t("typography.painter.frozen"));
  };

  const applyPainter = () => {
    if (!painter || painterTargetIds.length === 0) return;
    commit({
      ...layout,
      format_config: applyPainterPatch(layout.format_config, painterTargetIds, painter),
    });
    message.success(t("typography.painter.applied", { count: painterTargetIds.length }));
    setPainter(null);
  };

  const roleSection = includeRoleStyles ? (
    <section className="resume-typography-panel" aria-label={t("typography.tools.sectionRole")}>
      <Typography.Text strong>{t("typography.tools.sectionRole")}</Typography.Text>
      <Typography.Text type="secondary">{t("typography.tools.roleHint")}</Typography.Text>
      <RoleStylePanel
        layout={layout}
        catalog={catalog}
        disabled={disabled}
        previewRef={previewRef}
        onChange={commit}
      />
    </section>
  ) : null;

  if (options.length === 0) {
    return (
      <Space orientation="vertical" size={8} style={{ width: "100%" }} data-typography-tools-v2="">
        <Typography.Text type="secondary">{t("typography.tools.selectionEmpty")}</Typography.Text>
        {roleSection}
      </Space>
    );
  }

  const selectOptions = options.map((option) => ({
    value: option.id,
    label: option.meta
      ? `${option.sectionTitle} · ${option.label} · ${option.meta}`
      : `${option.sectionTitle} · ${option.label}`,
  }));

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }} data-typography-tools-v2="">
      <section className="resume-typography-panel" aria-label={t("typography.tools.selectionAria")}>
        <Space size={8} wrap style={{ width: "100%" }}>
          <Typography.Text strong>{t("typography.tools.selectionTitle")}</Typography.Text>
          <Select
            mode="multiple"
            showSearch
            allowClear
            optionFilterProp="label"
            className="resume-typography-entry-select"
            style={{ minWidth: 240, flex: 1 }}
            aria-label={t("typography.tools.selectionAria")}
            placeholder={t("typography.tools.selectionPlaceholder")}
            value={multiIds}
            options={selectOptions}
            disabled={disabled}
            onChange={(ids: string[]) => setMulti(ids)}
          />
        </Space>
        <Typography.Text type="secondary">
          {focused
            ? t("typography.tools.focused", { name: focused.label })
            : t("typography.tools.noFocused")}
        </Typography.Text>
      </section>

      {focused ? (
        <section
          className="resume-typography-panel"
          aria-label={t("typography.tools.sectionObject")}
        >
          <Typography.Text strong>{t("typography.tools.sectionObject")}</Typography.Text>
          <ObjectStylePanel
            layout={layout}
            catalog={catalog}
            objectId={focused.id}
            objectLabel={focused.label}
            entry={focusedEntry}
            pickedPath={selectedPath}
            defaultScope={pickedScope}
            disabled={disabled}
            previewRef={previewRef}
            onChange={commit}
            onFreeze={freeze}
          />
        </section>
      ) : null}

      <section className="resume-typography-panel" aria-label={t("typography.tools.sectionLevel")}>
        <Typography.Text strong>{t("typography.tools.sectionLevel")}</Typography.Text>
        <TextLevelBar
          layout={layout}
          document={document}
          selected={multiOptions}
          selectedObjectId={focused?.id ?? null}
          selectedLabel={focused?.label}
          disabled={disabled}
          pickedPath={selectedPath}
          onChange={commit}
          onApplied={({ level, count }) =>
            message.success(
              level
                ? t("typography.level.applied", {
                    level: t(
                      level === "heading1"
                        ? "typography.level.heading1"
                        : level === "heading2"
                          ? "typography.level.heading2"
                          : level === "heading3"
                            ? "typography.level.heading3"
                            : level === "body"
                              ? "typography.level.body"
                              : "typography.level.caption",
                    ),
                    count,
                  })
                : t("typography.level.restored", { count }),
            )
          }
        />
      </section>

      <section
        className="resume-typography-panel"
        aria-label={t("typography.tools.sectionPainter")}
      >
        <Typography.Text strong>{t("typography.tools.sectionPainter")}</Typography.Text>
        {/* Q14：先说明这条流程只复制局部排版、不动正文，用户不用点了才知道。 */}
        <Typography.Text type="secondary">{t("typography.painter.hint")}</Typography.Text>
        <FormatPainterButton
          sourceName={focused?.label}
          hasSource={Boolean(focused)}
          hasDiff={sourcePatch !== null}
          sourceProps={painterSourceProps}
          armed={painter !== null}
          targetCount={painterTargetIds.length}
          disabled={disabled}
          onArm={() => setPainter(sourcePatch)}
          onCancel={() => setPainter(null)}
          onApply={applyPainter}
        />
        {painter ? (
          <Typography.Text type="secondary">
            {painterTargetIds.length > 0
              ? t("typography.tools.targets", { count: painterTargetIds.length })
              : t("typography.tools.targetsHint")}
          </Typography.Text>
        ) : null}
      </section>

      <section className="resume-typography-panel" aria-label={t("typography.tools.sectionBatch")}>
        <Typography.Text strong>{t("typography.tools.sectionBatch")}</Typography.Text>
        <MultiStyleBar
          layout={layout}
          selected={multiOptions.map((option) => ({
            id: option.id,
            label: option.label,
            meta: option.meta,
          }))}
          disabled={disabled}
          onChange={commit}
          onClearSelection={() => setMulti([])}
          onApplied={(count) => message.success(t("typography.multi.applied", { count }))}
        />
      </section>

      {roleSection}
    </Space>
  );
}
