// SPDX-License-Identifier: Apache-2.0
/**
 * A4 预览画布：把渲染好的简历 HTML 按 **A4 纸的比例**（794×1123）整体等比缩放放进容器。
 *
 * 为什么不直接铺满容器（模板预览以前的做法）：简历是 794×1123 的**竖版 A4**，而原先的写法
 * 把 iframe 拉成"容器宽 × 72vh"，比例与真实纸张完全不同——用户既看不出"排上去好不好看"，
 * 也看不出"一页到底装不装得下"（预览与导出/打印不一致的抱怨，一部分就来自这里）。
 * 另一处原先写法是**写死** `transform: scale(0.54)`，而列宽是可变的，于是要么没铺满、
 * 要么被裁掉（用户反馈"右侧预览没有一次性展示全"）。
 *
 * 这里统一画一张 A4 纸、按容器实测尺寸整体缩放（contain），所以**任何时候都能完整看到一整页**。
 * 缩放比例由 `ResizeObserver` 实测得出而不是写死断点：这个组件同时用在宽弹窗预览与窄侧栏
 * 预览里，写死断点必然在其中一处失真。
 */
import { useLayoutEffect, useRef, useState } from "react";
// A4 尺寸单源化：与简历预览全家桶共用同一份常量（原先两处各写一份，改口径时容易漂移）。
import { A4_HEIGHT_PX, A4_WIDTH_PX } from "../resume-preview/config";

interface Props {
  html: string;
  /** iframe 的无障碍名称；同时也被测试用来定位。 */
  title: string;
  /** 画布高度上限，默认 72vh。 */
  maxHeight?: string;
  /**
   * 缩放口径（2026-10-23 增加第二种）：
   * - `contain`（默认）：宽高都放得下，用于"查看大图"这类给定高度上限的场景；
   * - `width`：**宽度决定高度**（容器按 A4 比例撑开、纸铺满卡片宽），用于模板缩略图卡片。
   *   原先缩略图写死 `scale(0.36)` + `margin-left: -143px`，卡片宽一变就左右各裁 4px，
   *   而且高度不会跟着卡片走——这正是这里加一个口径的原因。
   */
  fit?: "contain" | "width";
  /**
   * 文档是**几页 A4**（默认 1）。
   *
   * 「查看大图」要看的是一整份简历（上限 1–3 页），而页面 HTML 的 body 高度就是
   * `页数 × A4`（后端 `render_html` 的 `page_limit`）。把 iframe 开成 1 页高会裁掉
   * 后面几页、开成 1123px 固定高则会在 iframe **内部**多出一条滚动条——那正是
   * "大图界面三个滚动条"里的一条。按页数给足高度后，iframe 自己不再滚，
   * 整块只剩弹窗本体一条竖向滚动条。
   */
  pages?: number;
}

export default function A4PreviewFrame({
  html,
  title,
  maxHeight = "72vh",
  fit = "contain",
  pages = 1,
}: Props) {
  /** 文档总高度：页数 × 单页高（取整页，避免半页露出下一条白边）。 */
  const docHeight = A4_HEIGHT_PX * Math.max(1, Math.round(pages));
  const stageRef = useRef<HTMLDivElement>(null);
  // 初值给 1 而不是 0：容器尺寸量不到时（jsdom 不做布局）仍要渲染出内容，
  // 否则组件在测试里会"什么都不显示"，那是比缩放不准更糟的失败方式。
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      // 量不到尺寸（布局尚未完成 / 测试环境）就保持当前比例，不要缩成 0。
      if (!width || !height) return;
      // `width` 口径只认宽度：高度由 aspect-ratio 反推，所以两者永远同比例，不会被裁。
      setScale(
        fit === "width" ? width / A4_WIDTH_PX : Math.min(width / A4_WIDTH_PX, height / docHeight),
      );
    };
    // 放在 layout effect 里：首帧就按正确比例绘制，不会先大后小闪一下。
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(stage);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [fit, html, docHeight]);

  return (
    <div
      ref={stageRef}
      className="a4-preview-stage"
      style={
        fit === "width"
          ? { aspectRatio: `${A4_WIDTH_PX} / ${docHeight}`, height: "auto" }
          : { height: `min(${maxHeight}, ${docHeight}px)` }
      }
    >
      <div
        className="a4-preview-paper"
        style={{ width: Math.round(A4_WIDTH_PX * scale), height: Math.round(docHeight * scale) }}
      >
        <iframe
          className="a4-preview-frame"
          title={title}
          sandbox=""
          scrolling="no"
          srcDoc={html}
          style={{
            width: A4_WIDTH_PX,
            height: docHeight,
            transform: `scale(${scale})`,
          }}
        />
      </div>
    </div>
  );
}
