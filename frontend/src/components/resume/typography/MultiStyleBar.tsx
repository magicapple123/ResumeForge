// SPDX-License-Identifier: Apache-2.0
/**
 * W07 / D03 的多选批量调整条：把同一组段落规则应用到选中的多条内容。
 *
 * ## 为什么"没设的项不写"
 *
 * 三个控件默认都是"不改这项"（`null`）：用户可能只想统一行距、不想动段前距。
 * 只把用户动过的键并进补丁，一次 Apply 不会给所有条目加一串默认覆盖。
 *
 * ## 重复条目提醒
 *
 * 选中条目里出现内容相同的（标题 + 元信息归一化后相等）就提示——这是批量调整时最容易
 * 顺手造成、也最容易被读成"复制粘贴"的问题。判据在 `duplicateEntries`（纯函数）。
 *
 * ## 数据
 *
 * 应用走 `withObjectProps` → `format_config.objects[id]`，与单条面板同一条写路径；
 * 成功提示由宿主决定（组件不直接调 message，避免绕开 `App.useApp()` 的主题）。
 */
import { Alert, Button, InputNumber, Select, Space, Typography } from "antd";
import { useMemo, useState } from "react";
import type { ResumeLayout } from "../../../types";
import { t } from "../../../i18n";
import { STYLE_ENUM_OPTIONS, STYLE_PROP_LABELS } from "../../../utils/resumeStyleParams";
import {
  findDuplicateTargets,
  type EntryIdentity,
} from "../../../features/resume-layout/duplicateEntries";
import {
  withObjectProps,
  type ResumeRoleStyle,
} from "../../../features/resume-layout/styleOverrides";
import { useLocale } from "../../../i18n/i18nContext";

export type StyleTarget = EntryIdentity;

interface Props {
  layout: ResumeLayout;
  /** 选中的条目（空 = 未多选）。 */
  selected: StyleTarget[];
  disabled?: boolean;
  onChange: (layout: ResumeLayout) => void;
  onClearSelection: () => void;
  /** 应用成功后的宿主回调（Toast 由宿主用 App.useApp() 播）。 */
  onApplied?: (count: number) => void;
}

interface Patch {
  space_before: number | null;
  line_height: number | null;
  bullet: string | null;
}

const EMPTY_PATCH: Patch = { space_before: null, line_height: null, bullet: null };

export default function MultiStyleBar({
  layout,
  selected,
  disabled = false,
  onChange,
  onClearSelection,
  onApplied,
}: Props) {
  useLocale();
  const [patch, setPatch] = useState<Patch>(EMPTY_PATCH);
  const duplicates = useMemo(() => findDuplicateTargets(selected), [selected]);

  if (selected.length === 0) {
    return <Typography.Text type="secondary">{t("typography.multi.empty")}</Typography.Text>;
  }

  const hasPatch =
    patch.space_before !== null || patch.line_height !== null || patch.bullet !== null;
  const duplicateNames = duplicates.map((group) => `${group.label} ×${group.count}`).join(", ");

  const apply = () => {
    if (!hasPatch) return;
    const payload: ResumeRoleStyle = {};
    if (patch.space_before !== null) payload.space_before = patch.space_before;
    if (patch.line_height !== null) payload.line_height = patch.line_height;
    if (patch.bullet !== null) payload.bullet = patch.bullet;
    onChange({
      ...layout,
      format_config: withObjectProps(
        layout.format_config,
        selected.map((entry) => entry.id),
        payload,
      ),
    });
    onApplied?.(selected.length);
  };

  return (
    <section className="resume-typography-multi" aria-label={t("typography.multi.title")}>
      <Space size={8} wrap>
        <Typography.Text strong>{t("typography.multi.title")}</Typography.Text>
        <Typography.Text type="secondary">
          {t("typography.multi.count", { count: selected.length })}
        </Typography.Text>
        <Typography.Link
          role="button"
          tabIndex={0}
          onClick={onClearSelection}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onClearSelection();
          }}
        >
          {t("typography.multi.clear")}
        </Typography.Link>
      </Space>
      {duplicates.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          title={t("typography.multi.duplicate")}
          description={t("typography.multi.duplicateDetail", {
            count: duplicates.reduce((sum, group) => sum + group.count, 0),
            names: duplicateNames,
          })}
        />
      ) : null}
      <Space size={8} wrap>
        <Space size={4}>
          <Typography.Text type="secondary">{t(STYLE_PROP_LABELS.space_before)}</Typography.Text>
          <InputNumber
            size="small"
            style={{ width: 80 }}
            min={0}
            max={3}
            step={0.05}
            value={patch.space_before ?? undefined}
            placeholder={t("typography.multi.unchanged")}
            aria-label={t(STYLE_PROP_LABELS.space_before)}
            disabled={disabled}
            onChange={(next) => setPatch((prev) => ({ ...prev, space_before: next }))}
          />
        </Space>
        <Space size={4}>
          <Typography.Text type="secondary">{t(STYLE_PROP_LABELS.line_height)}</Typography.Text>
          <InputNumber
            size="small"
            style={{ width: 80 }}
            min={1}
            max={2.6}
            step={0.01}
            value={patch.line_height ?? undefined}
            placeholder={t("typography.multi.unchanged")}
            aria-label={t(STYLE_PROP_LABELS.line_height)}
            disabled={disabled}
            onChange={(next) => setPatch((prev) => ({ ...prev, line_height: next }))}
          />
        </Space>
        <Space size={4}>
          <Typography.Text type="secondary">{t(STYLE_PROP_LABELS.bullet)}</Typography.Text>
          <Select
            size="small"
            allowClear
            style={{ width: 110 }}
            value={patch.bullet ?? undefined}
            placeholder={t("typography.multi.unchanged")}
            aria-label={t(STYLE_PROP_LABELS.bullet)}
            disabled={disabled}
            options={(STYLE_ENUM_OPTIONS.bullet ?? []).map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
            onChange={(next) => setPatch((prev) => ({ ...prev, bullet: next ?? null }))}
          />
        </Space>
        <Button size="small" type="primary" disabled={disabled || !hasPatch} onClick={apply}>
          {t("typography.multi.apply")}
        </Button>
      </Space>
    </section>
  );
}
