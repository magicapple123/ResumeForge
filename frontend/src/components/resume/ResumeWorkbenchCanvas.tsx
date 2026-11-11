// SPDX-License-Identifier: Apache-2.0
/**
 * 简历制作台 · **右栏画布**：中性底色 + 纸张投影 + 预览本体 + 一小块实时预览状态。
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
 * 目标很具体（Q21）：制作台打开时**纸宽恰好等于右栏宽度**（`fitMode="width"`），
 * 纵向滚动看全。不按"整页可见"算——右栏窄而高，按整页会把纸缩到六成、两侧留大片灰边。
 *
 * ## 说明文字为什么在纸面**下方**（2026-11 改）
 *
 * 那句话解释的是**眼前这张纸**（虚线 = 分页、缩放怎么用），贴着纸比贴在弹窗外壳上更近。
 * 它曾经是画布上方的一条浮层；用户反馈那条浮层占掉了纸的高度、又和下方的缩放按钮
 * 说着同一件事，于是并成一句交给 `PreviewZoomBar` 的 `hint`：说明落在纸面下方、
 * 与缩放按钮同处一行，且随滚动一直可见（`workbench-canvas.css` 里吸底）。
 * 画布上方只留实时预览状态（没有状态时整条不渲染，不留空白盒）。
 *
 * ## 为什么这里上报测量（#24 24B，2026-11-11 补）
 *
 * 制作台此前只把 html / 页数 / 预览口径交给预览，**一个测量回调都没接**：于是右栏画得出
 * 纸、左栏却连"占用 426%"都算不出来（`.html` 排完多高只有 iframe 自己知道）。用户在左栏
 * 拖滑块时完全是盲改。
 *
 * 现在这一层接住 `onMeasure` / `onLayoutStatus` 并写进 `workbenchLayoutStore`——左栏
 * 「版面」组顶部的常驻状态条订阅同一份快照。**不改上层签名**：左栏与右栏没有共同 props 链，
 * 把状态提到外壳再传下去要改三处（外壳已贴 500 行预算），而 `paginationReportStore` 已经
 * 用同样的办法解决过同一个形状的问题。
 *
 * 口径与阈值**不在这里**：住 `layoutStatusSummary.ts`（与预览卡的诊断条共用一份）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import ResumePreview, {
  type ExactPreviewOptions,
  type ResumePreviewHandle,
} from "../ResumePreview";
import type { PreviewMode, PreviewLayoutStatus } from "../resume-preview/config";
import type { LayoutMeasure } from "../../utils/resumeLayoutMeasure";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { resetWorkbenchLayout, syncWorkbenchLayout } from "./workbenchLayoutStore";

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
  /**
   * 滚动容器的句柄。实时预览替换 html 后要按它恢复滚动位置，而容器住在这里——
   * 不传时用组件自己的内部 ref（行为与之前逐字相同）。
   */
  scrollRef?: RefObject<HTMLDivElement | null>;
  /** 画布条尾部的一小块状态（实时预览的「更新中…」/「上一次成功预览 + 重试」）。 */
  status?: ReactNode;
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
  scrollRef: externalScrollRef,
  status,
}: Props) {
  useLocale();
  const internalScrollRef = useRef<HTMLDivElement>(null);
  // 宿主给了句柄就用它（实时预览靠它恢复滚动位置），没给时这一层自管。
  const scrollRef = externalScrollRef ?? internalScrollRef;
  // `undefined` = 还没量到：预览据此退回它自己的窗口比例口径（主预览即这一支）。
  const [availableHeight, setAvailableHeight] = useState<number | undefined>(undefined);
  /**
   * #24 24B：接住预览上报的测量。
   *
   * 这一层是全站**唯一**能拿到 `LayoutMeasure` 的制作台位置（iframe 在 `ResumePreview`
   * 里），而它算出来的占用率正是左栏「版面」组那条状态条要显示的数字——此前这一层
   * 一个测量回调都没传，于是左栏"连 426% 这个数都算不出来"（#24 现状盘点的结论）。
   *
   * 只在本层写进 store（左栏订阅），不改任何一个上层签名：见 `workbenchLayoutStore`。
   */
  const [measure, setMeasure] = useState<LayoutMeasure | null>(null);
  const [layoutStatus, setLayoutStatus] = useState<PreviewLayoutStatus | null>(null);

  /**
   * 回调身份必须稳：`ResumePreview` 的 `applyLayoutToFrame` 把这两个回调写进了
   * `useCallback` 依赖，`useFrameRelayout` 又按 `applyLayout` 的引用重排——每次渲染换一个
   * 内联箭头函数就等于让右栏不停地重新排版。所以这里 `useCallback([])` + 值不变就返回原对象，
   * 顺带把"同一高度重复上报"折叠掉（预览会在字体就绪、缩放变化时各报一次同样的高度）。
   */
  const handleMeasure = useCallback((next: LayoutMeasure) => {
    setMeasure((previous) =>
      previous &&
      previous.usedHeight === next.usedHeight &&
      previous.pageContentHeight === next.pageContentHeight &&
      previous.pageLimit === next.pageLimit
        ? previous
        : next,
    );
  }, []);
  const handleLayoutStatus = useCallback((next: PreviewLayoutStatus) => {
    setLayoutStatus((previous) =>
      previous &&
      previous.pages === next.pages &&
      previous.overflow === next.overflow &&
      previous.pagesNeeded === next.pagesNeeded &&
      previous.pagesRendered === next.pagesRendered
        ? previous
        : next,
    );
  }, []);

  useEffect(() => {
    syncWorkbenchLayout({ measure, layoutStatus });
  }, [layoutStatus, measure]);

  // 画布卸载即清空：否则关掉制作台再打开，左栏会先显示上一份简历的旧数字。
  useEffect(() => resetWorkbenchLayout, []);

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
  }, [scrollRef]);

  return (
    <div className="resume-wb-canvas">
      {/* 画布上方只留实时预览状态：没有状态时**整条不渲染**（渲染一个空盒子会在纸上
          多出一条 32px 的灰条，而它什么信息都没有）。 */}
      {status ? <div className="resume-wb-canvas-bar">{status}</div> : null}
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
          // #24 24B：把测量接上（左栏状态条读的就是这两个回调写进 store 的那份）。
          onMeasure={handleMeasure}
          onLayoutStatus={handleLayoutStatus}
          // 右栏窄而高：按宽度适应（纸宽 = 相框宽），高度交给纵向滚动（Q21）。
          fitMode="width"
          onPickField={onPickField}
          // 说明并进纸面下方那行缩放条（分页口径 + 缩放怎么用，用「 · 」连成一句）。
          zoomHint={`${t("workbench.note.canvas", { pages })} · ${t("workbench.note.zoomInline")}`}
        />
      </div>
    </div>
  );
}
