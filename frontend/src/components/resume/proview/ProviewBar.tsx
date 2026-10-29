// SPDX-License-Identifier: Apache-2.0
/**
 * 专业视图工具条（D04/D05/D10）：缩放档位、页导航、辅助线、灰度校样、打印检查、
 * 工作区预设、照片裁剪入口、命令面板入口。
 *
 * 纯展示 + 键盘转发：状态全部由 `ProviewLayer` 持有（偏好、命令、裁剪参数）。
 * 单独成文件的原因是 ProviewLayer 还要管命令表、覆盖层注入与弹窗，堆在一起会超
 * 单文件 300 行目标。
 *
 * **悬停提示只留「辅助线」一处在 `GuidesControl` 里**（2026-10-29 用户要求：制作台
 * 右栏只保留「草稿模式编辑」「恢复默认布局」「辅助线」三条提示）。本条其余入口一律
 * 不弹 Tooltip——信息改由按钮文字与 aria-label 承担，少一层浮层也就少一次误挡操作。
 */
import {
  BgColorsOutlined,
  CheckOutlined,
  ScissorOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Button, Segmented, Typography } from "antd";
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

/**
 * 三个缩放档位。
 *
 * 2026-10-29 用户要求：**只保留**「辅助线」「恢复默认布局」「草稿模式编辑」三处悬停提示，
 * 其余（缩放档位 / 翻页 / 灰度校样 / 打印检查 / 工作区预设 / 照片裁剪 / 命令）一律不再弹
 * Tooltip。这里因此不再带 `hintKey`——按钮文字本身已经说清它做什么，无障碍名由 aria-label
 * 提供，不靠悬浮层传递信息。
 */
const ZOOM_MODES: readonly {
  value: ZoomMode;
  labelKey: "proview.zoom.page" | "proview.zoom.width" | "proview.zoom.actual";
}[] = [
  { value: "page", labelKey: "proview.zoom.page" },
  { value: "width", labelKey: "proview.zoom.width" },
  { value: "actual", labelKey: "proview.zoom.actual" },
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
        // 2026-10-29 用户要求把右栏头部整体压低（下面要多放纸面）：内边距与行距各收一档。
        gap: "4px 8px",
        padding: "2px 4px",
      }}
    >
      <Segmented
        size="small"
        aria-label={t("proview.zoom.label")}
        value={zoomMode ?? undefined}
        options={ZOOM_MODES.map((mode) => ({
          value: mode.value,
          label: t(mode.labelKey),
        }))}
        onChange={(next) => onZoomModeChange(next as ZoomMode)}
      />
      {zoomMode === "actual" ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("proview.zoom.actualNote")}
        </Typography.Text>
      ) : null}
      <PageNavigator navigation={navigation} markers={markers} />
      <GuidesControl value={guides} onChange={onGuidesChange} />
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
      <PrintCheckControl viewportRef={viewportRef} />
      {workspace ? (
        <WorkspacePresetControl
          value={workspace.value}
          onChange={workspace.onChange}
          onReset={workspace.onReset}
        />
      ) : null}
      {showPhotoCrop ? (
        <Button
          size="small"
          type="text"
          icon={<ScissorOutlined />}
          aria-label={t("proview.photo.button")}
          onClick={onOpenPhotoCrop}
        >
          {t("proview.photo.button")}
        </Button>
      ) : null}
      <Button
        size="small"
        type="text"
        icon={<ThunderboltOutlined />}
        aria-label={t("proview.command.buttonAria", { shortcut: paletteShortcut })}
        onClick={onOpenPalette}
      >
        {t("proview.command.button")}
      </Button>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("proview.zoom.percent", { value: Math.round(scale * 100) })}
      </Typography.Text>
    </div>
  );
}
