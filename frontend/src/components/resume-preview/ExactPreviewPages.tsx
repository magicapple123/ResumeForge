// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览的**纸面**：相框里那一叠 A4 位图（可见层 + 透明的待换层 + 重排遮罩）。
 *
 * 从 `ExactPreviewPanel` 拆出（单文件 500 行预算）：那边负责"什么时候要一版、旧的一版
 * 什么时候让位"，这边只把**已经算好的**值画成 DOM。
 *
 * 2026-11（P3-2）之前这里挂的是两个 `<iframe src="blob:…pdf">`。换成 `<img>` 之后：
 *
 * - 不再有查看器自己的两条滚动条（右侧竖向、底部横向）与纸边深色描边——那三样都画在
 *   查看器的**内部文档**里，外层 CSS 够不到；
 * - 相框高度 = 逐页高之和 + 页间距，不再需要 `VIEWER_CHROME_PX = 56` 去补工具栏；
 * - 无头 Chromium 也能截出完整页面（此前查看器在 headless 下不出图，CI 一直是盲区）。
 *
 * 两层分工没变：可见层在下（不透明），待换层在上（完全透明）——位图没有渐进渲染，
 * 换 `src` 的瞬间就是一片白，所以要等新的一版**每一张图都就绪**再一次性顶上来。
 */
import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import {
  previewPageHeight,
  previewPageImageUrl,
  type PreviewPageImage,
  type PreviewShot,
} from "./previewPages";

/** 一叠纸：页序即导出 PDF 的页序。 */
function PageStack({
  resumeId,
  token,
  pages,
  pageWidth,
  gap,
  /** 读屏文案；`null` = 不念（待换层是 `aria-hidden` 的）。 */
  altFor,
  onPageSettled,
  className,
}: {
  resumeId: number;
  token: string;
  pages: PreviewPageImage[];
  pageWidth: number;
  gap: number;
  altFor: ((page: PreviewPageImage) => string) | null;
  /** 每张图就绪（或失败）回调；待换层用它数够了没有。 */
  onPageSettled?: () => void;
  className: string;
}) {
  return (
    <div className={className} style={{ gap }}>
      {pages.map((page) => {
        const height = previewPageHeight(page, pageWidth);
        return (
          <img
            key={page.index}
            src={previewPageImageUrl(resumeId, token, page.index)}
            alt={altFor ? altFor(page) : ""}
            // 显式给宽高（属性 + 内联样式）：图没到之前也占好位置，相框不会先塌再撑开。
            width={pageWidth}
            height={height}
            style={{ width: pageWidth, height }}
            // 纸是"看"的，不是"拖"的：拖拽会画出半透明残影，把一页纸读成两张。
            draggable={false}
            className="exact-preview-page-image"
            onLoad={onPageSettled}
            onError={onPageSettled}
          />
        );
      })}
    </div>
  );
}

/**
 * 待换层：完全透明地先把新一版的图解码出来，数够了再让宿主顶上去。
 *
 * `key` 由宿主按 token 给：换一版就整块重建，内部计数器随之归零——不用手写重置逻辑，
 * 也就不会出现"上一版数到 3、新一版只有 1 页于是立刻判定就绪"的错位。
 */
function PendingPages({
  resumeId,
  shot,
  pageWidth,
  gap,
  onReady,
}: {
  resumeId: number;
  shot: PreviewShot;
  pageWidth: number;
  gap: number;
  onReady: () => void;
}) {
  const [settled, setSettled] = useState(0);
  const total = shot.pages.length;

  useEffect(() => {
    if (total > 0 && settled >= total) onReady();
  }, [settled, total, onReady]);

  return (
    <PageStack
      resumeId={resumeId}
      token={shot.token}
      pages={shot.pages}
      pageWidth={pageWidth}
      gap={gap}
      altFor={null}
      // 单张失败也必须计数：否则永远等不到"全部就绪"，界面卡在忙碌态。
      onPageSettled={() => setSettled((count) => count + 1)}
      className="exact-preview-pages exact-preview-pages-pending"
    />
  );
}

export default function ExactPreviewPages({
  resumeId,
  current,
  pending,
  pageWidth,
  gap,
  stackHeight,
  busy,
  onPendingReady,
}: {
  resumeId: number;
  /** 当前可见的那一版。 */
  current: PreviewShot;
  /** 正在预加载、完全透明的那一版；图全部就绪后由宿主换上来。 */
  pending: PreviewShot | null;
  /** 单页在屏幕上的 CSS 宽（相框宽 × 缩放，已取整）。 */
  pageWidth: number;
  /** 页与页之间的空隙（CSS px，已按缩放折算）。 */
  gap: number;
  /** 相框高度 = 可见层所有页高 + 页间距。 */
  stackHeight: number;
  /** 请求在飞或新一版还没顶上来——遮罩要与状态行同一口径。 */
  busy: boolean;
  /** 待换层的每一张图都就绪（或失败）：宿主此时才把它顶上来。 */
  onPendingReady: () => void;
}) {
  useLocale();
  return (
    <div className="exact-preview-paper-column" style={{ width: pageWidth }}>
      <div
        className="exact-preview-stack"
        style={{ width: pageWidth, height: stackHeight }}
        // 预览区仍然要有一个整体名称：旧实现挂在 `<iframe title>` 上，改成逐页图片后
        // 这层名字没了，读屏只会念一串"第 N 页"而不知道它们是什么。`role=group` 让它
        // 成为一个有名字的区域；`title` 同时保留给"悬停可读"，两者共用同一条文案。
        role="group"
        aria-label={t("preview.exact.frameTitle")}
        title={t("preview.exact.frameTitle")}
        // jsdom 量不出像素：把"这版实际几页 / 相框多高"写进 data 属性供测试断言。
        data-pages={current.pages.length}
        data-frame-height={stackHeight}
      >
        <PageStack
          resumeId={resumeId}
          token={current.token}
          pages={current.pages}
          pageWidth={pageWidth}
          gap={gap}
          // 读屏按"第 N 页"念：屏幕上的页序与导出 PDF 的页序一致。
          altFor={(page) => t("preview.exact.pageAlt", { page: page.index + 1 })}
          className="exact-preview-pages"
        />
        {pending ? (
          <PendingPages
            key={pending.token}
            resumeId={resumeId}
            shot={pending}
            pageWidth={pageWidth}
            gap={gap}
            onReady={onPendingReady}
          />
        ) : null}
        {busy ? (
          <div className="exact-preview-overlay" aria-busy="true">
            <span className="exact-preview-overlay-text">{t("exact.status.busy")}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
