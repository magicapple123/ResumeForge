// SPDX-License-Identifier: Apache-2.0
/**
 * 预览的缩放条（缩小 / 读数 / 放大 / 适应页面 + Ctrl+滚轮提示）。
 *
 * 2026-10-23 从 `ResumePreview.tsx` 拆出：那份文件已 538 行、超 500 行预算，而这一条是
 * **纯展示**——所有缩放状态都由宿主持有（`adjustZoom` 与会话级的 `zoom`），这里只把
 * 数字与三个回调原样渲染出来。
 */
import { ReloadOutlined, ZoomInOutlined, ZoomOutOutlined } from "@ant-design/icons";
import { Button, Tooltip, Typography } from "antd";
import type { ReactNode } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  /**
   * 行首的状态块（精确模式的「实际 N 页（上限 M 页）· 在新标签打开」）。
   *
   * 2026-10-29 用户要求把它和缩放控件**并到一行**：两行各自居中、中间还夹一档间距，
   * 读起来像两块无关的东西。并进来之后它只是这一行里的第一个 flex item，窄屏照常换行。
   */
  status?: ReactNode;
  /** 当前实际缩放（已含可读下限与大屏上限的夹取）。 */
  scale: number;
  /** 是否停在下限上：为真时读数换成可聚焦的提示胶囊。 */
  clampedToMin: boolean;
  /**
   * 纸面比相框宽时的可见状态（Q21）：传了才渲染，文案由宿主给。
   *
   * 缩放条本身不判"要不要横滚"——那需要相框宽度与纸宽的几何，只在 `ResumePreview` 里有。
   */
  overflowHint?: string;
  /**
   * 右侧提示语的**覆盖**（不传时用默认的「按住 Ctrl 滚滚轮可缩放」）。
   *
   * 简历制作台把"虚线是分页位置"那句说明并到这一行来（2026-11 用户要求：说明不该
   * 悬在纸面上方另占一条），两句用「 · 」连成一句由宿主拼好传进来——本组件不关心
   * 内容，只负责"提示语有一条位置"。
   */
  hint?: string;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onReset: () => void;
}

export default function PreviewZoomBar({
  status,
  scale,
  clampedToMin,
  overflowHint,
  hint,
  onZoomOut,
  onZoomIn,
  onReset,
}: Props) {
  useLocale();
  return (
    <div className="resume-preview-zoom-row">
      {status ? <div className="resume-preview-zoom-status">{status}</div> : null}
      <Tooltip title={t("preview.zoom.out")}>
        <Button
          type="text"
          size="small"
          aria-label={t("preview.zoom.out")}
          icon={<ZoomOutOutlined />}
          onClick={onZoomOut}
        />
      </Tooltip>
      {clampedToMin ? (
        // 触底：纸已经不能再小了，是**容器装不下 55%**，不是缩放坏了。
        // 读数变成可聚焦的提示（悬停/聚焦都给同一句解释），避免用户以为卡住了。
        <Tooltip title={t("responsive.a4.minScaleHint")}>
          <Typography.Text
            type="secondary"
            className="resume-preview-zoom-label is-min-scale"
            tabIndex={0}
          >
            {t("responsive.a4.minScaleLabel", { value: Math.round(scale * 100) })}
          </Typography.Text>
        </Tooltip>
      ) : (
        <Typography.Text type="secondary" className="resume-preview-zoom-label">
          {Math.round(scale * 100)}%
        </Typography.Text>
      )}
      <Tooltip title={t("preview.zoom.in")}>
        <Button
          type="text"
          size="small"
          aria-label={t("preview.zoom.in")}
          icon={<ZoomInOutlined />}
          onClick={onZoomIn}
        />
      </Tooltip>
      <Tooltip title={t("preview.zoom.fit")}>
        <Button
          type="text"
          size="small"
          aria-label={t("preview.zoom.reset")}
          icon={<ReloadOutlined />}
          onClick={onReset}
        />
      </Tooltip>
      {/* 横滚状态（Q21）：纸比相框宽时，"怎么才能看全"必须有一条可见说明，
          否则用户只会看到右侧被裁掉的一块。 */}
      {overflowHint ? (
        <Typography.Text type="secondary" className="resume-preview-zoom-overflow-hint">
          {overflowHint}
        </Typography.Text>
      ) : null}
      {/* 快捷键提示：Ctrl+滚轮缩放早已实现，但没有任何地方告诉用户——用户只能一个个
          按钮试。常驻在缩放控件旁边而不是做成一次性引导，因为"想放大看一眼"随时会发生。
          制作台会传 `hint` 进来（把分页说明并进这一行），主预览仍用默认那一句。 */}
      <Typography.Text type="secondary" className="resume-preview-zoom-hint">
        {hint ?? t("preview.zoom.hint")}
      </Typography.Text>
    </div>
  );
}
