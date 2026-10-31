// SPDX-License-Identifier: Apache-2.0
/**
 * W07 的格式刷按钮（wave2 契约 §2.5；Q14 重做文案与动作归位）。
 *
 * 组件是**受控**的：源对象、已复制的差异、armed 状态、目标数量都在宿主。这里只负责：
 * 1. 没有局部调整时置灰 + Tooltip 说明（不让用户点了没反应）；
 * 2. 显示"复制的是什么"：按钮文案带来源条目名，下面一行给可复制项数与属性名；
 * 3. armed 后显示目标数、应用到 N 条 / 退出；
 *
 * **「固定这条的当前样式」不在这里**（Q14）：它已移到「条目排版」面板底部，与
 * 「恢复这一条的全部继承」成对，并且按当前作用范围执行。格式刷只做"复制差异"。
 *
 * 规则层（复制哪些键、怎么合并）在 `features/resume-layout/stylePainter`，本组件不碰数据。
 */
import { FormatPainterOutlined } from "@ant-design/icons";
import { Button, Space, Tooltip, Typography } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { STYLE_PROP_LABELS, type StylePropKey } from "../../../utils/resumeStyleParams";

interface Props {
  /** 源对象显示名（arm 之前告诉用户"复制的是哪一条"）。 */
  sourceName?: string;
  /** 是否已选中可作来源的对象。 */
  hasSource: boolean;
  /** 源对象是否有显式局部调整（false → 复制不可用）。 */
  hasDiff: boolean;
  /** 源对象可复制的属性（Q14：显示项数与属性名）。 */
  sourceProps?: readonly StylePropKey[];
  /** 已复制、等待目标。 */
  armed: boolean;
  /** 当前待应用的目标条目数（0 → 应用不可用）。 */
  targetCount?: number;
  disabled?: boolean;
  onArm: () => void;
  onCancel: () => void;
  onApply: () => void;
}

export default function FormatPainterButton({
  sourceName,
  hasSource,
  hasDiff,
  sourceProps = [],
  armed,
  targetCount = 0,
  disabled = false,
  onArm,
  onCancel,
  onApply,
}: Props) {
  useLocale();
  const canCopy = hasSource && hasDiff;
  const name = sourceName?.trim() || t("typography.object.untitled");
  const copyLabel = t("typography.painter.copy", { name });

  if (armed) {
    return (
      <Space
        orientation="vertical"
        size={6}
        style={{ width: "100%" }}
        className="resume-typography-painter"
        data-armed="true"
      >
        <Typography.Text type="secondary">{t("typography.painter.armed")}</Typography.Text>
        <Space size={8} wrap>
          <Button
            size="small"
            type="primary"
            disabled={disabled || targetCount === 0}
            onClick={onApply}
          >
            {t("typography.painter.apply", { count: targetCount })}
          </Button>
          <Button size="small" onClick={onCancel}>
            {t("typography.painter.cancel")}
          </Button>
        </Space>
      </Space>
    );
  }

  // 属性名分隔符来自语言包：组件里不写中文标点（中文棘轮扫描的是 src 下每一行字面量）。
  const separator = t("typography.painter.propSeparator");
  const propsText = sourceProps.map((prop) => t(STYLE_PROP_LABELS[prop])).join(separator);
  return (
    <Space
      orientation="vertical"
      size={4}
      style={{ width: "100%" }}
      className="resume-typography-painter"
    >
      <Tooltip title={hasDiff ? copyLabel : t("typography.painter.empty")}>
        <Button
          size="small"
          icon={<FormatPainterOutlined />}
          disabled={disabled || !canCopy}
          aria-label={copyLabel}
          onClick={onArm}
        >
          {copyLabel}
        </Button>
      </Tooltip>
      {canCopy && sourceProps.length > 0 ? (
        <Typography.Text type="secondary">
          {t("typography.painter.copyProps", { count: sourceProps.length, props: propsText })}
        </Typography.Text>
      ) : null}
    </Space>
  );
}
