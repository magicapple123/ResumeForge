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
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  /** 当前实际缩放（已含可读下限与大屏上限的夹取）。 */
  scale: number;
  /** 是否停在下限上：为真时读数换成可聚焦的提示胶囊。 */
  clampedToMin: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onReset: () => void;
}

export default function PreviewZoomBar({
  scale,
  clampedToMin,
  onZoomOut,
  onZoomIn,
  onReset,
}: Props) {
  useLocale();
  return (
    <div className="resume-preview-zoom-row">
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
      {/* 快捷键提示：Ctrl+滚轮缩放早已实现，但没有任何地方告诉用户——用户只能一个个
          按钮试。常驻在缩放控件旁边而不是做成一次性引导，因为"想放大看一眼"随时会发生。 */}
      <Typography.Text type="secondary" className="resume-preview-zoom-hint">
        {t("preview.zoom.hint")}
      </Typography.Text>
    </div>
  );
}
