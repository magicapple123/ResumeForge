// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览的**纸面**：相框里那一列 A4（可见层 + 透明预加载层 + 重排遮罩）。
 *
 * 从 `ExactPreviewPanel.tsx` 拆出（2026-11 行数预算）：那边负责"什么时候排、排哪一版、
 * objectURL 何时释放"，这边只负责把这些**已经算好的**值画成 DOM。纯展示拆分，DOM 结构、
 * 类名、`data-*` 属性与 `aria` 一律与拆分前逐字一致——外层 CSS 与快照/查询断言都依赖它们。
 *
 * 两个 iframe 的分工（见 `ExactPreviewPanel` 文件头的双缓冲说明）：第一个是**当前可见**的
 * 那一份；第二个在 `pending` 存在时以完全透明的方式预加载，`onLoad` 后由宿主换上来。
 */
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { PreviewShot } from "./exactPreviewCache";
import { withPageWidthZoom } from "./pdfViewerSupport";

interface Props {
  /** 当前可见的那一份（旧图，双缓冲里留在下面）。 */
  current: PreviewShot;
  /** 正在预加载、完全透明的那一份；`onLoad` 后顶替成 `current`。 */
  pending: PreviewShot | null;
  /** 会话页宽缩放后的可见层 URL（`null` 时退回原始 URL 的 `#zoom=page-width`）。 */
  framedUrl: string | null;
  /** 同上，给预加载层用。 */
  pendingUrl: string | null;
  /** 可见层 iframe 的 key（含版本 + 缩放档位）：换 URL 时强制干净重建查看器（Q18）。 */
  currentFrameKey: string;
  /** 预加载层 iframe 的 key；没有 pending 时为 null。 */
  pendingFrameKey: string | null;
  /** PDF 里**实际排出来**的页数（缺省按 1 页算，见宿主）。 */
  renderedPages: number;
  frameHeight: number;
  paperHeight: number;
  viewWidth: number;
  scale: number;
  /** 相框宽度量得出来时才按页数铺纸（jsdom 里量不出，走回退分支）。 */
  scalable: boolean;
  /** 请求在飞或新图还没顶上来——遮罩要与状态行同一口径。 */
  busy: boolean;
  /** 可见层 `onLoad`：清掉「加载超时」兜底状态。 */
  onCurrentLoad: () => void;
  onSwapIn: () => void;
}

export default function ExactPreviewPaper({
  current,
  pending,
  framedUrl,
  pendingUrl,
  currentFrameKey,
  pendingFrameKey,
  renderedPages,
  frameHeight,
  paperHeight,
  viewWidth,
  scale,
  scalable,
  busy,
  onCurrentLoad,
  onSwapIn,
}: Props) {
  useLocale();
  return (
    /* 只画**实际排出来的页**（2026-10-24 用户口径）：PDF 里没有的页这里也不补，预览与下载到的文件永远一致。 */
    <div
      className="exact-preview-paper-column"
      style={scalable ? { width: viewWidth, height: paperHeight } : { width: `${scale * 100}%` }}
    >
      <div
        className="exact-preview-stack"
        style={scalable ? { width: viewWidth, height: paperHeight } : { height: frameHeight }}
        // jsdom 量不出像素，把"这版实际几页 / 相框多高"写进 data 属性供测试断言。
        data-pages={renderedPages}
        data-frame-height={frameHeight}
      >
        {/* 与导出的 PDF 是同一份字节；`#zoom=page-width` 是相框高度的契约（见 `withPageWidthZoom`）。 */}
        <iframe
          key={`current:${currentFrameKey}`}
          src={framedUrl ?? withPageWidthZoom(current.url)}
          title={t("preview.exact.frameTitle")}
          className="exact-preview-frame"
          // 查看器内部那两条黑粗滚动条是它自己画的，外层 CSS 管不到，只能用这个旧属性关掉。
          scrolling="no"
          onLoad={onCurrentLoad}
        />
        {pending ? (
          // 透明的预加载层：`onLoad` 前谁也看不见它，但浏览器已经在解析新 PDF。
          <iframe
            key={`pending:${pendingFrameKey ?? "pending"}`}
            src={pendingUrl ?? withPageWidthZoom(pending.url)}
            title={t("preview.exact.pendingFrameTitle")}
            aria-hidden="true"
            tabIndex={-1}
            className="exact-preview-frame exact-preview-frame-pending"
            scrolling="no"
            onLoad={onSwapIn}
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
