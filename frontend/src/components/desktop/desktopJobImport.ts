// SPDX-License-Identifier: Apache-2.0
/**
 * 「文件 → 从链接导入岗位…」（#34B）的触发通道。
 *
 * 岗位导入弹窗（`components/jobs/ImportFromUrlLauncher`，来自 #16C）是**自包含**的：
 * 按钮 + 弹窗 + 导入后的列表刷新回调都在岗位广场页面里。菜单要调活的必须是**同一个**
 * 入口，不能让标题栏再挂一套弹窗、绕开 `onImported` 的刷新（那会造出"导入成功但列表
 * 还是旧的"）。所以这里只做两件事：
 *  1. 发一个窗口事件，页面上已挂载的 launcher 收到就打开自己的弹窗；
 *  2. 记一个"待打开"标记：菜单往往要从别的页面跳过来，事件会在 JobsPage 挂载之前发出，
 *     标记让 launcher 在挂载时补开一次（消费即清）。
 *
 * 不放 URL / 参数：菜单只表达"打开那个入口"，弹窗自己的输入框才是用户填链接的地方。
 */
export const OPEN_JOB_IMPORT_EVENT = "resumeforge:open-job-import";

let pendingOpen = false;

/** 菜单动作：请求打开「从链接导入岗位」。调用方负责先把路由切到岗位广场。 */
export function requestJobUrlImport(): void {
  pendingOpen = true;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_JOB_IMPORT_EVENT));
}

/** launcher 挂载时消费"待打开"标记（一次消费后清空）。 */
export function consumePendingJobUrlImport(): boolean {
  const had = pendingOpen;
  pendingOpen = false;
  return had;
}
