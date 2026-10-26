// SPDX-License-Identifier: Apache-2.0
/**
 * 专业视图工具条（D04/D05/D10）：缩放档位、页导航、辅助线、灰度校样、打印检查、
 * 工作区预设、照片裁剪入口、命令面板入口。
 *
 * 纯展示 + 键盘转发：状态全部由 `ProviewLayer` 持有（偏好、命令、裁剪参数）。
 * 单独成文件的原因是 ProviewLayer 还要管命令表、覆盖层注入与弹窗，堆在一起会超
 * 单文件 300 行目标。
 */
import {
  BgColorsOutlined,
  CheckOutlined,
  ScissorOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Button, Segmented, Tooltip, Typography } from "antd";
import type { KeyboardEvent, RefObject } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { PageMarker } from "../../../features/resume-proview/pageMarkers";
import type {
  GuideFlags,
  WorkspacePresetId,
  ZoomMode,
} from "../../../features/resume-proview/types";
import type { PageNavigation } from "../../../features/resume-proview/usePageNavigation";
import GuidesControl from "./GuidesControl";
import PageNavigator from "./PageNavigator";
import PrintCheckControl from "./PrintCheckControl";
import WorkspacePresetControl from "./WorkspacePresetControl";

const ZOOM_MODES: readonly {
  value: ZoomMode;
  labelKey: "proview.zoom.page" | "proview.zoom.width" | "proview.zoom.actual";
  hintKey: "proview.zoom.pageHint" | "proview.zoom.widthHint" | "proview.zoom.actualHint";
}[] = [
  { value: "page", labelKey: "proview.zoom.page", hintKey: "proview.zoom.pageHint" },
  { value: "width", labelKey: "proview.zoom.width", hintKey: "proview.zoom.widthHint" },
  { value: "actual", labelKey: "proview.zoom.actual", hintKey: "proview.zoom.actualHint" },
];

export interface ProviewBarProps {
  /** 当前命中的缩放档位（手动缩放过时为 null，三个档位都不高亮）。 */
  zoomMode: ZoomMode | null;
  onZoomModeChange: (mode: ZoomMode) => void;
  /** 绝对缩放：工具条尾部显示百分比。 */
  scale: number;
  navigation: PageNavigation;
  /** 页导航上的问题位置标记（W08 提供；不传 = 零变化）。 */
  markers?: readonly PageMarker[];
  guides: GuideFlags;
  onGuidesChange: (next: GuideFlags) => void;
  proof: boolean;
  onProofChange: (next: boolean) => void;
  /** 打印检查要读纸面 iframe。 */
  viewportRef: RefObject<HTMLDivElement | null>;
  workspace?: {
    value: WorkspacePresetId;
    onChange: (next: WorkspacePresetId) => void;
    onReset: () => void;
  };
  /** 有照片才出现裁剪入口。 */
  showPhotoCrop: boolean;
  onOpenPhotoCrop: () => void;
  onOpenPalette: () => void;
  /** 已按用户当前键位格式化的快捷键，用于无障碍名。 */
  paletteShortcut: string;
}

export default function ProviewBar({
  zoomMode,
  onZoomModeChange,
  scale,
  navigation,
  markers = [],
  guides,
  onGuidesChange,
  proof,
  onProofChange,
  viewportRef,
  workspace,
  showPhotoCrop,
  onOpenPhotoCrop,
  onOpenPalette,
  paletteShortcut,
}: ProviewBarProps) {
  useLocale();
  /** PageUp / PageDown 翻页：焦点在工具条上时生效；输入框里不抢键。 */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "PageUp" && event.key !== "PageDown") return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    event.preventDefault();
    if (event.key === "PageUp") navigation.previousPage();
    else navigation.nextPage();
  };

  return (
    <div
      role="toolbar"
      aria-label={t("proview.bar.label")}
      onKeyDown={handleKeyDown}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "6px 10px",
        padding: "6px 4px 8px",
      }}
    >
      <Segmented
        size="small"
        aria-label={t("proview.zoom.label")}
        value={zoomMode ?? undefined}
        options={ZOOM_MODES.map((mode) => ({
          value: mode.value,
          label: <Tooltip title={t(mode.hintKey)}>{t(mode.labelKey)}</Tooltip>,
        }))}
        onChange={(next) => onZoomModeChange(next as ZoomMode)}
      />
      {zoomMode === "actual" ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("proview.zoom.actualNote")}
        </Typography.Text>
      ) : null}
      <Tooltip title={t("proview.pageNav.keyboardHint")}>
        <span>
          <PageNavigator navigation={navigation} markers={markers} />
        </span>
      </Tooltip>
      <GuidesControl value={guides} onChange={onGuidesChange} />
      <Tooltip title={proof ? t("proview.proof.onHint") : t("proview.proof.offHint")}>
        <Button
          size="small"
          type={proof ? "primary" : "text"}
          icon={proof ? <CheckOutlined /> : <BgColorsOutlined />}
          aria-pressed={proof}
          aria-label={t("proview.proof.label")}
          onClick={() => onProofChange(!proof)}
        >
          {t("proview.proof.label")}
        </Button>
      </Tooltip>
      <PrintCheckControl viewportRef={viewportRef} />
      {workspace ? (
        <WorkspacePresetControl
          value={workspace.value}
          onChange={workspace.onChange}
          onReset={workspace.onReset}
        />
      ) : null}
      {showPhotoCrop ? (
        <Tooltip title={t("proview.photo.hint")}>
          <Button
            size="small"
            type="text"
            icon={<ScissorOutlined />}
            aria-label={t("proview.photo.button")}
            onClick={onOpenPhotoCrop}
          >
            {t("proview.photo.button")}
          </Button>
        </Tooltip>
      ) : null}
      <Tooltip title={t("proview.command.buttonAria", { shortcut: paletteShortcut })}>
        <Button
          size="small"
          type="text"
          icon={<ThunderboltOutlined />}
          aria-label={t("proview.command.buttonAria", { shortcut: paletteShortcut })}
          onClick={onOpenPalette}
        >
          {t("proview.command.button")}
        </Button>
      </Tooltip>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("proview.zoom.percent", { value: Math.round(scale * 100) })}
      </Typography.Text>
    </div>
  );
}
