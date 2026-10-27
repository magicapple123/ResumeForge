// SPDX-License-Identifier: Apache-2.0
/**
 * 面试深挖页：统计卡、历史列表、状态与批量删除。
 *
 * 批量删除的确认正文引用 `HARD_DELETE_NOTE`（硬删除的共用常量，与
 * `TRASH_RECOVERY_NOTE` 成对），那一行保持中文，等常量收口时一起改。
 */
const drill = {
  "drill.error.loadRecords": "读取记录失败",
  "drill.error.load": "读取失败",
  "drill.toast.deletedOne": "已删除这条深挖记录",
  "drill.error.deleteFailed": "删除失败",
  "drill.confirm.deleteTitle": "删除选中的深挖记录？",
  "drill.toast.deletedMany": "已删除 {count} 场深挖",
  "drill.toast.deletedPartial": "已删除 {ok} 场，{failed} 场失败，请重试",
  "drill.selectMode": "批量选择",
  "drill.action.delete": "删除",
  "drill.confirm.deleteOne": "删除这场深挖？",
  "drill.action.back": "返回事实台账",
  "drill.page.title": "面试深挖",
  "drill.page.subtitle":
    "把事实台账里「已确认」的主张逐条拿出来压力测试：讲不讲得清、哪里还站不住。每道题的标准在你看到问题之前就定下来，不评总分。",
  "drill.stat.asked": "已问",
  "drill.stat.clear": "讲得清",
  "drill.stat.partial": "部分验证",
  "drill.stat.unverified": "未验证",
  "drill.stat.contradiction": "存在矛盾",
  "drill.status.finished": "已结束",
  "drill.status.active": "进行中",
  "drill.mode.simulated": "真实模拟",
  "drill.mode.training": "训练模式",
  "drill.section.history": "历史记录",
  "drill.action.refresh": "刷新",
  "drill.batch.delete": "删除所选",
  "drill.empty": "还没有深挖记录。先在「事实台账」确认几条主张，再回来开一场。",
  "drill.aria.select": "选择深挖 {title}",
  "drill.action.continue": "继续",
  "drill.action.review": "看复盘",
  "drill.progress": "{current}/{total} 题",
  "drill.table.total": "共 {count} 场",
} as const;

export default drill;
