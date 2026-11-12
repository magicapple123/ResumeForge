// SPDX-License-Identifier: Apache-2.0
/**
 * 纸面滚动区（`.resume-preview-body`）的**真实可用高度**。
 *
 * ## 为什么不再用"根节点减草稿宿主"
 *
 * 那个算法（`root.getBoundingClientRect().height - host.height`）只在"纸比容器矮"时成立：
 * 纸一旦比容器高，宿主就被内容撑得比根节点还高，差值变成负数、被 `Math.max(0, …)` 夹成 0，
 * 于是"可用高度 = 整栏高度"——预算反而变大，纸更高，差值继续为负，**永远收敛不了**。
 * 表现就是用户看到的那一幕：右栏写着「整页」、读数 88%，纸却明显被切掉一截、还得滚。
 *
 * 现在直接量**纸面自己那一层**（它是 flex 的 `1 1 auto`，高度恒等于"整栏 − 头部"，
 * 与纸多高无关），并用 `ResizeObserver` 跟着它走：
 *
 * - 头部变化（溢出提示出现/消失、工具条换行、专业视图行显隐）→ body 变矮 → 重新算 fit；
 * - 窗口或分隔条变化 → 同样跟着变。
 *
 * ## 两个边界
 *
 * - `Math.floor`：宁可少 1px 也不要多半像素。fit 算出来恰好等于 body 高时，四舍五入多一点
 *   就会凭空多出一条纵向滚动条——"整页"看起来就不整了。
 * - 量不到（jsdom 里 `clientHeight` 恒为 0、首帧还没布局）时返回 0，调用方退回宿主给的总预算
 *   （`availableHeight`），与改造前的行为一致。
 */
import { useEffect, useState } from "react";
import type { RefObject } from "react";

export function usePreviewBodyHeight(
  bodyRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const node = bodyRef.current;
    if (!node) return;
    const apply = () => {
      const next = Math.floor(node.clientHeight);
      setHeight((previous) => (previous === next ? previous : next));
    };
    // 先量一次：观察器第一枪要等一次布局，少了这一下首帧会先按错的高度画一遍。
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => observer.disconnect();
  }, [bodyRef, enabled]);

  return height;
}
