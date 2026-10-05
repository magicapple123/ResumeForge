/**
 * 页面可见性工具：后台轮询共用（一处逻辑一份实现）。
 *
 * 标签页在后台时，秒级轮询纯属浪费——用户看不见进度，浏览器也会冻结定时器精度。
 * 各轮询点在每轮 tick 前用 `isDocumentHidden()` 跳过本轮，并用 `onVisibilityChange`
 * 在回到前台时立即补一次，保证隐藏期间错过的进度不用等下一个间隔。
 *
 * 注意：jsdom 里 `document.visibilityState` 恒为 "visible"，既有测试不受影响；
 * 需要模拟隐藏时在测试里覆写该属性即可。
 */

/** 页面当前是否不可见（标签页在后台 / 窗口最小化）。 */
export function isDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** 监听可见性变化；返回退订函数。回调里通常配合 `isDocumentHidden()` 区分隐藏与恢复。 */
export function onVisibilityChange(callback: () => void): () => void {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}
