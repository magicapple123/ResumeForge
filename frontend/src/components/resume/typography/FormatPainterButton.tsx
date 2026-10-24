// SPDX-License-Identifier: Apache-2.0
/**
 * W07 的格式刷按钮（wave2 契约 §2.5）：复制源对象的**局部调整**，再应用到目标条目。
 *
 * 组件是**受控**的：源对象、已复制的差异、armed 状态、目标数量都在宿主（对象面板 /
 * 大纲的选中状态）里。这里只负责：
 * 1. 没有局部调整时置灰 + Tooltip 说明（不让用户点了没反应）；
 * 2. armed 后显示"应用格式刷 / 退出格式刷"与目标数；
 * 3. 提供**显式第二动作**「固化为局部调整」——把当前生效值写成显式覆盖，代价由
 *    Tooltip 说清（固化后这条不再随同类段落变化）。
 *
 * 规则层（复制哪些键、怎么合并）在 `features/resume-layout/stylePainter`，本组件不碰数据。
 */
import { BgColorsOutlined, FormatPainterOutlined } from "@ant-design/icons";
import { Button, Space, Tooltip, Typography } from "antd";
import { t } from "../../../i18n";

interface Props {
  /** 源对象显示名（arm 之后告诉用户"来源是哪一条"）。 */
  sourceName?: string;
  /** 是否已选中可作来源的对象。 */
  hasSource: boolean;
  /** 源对象是否有显式局部调整（false → 复制不可用）。 */
  hasDiff: boolean;
  /** 已复制、等待目标。 */
  armed: boolean;
  /** 当前待应用的目标条目数（0 → 应用不可用）。 */
  targetCount?: number;
  disabled?: boolean;
  onArm: () => void;
  onCancel: () => void;
  onApply: () => void;
  onFreeze: () => void;
}

export default function FormatPainterButton({
  sourceName,
  hasSource,
  hasDiff,
  armed,
  targetCount = 0,
  disabled = false,
  onArm,
  onCancel,
  onApply,
  onFreeze,
}: Props) {
  const canCopy = hasSource && hasDiff;

  if (armed) {
    return (
      <Space size={8} wrap className="resume-typography-painter" data-armed="true">
        <Typography.Text type="secondary">{t("typography.painter.armed")}</Typography.Text>
        <Button
          size="small"
          type="primary"
          disabled={disabled || targetCount === 0}
          onClick={onApply}
        >
          {t("typography.painter.apply")}
        </Button>
        <Button size="small" onClick={onCancel}>
          {t("typography.painter.cancel")}
        </Button>
      </Space>
    );
  }

  return (
    <Space size={8} wrap className="resume-typography-painter">
      <Tooltip title={hasDiff ? t("typography.painter.copy") : t("typography.painter.empty")}>
        <Button
          size="small"
          icon={<FormatPainterOutlined />}
          disabled={disabled || !canCopy}
          aria-label={t("typography.painter.copy")}
          onClick={onArm}
        >
          {t("typography.painter.copy")}
        </Button>
      </Tooltip>
      {sourceName ? (
        <Typography.Text type="secondary">
          {t("typography.painter.source", { name: sourceName })}
        </Typography.Text>
      ) : null}
      <Tooltip title={t("typography.painter.freezeHint")}>
        <Button
          size="small"
          icon={<BgColorsOutlined />}
          disabled={disabled || !hasSource}
          aria-label={t("typography.painter.freeze")}
          onClick={onFreeze}
        >
          {t("typography.painter.freeze")}
        </Button>
      </Tooltip>
    </Space>
  );
}
