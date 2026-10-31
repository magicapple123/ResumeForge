// SPDX-License-Identifier: Apache-2.0
/**
 * 条目字段排版的「继承链」控件（P5-4）：列数 / 对齐方式 / 列间距三行。
 *
 * - 板块级（overrides=null）：保持原样，只画控件；板块本身就是来源，不标「继承」。
 * - 条目级：每一项标注「继承板块 / 本条覆盖」，覆盖项另有逐项「恢复继承」按钮
 *   （把 entry.layout.X 置 null，**不写 section.layout**）。
 *
 * 从 EntryLayoutPanel 抽出：面板已到 500 行预算，且这三行是独立的展示规则。
 */
import { Button, InputNumber, Radio, Segmented, Tag, Tooltip, Typography } from "antd";
import { UndoOutlined } from "@ant-design/icons";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import type {
  EntryLayoutOverrides,
  InheritableLayoutField,
  LayoutAlign,
  LayoutColumns,
} from "../../features/resume-layout/entryLayoutModel";
import type { EntryLayout, SectionLayout } from "../../types/resumeDocument";
import { useLocale } from "../../i18n/i18nContext";

export type LayoutPatch = Partial<SectionLayout> & Partial<EntryLayout>;

interface Props {
  columns: LayoutColumns;
  align: LayoutAlign;
  gap: number | null;
  /** null = 板块级（不显示来源标记与逐项恢复）。 */
  overrides: EntryLayoutOverrides | null;
  disabled: boolean;
  onPatch: (patch: LayoutPatch) => void;
  onRestore: (field: InheritableLayoutField) => void;
}

const RESTORE_LABEL_KEYS: Record<InheritableLayoutField, MessageKey> = {
  columns: "structure.layout.restore.columns",
  align: "structure.layout.restore.align",
  gap: "structure.layout.restore.gap",
};

function SourceBadge({ inherited }: { inherited: boolean }) {
  return (
    <Tag
      color={inherited ? undefined : "blue"}
      style={{ marginInlineEnd: 0 }}
      data-layout-source={inherited ? "section" : "entry"}
    >
      {t(inherited ? "structure.layout.source.inherited" : "structure.layout.source.overridden")}
    </Tag>
  );
}

function RestoreButton({
  field,
  onRestore,
}: {
  field: InheritableLayoutField;
  onRestore: (field: InheritableLayoutField) => void;
}) {
  const label = t(RESTORE_LABEL_KEYS[field]);
  return (
    <Tooltip title={label}>
      <Button
        size="small"
        type="text"
        icon={<UndoOutlined />}
        aria-label={label}
        onClick={() => onRestore(field)}
      />
    </Tooltip>
  );
}

export default function EntryLayoutInheritanceControls({
  columns,
  align,
  gap,
  overrides,
  disabled,
  onPatch,
  onRestore,
}: Props) {
  useLocale();
  return (
    <>
      {overrides ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("structure.layout.sourceHint")}
        </Typography.Text>
      ) : null}
      <div className="rf-entry-layout-row">
        <span className="rf-entry-layout-label">{t("structure.layout.columns")}</span>
        <Radio.Group
          size="small"
          value={columns}
          disabled={disabled}
          aria-label={t("structure.layout.columns")}
          options={[1, 2, 3].map((value) => ({ value, label: String(value) }))}
          onChange={(event) => onPatch({ columns: event.target.value as LayoutColumns })}
        />
        {overrides ? <SourceBadge inherited={!overrides.columns} /> : null}
        {overrides?.columns ? <RestoreButton field="columns" onRestore={onRestore} /> : null}
      </div>
      <div className="rf-entry-layout-row">
        <span className="rf-entry-layout-label">{t("structure.layout.align")}</span>
        <Segmented
          size="small"
          value={align}
          disabled={disabled}
          aria-label={t("structure.layout.align")}
          options={[
            { value: "equal", label: t("structure.layout.align.equal") },
            { value: "flow", label: t("structure.layout.align.flow") },
          ]}
          onChange={(value) => onPatch({ align: value as LayoutAlign })}
        />
        {overrides ? <SourceBadge inherited={!overrides.align} /> : null}
        {overrides?.align ? <RestoreButton field="align" onRestore={onRestore} /> : null}
      </div>
      <div className="rf-entry-layout-row">
        <span className="rf-entry-layout-label">{t("structure.layout.gap")}</span>
        <InputNumber
          size="small"
          min={0}
          max={4}
          step={0.25}
          value={gap ?? undefined}
          placeholder={t("structure.layout.inherit")}
          disabled={disabled}
          aria-label={t("structure.layout.gap")}
          onChange={(value) => onPatch({ gap: typeof value === "number" ? value : null })}
        />
        {overrides ? <SourceBadge inherited={!overrides.gap} /> : null}
        {overrides?.gap ? <RestoreButton field="gap" onRestore={onRestore} /> : null}
      </div>
    </>
  );
}
