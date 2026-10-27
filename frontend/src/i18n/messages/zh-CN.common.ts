// SPDX-License-Identifier: Apache-2.0
const common = {
  "common.action.cancel": "取消",
  "common.action.save": "保存",
  "common.action.confirm": "确认",
  "common.action.delete": "删除",
  "common.action.close": "关闭",
  "common.action.back": "返回",
  "common.action.refresh": "刷新",
  "common.action.discard": "放弃修改",
  "common.action.keep-editing": "继续编辑",
  "common.action.batchSelect": "批量选择",
  "common.retry": "重试",
  "common.errorBoundary.title.moduleLoad": "页面代码没能加载完整",
  "common.errorBoundary.title.generic": "页面暂时无法显示",
  "common.errorBoundary.body.moduleLoad":
    "这通常是页面代码没取到（网络抖动、前端开发服务器刚重启，或它缓存了已改名/已移动的文件）。先点「重试」——它会重新取一次；若仍失败，再刷新或重启前端开发服务器（关掉窗口后重新运行 start.cmd）。",
  "common.errorBoundary.body.generic": "界面运行时发生异常，请刷新后再试。",
  "common.errorBoundary.reason": "原因：{message}",
  "common.required": "必填",
  "common.placeholder.select": "请选择",

  // ── 通用交互组件（批量条 / 退出应用 / 拖放 / 加载 / 详情 / 行操作 / 折叠） ──
  /** 退出按钮与确认框的确认动作（`ExitAppButton`）。 */
  "common.action.exit": "退出",
  /** 批量操作条的无障碍名（`BatchActionBar`）。 */
  "common.batchBar.aria": "批量操作",
  /** 批量操作条的已选计数。 */
  "common.batchBar.selected": "已选 {count} 项",
  /** 卡片网格类列表的「全选本页」：勾选框文字、title 与无障碍名共用一条。 */
  "common.batchBar.selectPage": "全选本页",
  /** 退出批量选择。 */
  "common.batchBar.exit": "退出多选",
  /** 批量删除按钮（`BatchDeleteButton`）。 */
  "common.batchBar.deleteSelected": "删除所选",
  /** 退出应用的二次确认标题。 */
  "common.exitApp.title": "退出简历通？",
  /** 桌面壳形态的确认正文：退出后只能从桌面快捷方式重新启动。 */
  "common.exitApp.confirm.desktop":
    "应用会完全退出，后台服务一并停止。再次使用请从桌面快捷方式启动简历通。",
  /** 浏览器形态的确认正文：讲清哪些能力会立刻不可用，以及怎么再打开。 */
  "common.exitApp.confirm.browser":
    "前端与后端进程都会停止，当前页面上的查询与生成立即不可用（浏览器不允许脚本关闭本页，请顺手关掉这个标签页）。下次使用请在项目目录重新运行 start.cmd。",
  /** 退出完成后的结果页标题。 */
  "common.exitApp.exited.title": "简历通已退出",
  /** 桌面壳形态的结果页正文。 */
  "common.exitApp.exited.desktop":
    "前端、后端与桌面壳进程都已停止。再次使用请从桌面快捷方式启动简历通。",
  /** 浏览器形态的结果页正文。 */
  "common.exitApp.exited.browser":
    "前端与后端进程都已停止，现在可以关闭这个标签页。要再次使用，请在项目目录运行 start.cmd。",
  /** 退出按钮的 Tooltip：说明它会停掉什么。 */
  "common.exitApp.tooltip": "退出应用（停止前端与后端进程）",
  /** 退出按钮的无障碍名。 */
  "common.exitApp.aria": "退出应用",
  /** 后端没有返回说明时的退出中提示。 */
  "common.exitApp.exiting": "应用正在退出",
  /** 退出失败（没有更具体的原因）。 */
  "common.exitApp.failed": "退出失败，也可以直接关闭后端窗口",
  /** 退出失败（带接口错误信息）。 */
  "common.exitApp.failedWithReason": "{message}（也可以直接关闭后端窗口）",
  /** 拖拽覆盖层的默认提示（`FileDropZone`）。 */
  "common.fileDropZone.hint": "松开即可导入",
  /** 加载态的无障碍名（`LoadingBlock` / `PageSkeleton` 共用）。 */
  "common.loading.content": "正在加载内容",
  /** 输入达到上限时的一行提示（`MaxLengthHint`）。 */
  "common.maxLength.reached": "已达 {count} 字上限",
  /** 详情抽屉里没有可展示字段时的占位（`RecordDetail`）。 */
  "common.recordDetail.empty": "这条记录没有更多内容",
  /** 行操作「更多」按钮的无障碍名（`RowActions`）。 */
  "common.rowActions.more": "更多操作",
  /** 折叠列表展开全部（`useCollapsedList`）。 */
  "common.collapsedList.expand": "显示全部 {count} 条",
  /** 折叠列表收起。 */
  "common.collapsedList.collapse": "收起列表",
} as const;

export default common;
