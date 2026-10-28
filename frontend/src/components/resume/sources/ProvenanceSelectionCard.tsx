// SPDX-License-Identifier: Apache-2.0
/**
 * 来源核对面板顶部的**内容选择卡**：先选"要核对哪一条内容"，再关联来源。
 *
 * 这一块解决的问题是"面板看起来不能选内容"：原先唯一的选中入口是文档大纲/纸面点击，
 * 没在大纲里点东西时面板只剩空态。这里给一个明确的、可搜索的下拉（按板块分组），
 * 旁边就是「关联到来源」按钮——选中之后按钮才可用，未选中时直接说明为什么不能点。
 *
 * 组件只发回调：选中由宿主存（`useWorkbenchProvenancePanels`），弹窗也由宿主开。
 */
import { LinkOutlined } from "@ant-design/icons";
import { Button, Select, Space, Typography } from "antd";
import type { SelectProps } from "antd";
import { pt } from "../../../features/resume-provenance/i18n";
import {
  groupSelectionOptions,
  sectionMessageKey,
  type SelectionOption,
} from "../../../features/resume-provenance/panelSelection";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  options: SelectionOption[];
  /** 当前选项值（没有选中时为 null）。 */
  value: string | null;
  /** 当前选中块是否已关联来源（null = 没选中）。 */
  linked: boolean | null;
  onChange: (key: string) => void;
  /** 未选中时的说明（为什么不能关联）。 */
  note: string | null;
  /** 「关联到来源」按钮是否可用。 */
  canLink: boolean;
  onLink: () => void;
}

function optionLabel(option: SelectionOption): string {
  const label = option.label || pt("provenance.option.labelFallback");
  return option.field ? pt("provenance.option", { label, field: option.field }) : label;
}

export default function ProvenanceSelectionCard({
  options,
  value,
  linked,
  onChange,
  note,
  canLink,
  onLink,
}: Props) {
  useLocale();
  const groups = groupSelectionOptions(options);
  const selectOptions: SelectProps["options"] = groups.map((group) => ({
    label: pt(sectionMessageKey(group.section)),
    options: group.options.map((option) => ({
      value: option.value,
      label: optionLabel(option),
    })),
  }));

  return (
    <section className="provenance-card provenance-selection" data-provenance-selection="1">
      <div className="provenance-card__head">
        <Typography.Text strong>{pt("provenance.selection.title")}</Typography.Text>
        <Typography.Text type="secondary" className="provenance-card__hint">
          {pt("provenance.panel.hint")}
        </Typography.Text>
      </div>
      <Space size={8} wrap align="center" className="provenance-selection__controls">
        <Select
          className="provenance-selection__select"
          showSearch
          value={value ?? undefined}
          placeholder={pt("provenance.selection.placeholder")}
          notFoundContent={pt("provenance.selection.empty")}
          options={selectOptions}
          optionFilterProp="label"
          aria-label={pt("provenance.selection.title")}
          onChange={(next: string) => onChange(next)}
        />
        <Button
          type="primary"
          ghost
          icon={<LinkOutlined />}
          disabled={!canLink || undefined}
          aria-label={pt("provenance.selection.linkAria")}
          onClick={onLink}
        >
          {pt("provenance.chain.link")}
        </Button>
        {linked === null ? null : (
          <Typography.Text type="secondary" className="provenance-selection__state">
            {linked ? pt("provenance.selection.linked") : pt("provenance.selection.unlinked")}
          </Typography.Text>
        )}
      </Space>
      {note ? <div className="provenance-selection__note">{note}</div> : null}
    </section>
  );
}
