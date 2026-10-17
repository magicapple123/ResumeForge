/** 换位 FLIP 动画：实时重排提交后，让被挪动的**邻卡**从旧位置平滑滑到新位置。
 *
 * 实时重排（CSS `order` / Form.List move）是同帧瞬移：邻卡从旧槽位直接跳到新槽位。
 * FLIP（First-Last-Invert-Play）把它变成 150ms 的滑动——重排**前**量一次各卡片的
 * 布局位置（First），重排提交**后**再量一次（Last），对位置发生变化的卡片写入
 * `translateY(旧−新)` 的反向偏移（Invert）并用 WAAPI 播放到 0（Play）。
 *
 * 约束与坑：
 * - **被拖卡必须排除**：它的 transform 每帧被 syncDrag 直写（1:1 跟手），任何动画
 *   都会造成跟手误差（逐帧对齐 ≤4px 的验收红线）。
 * - **用 WAAPI（el.animate），不用 inline style + transition**：分区壳常驻
 *   `transition: box-shadow 150ms`，若再给 transform 挂常驻 transition，被拖卡每帧
 *   直写的 transform 会被过渡拖尾；WAAPI 动画不碰 inline style，播完即走。
 * - **匀速（linear）而不是 ease-out**：验收判据「邻卡相邻帧位移 ≤120px」按匀速折算
 *   （890px 槽距 ÷ 0.15s ÷ 60fps ≈ 99px/帧）；ease-out 的起步峰值是均值的 ~3 倍
 *   （1064px 槽距首帧 ~300px），会直接击穿判据。150ms 的短滑动线性已足够顺滑。
 * - **换位中途再换位（必须先 cancel 再量，顺序不能反）**：上一轮动画还在播时，
 *   元素的 rect 与 First 采样都含**同一个**动画偏移 o——先量后 cancel 会让 o 在
 *   `prevTop − rect` 的减法里抵消，delta 退化为「上一轮布局位 − 新布局位」，起播
 *   视觉瞬移回上一轮布局位（QA 实测：同一张卡 150ms 内被换位两次时单帧瞬跳
 *   1064px 再回滑）。正确顺序：cancel（元素瞬间回到干净布局位）→ 量 rect →
 *   delta = First视觉位 − 干净布局位 → 起播视觉 = 当前视觉位置，真正无缝重定向。
 *   量 → cancel → 起播全部在同一帧内完成，不闪帧、无残留 transform。
 * - jsdom 没有 `el.animate`：能力探测直接跳过（单测里可注入桩验证参数）。
 */

/** 邻卡滑动时长（ms）。 */
export const FLIP_SWAP_MS = 150;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** 系统「减弱动态效果」开启时不播动画（与项目 reduced-motion 体系同一条偏好）。 */
function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** 重排前采集 `root` 内命中 `selector` 的各卡片视觉上缘（First）。 */
export function captureFlipTops(
  root: HTMLElement | null,
  selector: string,
): Map<HTMLElement, number> {
  const tops = new Map<HTMLElement, number>();
  if (!root) return tops;
  root.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    tops.set(element, element.getBoundingClientRect().top);
  });
  return tops;
}

/**
 * 重排提交后播放 FLIP（Last-Invert-Play）：位置变化的卡片从旧位置滑向新位置。
 *
 * @param prevTops `captureFlipTops` 的采集结果。
 * @param exclude 被拖卡（保持 1:1 跟手，绝不参与动画）。
 */
export function playSwapFlip(
  prevTops: Map<HTMLElement, number>,
  exclude: HTMLElement | null,
  duration: number = FLIP_SWAP_MS,
): void {
  if (prevTops.size === 0 || prefersReducedMotion()) return;
  prevTops.forEach((prevTop, element) => {
    if (element === exclude || typeof element.animate !== "function") return;
    // 上一轮动画还在播（连续换位）：必须**先 cancel 再量**——两处量测若都含同一个
    // 动画偏移，会在减法里抵消，重定向退回上一轮布局位起播（瞬移一槽再回滑）。
    // cancel 后 rect 是干净布局位，delta = First视觉位 − 新布局位，起播视觉 =
    // First视觉位 = 当前视觉位置，无缝重定向。
    element.getAnimations().forEach((animation) => animation.cancel());
    // delta = 旧位置 − 新位置：正数表示卡片要「往上滑回去」（新位置在旧位置下方）。
    const delta = prevTop - element.getBoundingClientRect().top;
    if (Math.abs(delta) < 1) return;
    element.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0px)" }], {
      duration,
      easing: "linear",
    });
  });
}
