// SPDX-License-Identifier: Apache-2.0
/**
 * 「局部排版」里的两个批量动作（W07 / D03 多选批量调整 + 格式刷）。
 *
 * 挂载点是左栏 `WorkbenchParamsColumn` 的「局部排版」组、对象面板下方：多选来自大纲
 * （`OutlinePanel.onMultiSelectionChange`），单条来源来自大纲选中（`selectedObjectId`）。
 *
 * 状态机照抄 `TypographyHostIntegration.test.tsx` 的 HostHarness：每次动作只调用**一次**
 * 宿主的 layout 提交（= W03 历史的一步）；armed 状态只活在这里。规则层（复制哪些差异、
 * 怎么合并）全在 `features/resume-layout/stylePainter`，本组件不碰数据语义。
 */
import { App, Space, Typography } from "antd";
import { useState } from "react";
import type { ResumeLayout, ResumeTemplateCatalog } from "../../types";
import { t } from "../../i18n";
import type { OutlineMultiEntry } from "./outline/OutlinePanel";
import MultiStyleBar from "./typography/MultiStyleBar";
import FormatPainterButton from "./typography/FormatPainterButton";
import {
  readStyleDomains,
  resolvedPropValue,
  roleBaseRatio,
  type ResumeRoleStyle,
} from "../../features/resume-layout/styleOverrides";
import {
  readStyleCatalog,
  templateRoleDefaults,
} from "../../features/resume-layout/styleCatalogExtensions";
import { OBJECT_STYLE_PROPS } from "../../features/resume-layout/styleCatalog";
import {
  applyPainterPatch,
  freezeObjectStyle,
  painterPatch,
} from "../../features/resume-layout/stylePainter";

/** 对象面板用的段落角色：与 ObjectStylePanel 的缺省一致（条目正文/要点都按 body 继承）。 */
const OBJECT_ROLE = "body";

interface Props {
  layout: ResumeLayout;
  catalog?: ResumeTemplateCatalog;
  /** 大纲选中的单条（格式刷来源）。 */
  selectedObjectId: string | null;
  selectedObjectLabel?: string;
  /** 大纲多选的条目（批量调整与格式刷的目标）。 */
  selected: OutlineMultiEntry[];
  disabled?: boolean;
  onChange: (next: ResumeLayout) => void;
  onClearSelection: () => void;
}

export default function WorkbenchTypographyTools({
  layout,
  catalog,
  selectedObjectId,
  selectedObjectLabel,
  selected,
  disabled = false,
  onChange,
  onClearSelection,
}: Props) {
  const { message } = App.useApp();
  const [painter, setPainter] = useState<ResumeRoleStyle | null>(null);
  const domains = readStyleDomains(layout.format_config);
  const sourcePatch = painterPatch(domains, selectedObjectId);
  const targets = selected.map((entry) => entry.id);
  const defaults = templateRoleDefaults(readStyleCatalog(catalog), layout.template, OBJECT_ROLE);
  const baseRatio = roleBaseRatio(defaults);

  /** 把当前生效值（显示口径）固化成显式覆盖：代价由按钮的 Tooltip 说明。 */
  const freeze = () => {
    if (!selectedObjectId) return;
    const resolved: ResumeRoleStyle = {};
    for (const prop of OBJECT_STYLE_PROPS) {
      const value = resolvedPropValue(domains, {
        role: OBJECT_ROLE,
        prop,
        objectId: selectedObjectId,
        templateDefaults: defaults,
      });
      if (value !== undefined) resolved[prop] = value;
    }
    onChange({
      ...layout,
      format_config: freezeObjectStyle(layout.format_config, selectedObjectId, resolved, baseRatio),
    });
    message.success(t("typography.painter.applied", { count: 1 }));
  };

  const applyPainter = () => {
    if (!painter || targets.length === 0) return;
    onChange({
      ...layout,
      format_config: applyPainterPatch(layout.format_config, targets, painter),
    });
    message.success(t("typography.painter.applied", { count: targets.length }));
    setPainter(null);
  };

  // 既没有多选、也没有单条选中：给一句"去哪儿选"，而不是渲染一排按不动的按钮。
  if (selected.length === 0 && !selectedObjectId) {
    return <Typography.Text type="secondary">{t("typography.multi.empty")}</Typography.Text>;
  }

  return (
    <Space
      orientation="vertical"
      size={8}
      style={{ width: "100%" }}
      data-workbench-typography-tools="1"
    >
      {selected.length > 0 ? (
        <MultiStyleBar
          layout={layout}
          selected={selected.map((entry) => ({
            id: entry.id,
            label: entry.label,
            meta: entry.meta,
          }))}
          disabled={disabled}
          onChange={onChange}
          onClearSelection={onClearSelection}
          onApplied={(count) => message.success(t("typography.multi.applied", { count }))}
        />
      ) : null}
      <FormatPainterButton
        sourceName={selectedObjectLabel}
        hasSource={Boolean(selectedObjectId)}
        hasDiff={sourcePatch !== null}
        armed={painter !== null}
        targetCount={targets.length}
        disabled={disabled}
        onArm={() => setPainter(sourcePatch)}
        onCancel={() => setPainter(null)}
        onApply={applyPainter}
        onFreeze={freeze}
      />
    </Space>
  );
}
