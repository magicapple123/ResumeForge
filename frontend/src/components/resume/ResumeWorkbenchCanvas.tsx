// SPDX-License-Identifier: Apache-2.0
/**
 * 简历制作台 · **右栏画布**：一条浮动说明 + 中性底色 + 纸张投影 + 预览本体。
 *
 * ## 为什么不在这里再写一个渲染器
 *
 * 复用同一个 `ResumePreview`（而不是按"三栏"再排一遍）：两份实现迟早会在分页、缩放、
 * 编辑定位这些细节上分叉，而"看到的和导出的一致"正是这一块的全部意义。
 *
 * ## 高度（2026-10 修）
 *
 * 不传 `height`（那会按窗口高度猜）。`ResumePreview` 内部用 `window.innerHeight × 0.62`
 * 估算可用高度——那个口径是给"嵌在列表页里的主预览"定的，三栏之后右栏的实际高度与
 * 窗口高度已经没有固定比例：窗口高 900、右栏只有 700 时，纸张按 0.62 算出来偏小，
 * 于是"打开制作台看到一页纸缩在中间、四周一大片留白"。
 *
 * 这里改成**量这一栏的真实高度**并作为可选入参传给预览（`availableHeight`）：
 * - 用 `ResizeObserver` 的 `contentRect.height`（内容盒高度，已排除画布的 12/16px 内边距），
 *   拖动分隔条、折叠中栏、换窗口大小时都会重新量一次；
 * - 量不到（首帧、jsdom 里 `clientHeight` 恒为 0）时传 `undefined`，预览退回它自己的
 *   窗口比例口径——**主预览一行代码都没变**。
 *
 * 目标很具体：制作台打开时**恰好一页 A4 完整可见**，缩放读数就是那个 fit 比例。
 *
 * ## 说明文字为什么在画布上浮一条而不是弹窗顶部
 *
 * 那句话解释的是**眼前这张纸**（虚线 = 分页、缩放怎么用），贴着纸比贴在弹窗外壳上更近；
 * 外壳上的 56px 动作条已经只放动作，不再兼说明。
 */
import { Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import ResumePreview, {
  type ExactPreviewOptions,
  type ResumePreviewHandle,
} from "../ResumePreview";
import type { PreviewMode } from "../resume-preview/config";
import { t } from "../../i18n";

interface Props {
  html: string;
  warnings: string[];
  /** 与记录里的页数上限一致；预览里那几根虚线就是按它切的。 */
  pages: number;
  /** 版式控件拖动时要往**这一个** iframe 里注入探针，所以句柄由宿主持有再传进来。 */
  previewRef: RefObject<ResumePreviewHandle | null>;
  previewMode?: PreviewMode;
  onPreviewModeChange?: (mode: PreviewMode) => void;
  /** 精确预览所需的上下文（与主预览逐字段相同）。 */
  exactPreview?: ExactPreviewOptions;
  /**
   * 「草稿模式编辑」：点纸面字段时把路径交给宿主（制作台据此定位中栏的输入框）。
   * 不传时预览不渲染那个复选框，也不挂任何监听。
   */
  onPickField?: (path: string) => void;
}

/**
 * 滚动容器**内容盒**的高度（扣掉上下内边距）。
 *
 * 用它而不是只靠 `ResizeObserver`：观察器的第一枪要等一次布局，而"刚打开制作台"的
 * 那一帧就该有值，否则用户会先看到一次纸张尺寸跳变。
 */
function contentBoxHeight(node: HTMLElement): number {
  const style = window.getComputedStyle(node);
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
  const height = node.clientHeight - paddingTop - paddingBottom;
  return height > 0 ? Math.round(height) : 0;
}

export default function ResumeWorkbenchCanvas({
  html,
  warnings,
  pages,
  previewRef,
  previewMode,
  onPreviewModeChange,
  exactPreview,
  onPickField,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // `undefined` = 还没量到：预览据此退回它自己的窗口比例口径（主预览即这一支）。
  const [availableHeight, setAvailableHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const apply = (height: number) => {
      const next = height > 0 ? Math.round(height) : undefined;
      setAvailableHeight((previous) => (previous === next ? previous : next));
    };
    apply(contentBoxHeight(node));
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) apply(rect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="resume-wb-canvas">
      {/* 两句话分两个 `<span>`：句末标点不该由界面拼——拼出来的那份文案没法单独翻译。 */}
      <div className="resume-wb-canvas-bar">
        <Typography.Text type="secondary" className="resume-wb-canvas-note">
          {t("workbench.note.canvas", { pages })}
        </Typography.Text>
        <Typography.Text type="secondary" className="resume-wb-canvas-note">
          {t("workbench.note.zoom")}
        </Typography.Text>
      </div>
      <div className="resume-wb-canvas-scroll" ref={scrollRef}>
        <ResumePreview
          ref={previewRef}
          html={html}
          pages={pages}
          warnings={warnings}
          previewMode={previewMode}
          onPreviewModeChange={onPreviewModeChange}
          exactPreview={exactPreview}
          availableHeight={availableHeight}
          onPickField={onPickField}
        />
      </div>
    </div>
  );
}
