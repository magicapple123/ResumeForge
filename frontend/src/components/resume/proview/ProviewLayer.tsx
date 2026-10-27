// SPDX-License-Identifier: Apache-2.0
/**
 * 专业视图的**编排层**（W15）：把纯规则/注入模块接成真实入口。
 *
 * 挂载位置固定为 `ResumePreview` 的草稿画布上方（它由 `ResumeWorkbenchLiveCanvas`
 * 包在 `ProviewProvider` 里，主预览不包 Provider 所以零变化）。本层负责：
 *
 * - 缩放档位（整页 / 适宽 / 100%）与页导航的状态、命令表与快捷键 `commandPalette`；
 * - 辅助线、灰度校样、打印检查、当前页高亮的接入；
 * - 命令面板与照片裁剪弹窗的挂载、会话级持久化与清晰度提示。
 *
 * 所有"改文档"的动作都不在这里发生：保存/导出等由宿主命令回调执行，照片移除走宿主
 * 注入的 `onRemovePhoto`。本层只改视图状态与 localStorage 偏好。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { useProviewConfig } from "../../../features/resume-proview/ProviewContext";
import { useProviewPreferences } from "../../../features/resume-proview/preferences";
import { photoSha256, type PhotoCropParams } from "../../../features/resume-proview/photoCrop";
import {
  clearPhotoCrop,
  resolveInitialPhotoCrop,
  savePhotoCrop,
} from "../../../features/resume-proview/photoCropStore";
import {
  NO_GUIDES,
  anyGuideEnabled,
  type ProviewCommand,
  type ZoomMode,
} from "../../../features/resume-proview/types";
import { usePageMarkers } from "../../../features/resume-proview/pageMarkers";
import {
  useCurrentPageHighlight,
  useProviewOverlaySync,
} from "../../../features/resume-proview/useProviewOverlaySync";
import { usePageNavigation } from "../../../features/resume-proview/usePageNavigation";
import { resolveZoomMode, zoomFactorForMode } from "../../../features/resume-proview/zoomModes";
import { formatShortcut } from "../../../features/shortcuts/matchShortcut";
import { useShortcut, useShortcutSettings } from "../../../features/shortcuts/useShortcutKeymap";
import PhotoCropModal from "../photo-crop/PhotoCropModal";
import CommandPalette from "./CommandPalette";
import ProviewBar from "./ProviewBar";

export interface ProviewLayerProps {
  /** 预览视口（纸面 iframe 的父节点）。 */
  viewportRef: RefObject<HTMLDivElement | null>;
  /** 视觉页数（用户设置的篇幅上限）。 */
  pageCount: number;
  /** 一页的未缩放尺寸（iframe 内部坐标系）。 */
  pageWidth: number;
  pageHeight: number;
  /** 当前缩放系数（1 = fit）与绝对缩放。 */
  zoom: number;
  scale: number;
  fitScale: number;
  viewportWidth: number;
  onZoomChange: (factor: number) => void;
  /** 每次 iframe load / 重排后自增：覆盖层与页位置要重新同步。 */
  frameEpoch: number;
}

export default function ProviewLayer({
  viewportRef,
  pageCount,
  pageWidth,
  pageHeight,
  zoom,
  scale,
  fitScale,
  viewportWidth,
  onZoomChange,
  frameEpoch,
}: ProviewLayerProps) {
  useLocale();
  const config = useProviewConfig();
  const { preferences, setGuides, setProof } = useProviewPreferences();
  const navigation = usePageNavigation({
    viewportRef,
    totalPages: pageCount,
    refreshKey: frameEpoch,
  });
  const pageMarkers = usePageMarkers();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [crop, setCrop] = useState<PhotoCropParams | null>(() =>
    resolveInitialPhotoCrop(config?.photo?.crop, config?.resumeId),
  );

  const geometry = useMemo(
    () => ({ fitScale, viewportWidth, pageWidth }),
    [fitScale, pageWidth, viewportWidth],
  );
  const activeMode = resolveZoomMode(scale, geometry);
  const photo = config?.photo?.photo ?? "";
  const photoHash = useMemo(() => (photo ? photoSha256(photo) : null), [photo]);
  // 换图后旧裁剪必须失效：哈希对不上 = 没有裁剪（与后端 photo_sha256 同口径）。
  const activeCrop = crop && photoHash && crop.source.sha256 === photoHash ? crop : null;

  const shortcutSettings = useShortcutSettings();
  const paletteShortcut = formatShortcut(
    shortcutSettings.bindings.commandPalette?.[0] ?? "mod+shift+p",
  );
  useShortcut("commandPalette", (event) => {
    event.preventDefault();
    setPaletteOpen(true);
  });

  // 宿主若给的是"已保存的裁剪"（未来 format_config），以宿主为准；本地桥只在没有时兜底。
  const shellCrop = config?.photo?.crop ?? null;
  const resumeId = config?.resumeId;
  useEffect(() => {
    setCrop(resolveInitialPhotoCrop(shellCrop, resumeId));
  }, [resumeId, shellCrop]);

  // 照片裁剪**不进覆盖层**：后端已按 format_config.photo_crop 派生裁剪图，再叠一层
  // object-view-box 会二次裁切（#10 用户看到"裁剪取景不对"的根因）。
  useProviewOverlaySync({
    viewportRef,
    guides: preferences.guides,
    proof: preferences.proof,
    pageWidth,
    pageHeight,
    frameEpoch,
  });
  useCurrentPageHighlight({ viewportRef, currentPage: navigation.currentPage, frameEpoch });

  const selectMode = useCallback(
    (mode: ZoomMode) => onZoomChange(zoomFactorForMode(mode, geometry)),
    [geometry, onZoomChange],
  );
  // 纸面宽度由弹窗自己量（ref 只在 effect 里读）——这里只负责开弹窗，避免把
  // "读 ref 的回调"送进命令表时触发 react-hooks/refs 的渲染期读 ref 误报。
  const openPhotoCrop = useCallback(() => setCropOpen(true), []);

  const applyCrop = useCallback(
    (params: PhotoCropParams | null) => {
      setCrop(params);
      if (params) savePhotoCrop(resumeId, params);
      else clearPhotoCrop(resumeId);
      config?.photo?.onCropChange?.(params);
    },
    [config?.photo, resumeId],
  );
  const removePhoto = useCallback(() => {
    setCrop(null);
    clearPhotoCrop(resumeId);
    config?.photo?.onRemovePhoto?.();
  }, [config?.photo, resumeId]);

  /**
   * 内置视图命令（缩放/辅助线/灰度/翻页/照片裁剪）。
   *
   * 刻意**不包 useMemo**：命令的 run 是读取 viewportRef 的回调，把这种函数塞进 useMemo
   * 会被 react-hooks/refs 判定为"渲染期可能读 ref"；命令表只有十来条，每帧重建的成本
   * 远低于一条误报（以及未来真把 ref 读进渲染的风险）。
   */
  const builtInCommands: ProviewCommand[] = (() => {
    const list: ProviewCommand[] = [
      {
        id: "proview.zoom.page",
        label: t("proview.cmd.zoomPage"),
        keywords: ["zoom", "page", "fit"],
        run: () => selectMode("page"),
      },
      {
        id: "proview.zoom.width",
        label: t("proview.cmd.zoomWidth"),
        keywords: ["zoom", "width", "fit"],
        run: () => selectMode("width"),
      },
      {
        id: "proview.zoom.actual",
        label: t("proview.cmd.zoomActual"),
        keywords: ["zoom", "100", "actual"],
        run: () => selectMode("actual"),
      },
      {
        id: "proview.zoom.in",
        label: t("proview.cmd.zoomIn"),
        keywords: ["zoom", "in"],
        run: () => onZoomChange(zoom + 0.1),
      },
      {
        id: "proview.zoom.out",
        label: t("proview.cmd.zoomOut"),
        keywords: ["zoom", "out"],
        run: () => onZoomChange(zoom - 0.1),
      },
      {
        id: "proview.guides.toggle",
        label: t("proview.cmd.guides"),
        keywords: ["guides", "margin", "baseline"],
        run: () =>
          setGuides(
            anyGuideEnabled(preferences.guides)
              ? NO_GUIDES
              : { margins: true, columns: true, baselines: true, paragraphs: true },
          ),
      },
      {
        id: "proview.proof.toggle",
        label: t("proview.cmd.proof"),
        keywords: ["grayscale", "print", "bw"],
        run: () => setProof(!preferences.proof),
      },
      {
        id: "proview.page.prev",
        label: t("proview.cmd.prevPage"),
        keywords: ["page", "previous"],
        run: navigation.previousPage,
      },
      {
        id: "proview.page.next",
        label: t("proview.cmd.nextPage"),
        keywords: ["page", "next"],
        run: navigation.nextPage,
      },
    ];
    if (photo) {
      list.push({
        id: "proview.photo.crop",
        label: t("proview.cmd.photoCrop"),
        keywords: ["photo", "crop"],
        run: openPhotoCrop,
      });
    }
    return list;
  })();

  // 宿主命令（保存/导出/检查…）排在前面：它们最高频，也最该出现在「最近使用」顶部。
  const commands: ProviewCommand[] = [...(config?.commands ?? []), ...builtInCommands];

  return (
    <div>
      <ProviewBar
        zoomMode={activeMode}
        onZoomModeChange={selectMode}
        scale={scale}
        navigation={navigation}
        markers={pageMarkers}
        guides={preferences.guides}
        onGuidesChange={setGuides}
        proof={preferences.proof}
        onProofChange={setProof}
        viewportRef={viewportRef}
        workspace={config?.workspace}
        showPhotoCrop={Boolean(photo)}
        onOpenPhotoCrop={openPhotoCrop}
        onOpenPalette={() => setPaletteOpen(true)}
        paletteShortcut={paletteShortcut}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
      />
      {photo ? (
        <PhotoCropModal
          open={cropOpen}
          onClose={() => setCropOpen(false)}
          photo={photo}
          initialCrop={activeCrop}
          viewportRef={viewportRef}
          onApply={applyCrop}
          onRemove={config?.photo?.onRemovePhoto ? removePhoto : undefined}
        />
      ) : null}
    </div>
  );
}
