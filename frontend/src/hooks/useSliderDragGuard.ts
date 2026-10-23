// SPDX-License-Identifier: Apache-2.0
/**
 * 拖动滑杆期间给 `body` 挂一个标记，让页面上的 `iframe` 暂时"透明"给指针。
 *
 * ## 解决的是哪一类卡死
 *
 * 滑杆（antd `Slider` / rc-slider）在按下之后把 `pointermove` / `pointerup` 挂在
 * **document** 上。而 `iframe` 是独立文档：指针一旦滑进预览区，父文档再也收不到这两个
 * 事件——`pointerup` 丢失，滑杆就永远停在"正在拖"的状态（用户 2026-10-23 报的是
 * "取消长按后仍然保持拖动"，出现在简历预览界面，那里滑杆右边紧挨着预览 iframe）。
 *
 * 这正是制作台分隔条踩过的同一个坑（那边用 `body.is-resizing`）。区别是滑杆是 antd 的
 * 内部实现，没法在它的 `onMouseDown` 里挂钩子，所以改为**全局监听捕获阶段**的
 * `pointerdown`：落在 `.ant-slider` 里就挂标记，抬起/取消/失焦就摘。
 *
 * ## 为什么不用 `mousedown`
 *
 * rc-slider 在现代浏览器里走 Pointer Events；只挂 `mousedown` 会在触控板与触屏设备上
 * 漏掉。两个都挂没有意义——`pointerdown` 在所有支持的浏览器里都先于/等价于它。
 *
 * ## 代价
 *
 * 拖动滑杆期间预览区不可交互（不能滚 iframe）。这是刻意的：那几百毫秒里用户的意图
 * 就是"调这一根滑杆"，而丢事件会让整块界面卡在拖动态。
 */
import { useEffect } from "react";

/** `body` 上的标记类名（样式在 `styles/resume-workbench.css`，与 `is-resizing` 同处）。 */
const GUARD_CLASS = "is-slider-dragging";

/** 判断事件目标是不是落在某个滑杆里。 */
function insideSlider(target: EventTarget | null): boolean {
  const element = target as Element | null;
  // `closest` 在非 Element 目标（window、document）上是 undefined，所以要可选调用。
  return Boolean(element?.closest?.(".ant-slider"));
}

export function useSliderDragGuard(): void {
  useEffect(() => {
    const body = document.body;
    const release = () => body.classList.remove(GUARD_CLASS);
    const onPointerDown = (event: PointerEvent) => {
      if (insideSlider(event.target)) body.classList.add(GUARD_CLASS);
    };

    // 捕获阶段：滑杆可能被包在 stopPropagation 的容器里（弹窗、抽屉都干过），
    // 冒泡阶段监听会静默失效。
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    // 失焦兜底：拖动中切走窗口时 `pointerup` 也不会来（与分隔条那条同因）。
    window.addEventListener("blur", release);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
      window.removeEventListener("blur", release);
      release();
    };
  }, []);
}
