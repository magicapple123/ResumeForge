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
} as const;

export default common;
