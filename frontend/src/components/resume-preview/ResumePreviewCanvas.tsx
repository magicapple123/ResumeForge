// SPDX-License-Identifier: Apache-2.0
import { useEffect, type RefObject, type SyntheticEvent } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useResolvedTheme } from "../../features/theme/themeStore";
import { A4_HEIGHT_PX, A4_WIDTH_PX, OVERFLOW_PAGE_LABEL_KEY, PAGE_STACK_GAP_PX } from "./config";
import { UNLIMITED_PAGE_LIMIT } from "../../types";
import { paintLoadedPaperFrames, paintPaperTheme } from "./paperTheme";

interface Props {
  isPanning: boolean;
  viewportHeight: number;
  scaledWidth: number;
  scaledHeight: number;
  scale: number;
  /** 视觉上要画几张 A4（`max(页数上限, 内容实际需要)`，见 `overflow.ts`）。 */
  totalVisualPages: number;
  /**
   * 用户设定的页数上限（导出按它截断）。
   *
   * 第 `pageLimit + 1` 页起是**超额页**：照样画出来，但纸边是 2px 红实线、页脚下方一条
   * 通栏红带写着「超出上限，不计入导出」，让"这一页在导出里不存在"这件事在纸面上自己说清楚
   * （问题 2 的现象、问题 24 的强度）。
   */
  pageLimit: number;
  html: string;
  containerRef: RefObject<HTMLDivElement | null>;
  /** 第 1 页的 iframe：版面测量与字号探针都作用在它身上。 */
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onIframeLoad: (event: SyntheticEvent<HTMLIFrameElement>, index: number) => void;
  /**
   * 「草稿模式编辑」是否生效：只用来给视口加一个 `is-click-to-edit` 标记。
   *
   * 真正"哪里能点"的样式必须注入 iframe **内部**（纸面是后端 HTML，父页面样式进不去，
   * 见 `./clickToEdit.ts`）；这里这个 class 是给宿主与测试用的外层标记。
   */
  clickToEdit?: boolean;
}

/**
 * 草稿画布：**每页一张 A4，竖向堆叠**（2026-10-21 用户要求）。
 *
 * 为什么是 N 个 iframe 而不是一个宽 iframe：分页本身仍然靠 CSS 多列——把 body 撑成
 * `N × 794` 宽、`column-count: N`，第 i 列就是第 i 页。横向排完之后，每个 iframe 只开
 * 一个 A4 的窗口并**横向滚动到第 i 列**（`scrollLeft = i × 794`），于是同一份排版结果
 * 被"裁"成 N 张独立的纸，再竖向摞起来。
 *
 * 这样断点口径一点没变（列宽 / 列间距仍按页边距算、`break-inside: avoid` 仍生效），
 * 变的只是观看方式：横向并排要看第 2 页得先横滚，而简历的阅读顺序是从上往下。
 *
 * 代价是同一份 HTML 被渲染 N 次（N = 纸张数，本批上限 3 页、超限时可到 8 页）：照片这类
 * 内嵌 data URL 会各存一份。换成"一个 iframe + JS 切分 DOM"能省内存，但那要自己复刻浏览器
 * 分页，断点必然漂移。
 */
export default function ResumePreviewCanvas({
  isPanning,
  viewportHeight,
  scaledWidth,
  scaledHeight,
  scale,
  totalVisualPages,
  pageLimit,
  html,
  containerRef,
  iframeRef,
  onIframeLoad,
  clickToEdit = false,
}: Props) {
  useLocale();
  /**
   * 草稿纸跟随主题（问题 19 方案 A）：深色下 iframe 整体反色，证件照由注入的样式抵消一次。
   *
   * **只作用于预览**：导出走服务端渲染，`--rf-paper` 与模板一行没动；`@media print` 里把
   * 滤镜关掉，`Ctrl+P` 打出来仍是白纸。这里用 `useResolvedTheme` 而不是 `useThemeMode`：
   * 「跟随系统」时前者已经解析成实际生效的深浅。
   */
  const darkPaper = useResolvedTheme() === "dark";
  // 切主题**不重载 iframe**（重载会闪白、丢滚动位置与缩放档位）：只把已加载的文档刷一遍。
  useEffect(() => {
    paintLoadedPaperFrames(containerRef.current, darkPaper);
  }, [containerRef, darkPaper]);
  // 「不限篇幅」（`pageLimit === 0`）没有上限，因此**没有任何一页是"超额页"**：
  // 画上红实线 + 「超出上限，不计入导出」是假话——那时导出一个字节都不裁。
  const unlimited = pageLimit === UNLIMITED_PAGE_LIMIT;
  const limit = Math.max(1, Math.round(pageLimit));
  return (
    <>
      <div
        ref={containerRef}
        className={`resume-preview-viewport${isPanning ? " is-panning" : ""}${
          clickToEdit ? " is-click-to-edit" : ""
        }`}
        style={{ height: viewportHeight }}
      >
        <div
          className="resume-preview-scale-box"
          style={{ width: scaledWidth, height: scaledHeight }}
        >
          <div
            className="resume-preview-pages"
            style={{ gap: PAGE_STACK_GAP_PX, transform: `scale(${scale})` }}
          >
            {Array.from({ length: totalVisualPages }, (_, index) => {
              // 第 limit + 1 页起不计入导出（问题 2）：红实线包边 + 页脚通栏红带，
              // 两条规则都在 `resume-canvas.css` 的 `.is-over-limit` 上——**不能写进 JSX**，
              // 内联样式优先级更高，会把样式表里的规则整条盖掉（问题 24）。
              const overLimit = !unlimited && index + 1 > limit;
              return (
                <div
                  key={index}
                  className={`resume-preview-page${overLimit ? " is-over-limit" : ""}`}
                  data-page-index={index + 1}
                  data-over-limit={overLimit ? "1" : undefined}
                  style={{ width: A4_WIDTH_PX, height: A4_HEIGHT_PX }}
                >
                  <iframe
                    // 第 1 页挂外部 ref：版面测量与"字号 / 行距"探针只需要一份权威结果。
                    ref={index === 0 ? iframeRef : undefined}
                    title={
                      index === 0
                        ? t("preview.canvas.frameTitle")
                        : t("preview.canvas.frameTitlePage", { page: index + 1 })
                    }
                    className={`resume-iframe${darkPaper ? " is-dark-paper" : ""}`}
                    width={A4_WIDTH_PX}
                    height={A4_HEIGHT_PX}
                    srcDoc={html}
                    sandbox="allow-same-origin"
                    scrolling="no"
                    onLoad={(event) => {
                      // 先染色再交给宿主排版 / 测量：这里的 class 只改渲染，不影响任何盒子尺寸。
                      paintPaperTheme(event.currentTarget.contentDocument, darkPaper);
                      onIframeLoad(event, index);
                    }}
                  />
                  {totalVisualPages > 1 ? (
                    <span
                      className={`resume-preview-page-label${overLimit ? " is-over-limit" : ""}`}
                      // 外观全部由 `resume-canvas.css` 的两条规则承担（普通页是灰色小胶囊，
                      // 超额页是通栏红底白字）。**不要往这里加 `style`**：内联样式会盖掉
                      // 样式表，而且深色主题下没法跟着 `--rf-danger` 变。
                    >
                      {overLimit
                        ? t(OVERFLOW_PAGE_LABEL_KEY, { page: index + 1 })
                        : t("preview.canvas.pageLabel", {
                            page: index + 1,
                            total: totalVisualPages,
                          })}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
