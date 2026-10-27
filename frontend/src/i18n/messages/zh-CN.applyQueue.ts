// SPDX-License-Identifier: Apache-2.0
/**
 * 投递队列页：队列说明、不支持来源的提示、详情抽屉与移出确认。
 *
 * 说明段落（原来用 `<span className="apply-queue-flow-em">` 高亮名词）整段成 key，
 * 高亮改成文案里的「」/ 引号：片段拼接在英文里语序不通，而 i18n 没有富文本插值。
 */
const applyQueue = {
  "applyQueue.action.viewDetail": "查看详情",
  "applyQueue.action.edit": "编辑",
  "applyQueue.action.remove": "移出队列",
  "applyQueue.action.removeShort": "移出",
  "applyQueue.confirm.removeTitle": "移出队列？",
  "applyQueue.confirm.removeBody": "只是从队列里拿掉，岗位与投递记录都不会被删除。",

  "applyQueue.toast.removed": "已移出队列",
  "applyQueue.toast.removeFailed": "移出队列失败",
  "applyQueue.toast.removePartial": "已移出 {ok} 个岗位，{failed} 个移出失败",
  "applyQueue.toast.removedCount": "已把 {count} 个岗位移出队列",
  "applyQueue.toast.notEligible": "选中的条目已经不可投递，请刷新队列后重试",
  "applyQueue.toast.needBrowser": "请先启动浏览器再开始投递",
  "applyQueue.toast.startedSelected": "已开始投递选中的 {count} 个岗位",
  "applyQueue.toast.startedAll": "已开始投递队列",
  "applyQueue.toast.startFailed": "开始投递失败",

  "applyQueue.guide.title": "队列里放的是「准备投、但还没投」的岗位",
  "applyQueue.guide.step1":
    "在「岗位广场」打开岗位详情，点「加入投递台」把它加进来（从「自动采集」导入的岗位也是同一入口）。",
  "applyQueue.guide.step2":
    "在这里核对每个岗位的「准入结论」：不确定的先回岗位广场做「匹配度分析」，判定有真实缺口的默认不投。",
  "applyQueue.guide.step3":
    "需要时逐行点岗位名「查看详情或编辑」，换一份更贴岗位的简历、改一版招呼语。",
  "applyQueue.guide.step4":
    "勾选本轮要投的岗位（不勾选＝按顺序投整个队列），再点「开始投递」——在那之前不会打开任何招聘网站。",

  "applyQueue.unsupported.title": "队列里有 {count} 个岗位不能用投递台自动投递",
  "applyQueue.unsupported.body":
    "它们的来源不在投递台支持的招聘网站内（已在「岗位」列标出「来源不支持」）。按「开始投递」投整个队列时会被拦下，请先点行末「更多操作 → 移出队列」把它们清掉；只想投其中几个时，勾选要投的岗位再点「开始投递」即可。",
  "applyQueue.truncated":
    "队列共 {total} 个岗位，列表只显示最新入队的前 {shown} 条，请用筛选缩小范围或先投递消化队列。",

  "applyQueue.empty.title": "队列还是空的：先去「岗位广场」挑几个岗位。",
  "applyQueue.empty.body":
    "在「岗位广场」点岗位名打开详情 → 点「加入投递台」，就能把它加到这里；加完之后回到本页，勾选要投的岗位再点「开始投递」。",

  "applyQueue.detail.deletedJob": "（岗位已删除）",
  "applyQueue.detail.autoApply": "自动投递",
  "applyQueue.detail.unsupported": "来源不支持：请到原网站自行投递",
  "applyQueue.detail.supported": "可以：来源在投递台支持的招聘网站内",
  "applyQueue.detail.status": "状态",
  "applyQueue.detail.queuePosition": "排队序号",
  "applyQueue.detail.position": "第 {index} 位",
  "applyQueue.detail.resume": "使用简历",
  "applyQueue.detail.defaultResume": "按默认规则解析",
  "applyQueue.detail.joinedAt": "加入队列",
  "applyQueue.detail.updatedAt": "最近更新",
  "applyQueue.detail.greeting": "招呼语",
  "applyQueue.detail.defaultGreeting": "默认招呼语",
} as const;

export default applyQueue;
