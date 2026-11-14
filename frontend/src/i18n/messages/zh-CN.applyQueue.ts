// SPDX-License-Identifier: Apache-2.0
/**
 * 投递队列页：队列说明、不支持来源的提示、筛选与工具栏、表格列、条目编辑弹窗、
 * 详情抽屉与移出确认。
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

  "applyQueue.unsupported.chip": "来源不支持 {count}",
  "applyQueue.unsupported.chipHint":
    "这些岗位的来源不在投递台支持的招聘网站内，无法自动投递；投整个队列时会被拦下",
  "applyQueue.unsupported.chipTitle": "移出这 {count} 条？",
  "applyQueue.unsupported.chipBody": "只是从队列里拿掉，岗位与投递记录都不会被删除。",
  "applyQueue.toast.removedUnsupported": "已移出 {count} 个来源不支持的岗位",
  "applyQueue.truncated":
    "队列共 {total} 个岗位，列表只显示最新入队的前 {shown} 条，请用筛选缩小范围或先投递消化队列。",

  "applyQueue.guide.trigger": "使用说明",
  "applyQueue.guide.triggerAria": "查看队列使用说明",

  "applyQueue.startBar.count": "已选 {selected} / 可投 {eligible}",
  "applyQueue.startBar.hint": "不勾选时按顺序投整个队列",
  "applyQueue.action.startCount": "开始投递（{count}）",

  "applyQueue.empty.title": "队列还是空的：先去「岗位广场」挑几个岗位。",
  "applyQueue.empty.action": "去岗位广场挑",
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

  // 准入徽标自己的两枚固定标签（准入结论的展示名仍来自 types 的 ADMISSION_META）。
  "applyQueue.admission.needsConfirm": "需逐条确认",
  "applyQueue.admission.unanalyzed": "未分析",

  // 表格：列头与单元格里的兜底/提示。状态列的展示名仍来自 types 的 QUEUE_STATUS_META。
  "applyQueue.column.job": "岗位",
  "applyQueue.column.admission": "准入",
  "applyQueue.column.status": "状态",
  "applyQueue.column.assets": "投递材料",
  "applyQueue.column.actions": "操作",
  "applyQueue.column.score": "参考分",
  "applyQueue.column.match": "匹配",
  "applyQueue.score.disclaimer":
    "本参考分由本地规则估算，仅供展示与自我评估，不代表真实 ATS 解析结果或投递成功概率；投递准入仍以五类匹配结论为准。",
  "applyQueue.score.unanalyzed": "未分析",
  "applyQueue.score.sortByScore": "按参考分排序",
  "applyQueue.score.sortByJoinedAt": "按入队时间排序",
  "applyQueue.table.favorite": "已收藏",
  "applyQueue.table.joinedAt": "加入队列于 {time}",
  "applyQueue.table.viewDetailAria": "查看队列条目详情：{title}",
  "applyQueue.table.deletedJobShort": "岗位已删除",
  "applyQueue.table.unsupportedTag": "来源不支持",
  "applyQueue.table.unsupportedHint":
    "来源不在投递台支持的招聘网站内，无法自动投递；移出队列或到原网站自行投递",
  "applyQueue.table.moreActionsAria": "更多操作 {job}",
  "applyQueue.table.total": "共 {total} 条",

  // 筛选与工具栏。
  "applyQueue.filter.byStatus": "按状态筛选",
  "applyQueue.filter.byAdmission": "按准入筛选",
  "applyQueue.filter.favoriteOnly": "只看收藏",
  "applyQueue.filter.count": "共 {total} 个岗位，已选 {selected} 个",
  "applyQueue.filter.countFiltered": "共 {total} 个岗位，筛选出 {shown} 个，已选 {selected} 个",
  "applyQueue.filter.selectAllHint":
    "勾选当前列表里的全部可投岗位（跨页生效）；不勾选则整队列按顺序投递",
  "applyQueue.filter.selectAll": "全选队列",
  "applyQueue.filter.clearSelection": "清空选择",
  "applyQueue.confirm.removeSelectedTitle": "把选中的岗位移出队列？",
  "applyQueue.action.removeSelected": "移出所选",
  "applyQueue.action.start": "开始投递",

  // 条目编辑弹窗。
  "applyQueue.editor.title": "编辑「{title}」",
  "applyQueue.editor.untitledJob": "该岗位",
  "applyQueue.editor.resumeHint": "留空则运行时用该岗位最近一份岗位版简历。",
  "applyQueue.editor.resumePlaceholder": "按默认规则解析（输入关键词搜索）",
  "applyQueue.editor.generate": "按岗位生成招呼语",
  "applyQueue.toast.greetingGenerated": "已按岗位生成招呼语",
  "applyQueue.toast.greetingDefault": "已填入默认招呼语（未配置模型）",
  "applyQueue.toast.greetingFailed": "生成招呼语失败",
  "applyQueue.toast.updated": "队列条目已更新",
  "applyQueue.toast.updateFailed": "更新失败",

  // 14A 投递前体检。
  "applyQueue.action.preflight": "投递前检查",
  "applyQueue.preflight.title": "投递前检查",
  "applyQueue.preflight.loading": "正在检查…",
  "applyQueue.preflight.summary": "会拦住 {blocking} 条，建议先处理 {warnings} 条",
  "applyQueue.preflight.blocking": "会拦住投递（{count}）",
  "applyQueue.preflight.warning": "建议先处理（{count}）",
  "applyQueue.preflight.empty": "没有发现问题，可以放心投递",
  "applyQueue.preflight.fixLabel": "怎么修：{fix}",
  "applyQueue.preflight.fixRemove": "移出队列",
  "applyQueue.preflight.fixEdit": "去改这一条",
  "applyQueue.preflight.fixJobs": "去岗位广场分析",
  "applyQueue.preflight.confirmTitle": "投递前有提醒",
  "applyQueue.preflight.confirmBody": "有 {count} 条会被拦下，仍要投递吗",
  "applyQueue.preflight.confirmCancel": "先不投",
  "applyQueue.preflight.confirmGo": "仍要投递",
  "applyQueue.preflight.code.source_unsupported": "来源不支持",
  "applyQueue.preflight.code.resume_missing": "简历缺失",
  "applyQueue.preflight.code.match_missing": "未做匹配",
  "applyQueue.preflight.code.match_weak": "匹配偏弱",
  "applyQueue.preflight.code.greeting_weak": "招呼语偏弱",
  "applyQueue.preflight.code.ghost_job": "疑似僵尸岗",

  // 14D 话术库：编辑器里的「从模板选择」与批量套用。
  "applyQueue.template.pick": "从模板选择",
  "applyQueue.template.pickPlaceholder": "选一条话术模板",
  "applyQueue.template.preview": "填入后会是这样：{text}",
  "applyQueue.template.loadFailed": "话术模板读取失败，仍可手写招呼语",
  "applyQueue.template.batch": "批量套用模板",
  "applyQueue.template.batchTitle": "套用到选中的 {count} 条",
  "applyQueue.template.batchBody": "会用当前条目的岗位与公司渲染变量，写入后仍可逐条手改。",
  "applyQueue.template.batchApply": "套用模板",
  "applyQueue.template.batchDone": "已套用到 {count} 条",
  "applyQueue.template.batchPartial": "套用 {ok} 条，{failed} 条失败",
  "applyQueue.template.batchEmpty": "请先选一条模板",

  // #15C 岗位体检：薪资偏离 / 同司多投 / 历史结果。样本不足时**只显示条数**，
  // 不给百分比——把"没样本"渲染成 0% 会被读成"薪资持平 / 完全没覆盖"。
  "applyQueue.insights.inspect.action": "体检",
  "applyQueue.insights.inspect.title": "岗位体检：{job}",
  "applyQueue.insights.inspect.untitledJob": "该岗位",
  "applyQueue.insights.inspect.loading": "正在体检…",
  "applyQueue.insights.inspect.error": "体检没跑成；队列与投递都不受影响，可以继续。",
  "applyQueue.insights.inspect.salary.label": "薪资偏离",
  "applyQueue.insights.inspect.salary.ok": "同城同族中位 {median}K，本岗 {target}K，{delta}",
  "applyQueue.insights.inspect.salary.high": "高 {percent}%",
  "applyQueue.insights.inspect.salary.low": "低 {percent}%",
  "applyQueue.insights.inspect.salary.same": "基本持平",
  "applyQueue.insights.inspect.salary.insufficient": "样本不足（{sample} 条）",
  "applyQueue.insights.inspect.salary.hint":
    "比的是你自己同城、同岗位族的历史投递样本，不是市场薪酬报告。",
  "applyQueue.insights.inspect.sameCompany.label": "同司多投",
  "applyQueue.insights.inspect.sameCompany.line":
    "你已投 {applied} 条 / 在队 {in_queue} 条，这家公司共 {count} 条",
  "applyQueue.insights.inspect.sameCompany.none": "这家公司你还没投过，队列里也没有它的别的岗位。",
  "applyQueue.insights.inspect.history.label": "历史结果",
  "applyQueue.insights.inspect.history.none": "这个岗位还没投过。",
  "applyQueue.insights.inspect.history.summary": "投过 {applied} 次：{parts}",
  "applyQueue.insights.inspect.history.succeeded": "{count} 成功",
  "applyQueue.insights.inspect.history.failed": "{count} 失败",
  "applyQueue.insights.inspect.history.noReply": "{count} 无回音",

  // #15D 简历指派：命名一律「关键词覆盖」，不用「匹配度 / 参考分」（那是另一个口径，
  // 混用会让用户以为两者可比）。
  "applyQueue.insights.fit.action": "优化指派",
  "applyQueue.insights.fit.title": "优化简历指派",
  "applyQueue.insights.fit.loading": "正在算关键词覆盖…",
  "applyQueue.insights.fit.error": "关键词覆盖算不出来；队列不受影响，可以继续。",
  "applyQueue.insights.fit.empty": "这几条没有更合适的简历，保持现有指派即可。",
  "applyQueue.insights.fit.column.job": "岗位",
  "applyQueue.insights.fit.column.current": "当前简历",
  "applyQueue.insights.fit.column.coverage": "覆盖率",
  "applyQueue.insights.fit.column.recommended": "推荐简历",
  "applyQueue.insights.fit.column.after": "换后",
  "applyQueue.insights.fit.column.gain": "提升",
  "applyQueue.insights.fit.column.action": "操作",
  "applyQueue.insights.fit.coverage": "{percent}%",
  "applyQueue.insights.fit.gain": "+{gain}",
  "applyQueue.insights.fit.recommendInline": "推荐简历：{title}（关键词覆盖 {from}% → {to}%）",
  "applyQueue.insights.fit.swap": "换用",
  "applyQueue.insights.fit.swapAll": "全部换用",
  "applyQueue.insights.fit.applied": "已换用 {count} 条",
  "applyQueue.insights.fit.applyPartial": "换用 {ok} 条，{failed} 条失败",
  "applyQueue.insights.fit.applyFailed": "换用失败",
  "applyQueue.insights.fit.noGain": "覆盖已经最高",
  "applyQueue.insights.fit.swapped": "已换用",
  "applyQueue.insights.fit.hintError": "关键词覆盖暂时算不出来，仍可手动选简历。",

  // #15E 边际收益停止线：样本 < 10 条投递时只给一行灰字，不给比率。
  "applyQueue.insights.stopping.insufficient":
    "样本不足（{applied} 条投递）：多投几条再看边际收益。",
  "applyQueue.insights.stopping.past":
    "边际收益到拐点了：最近 {weeks} 周的面试转化 {recent}%，低于此前基准 {baseline}%（累计 {applied} 条投递）。",
  "applyQueue.insights.stopping.followup": "跟进待回音",
  "applyQueue.insights.stopping.improve": "改简历",

  // #15A 僵尸岗雷达：分数 + 四项证据 + 「忽略此岗位」。冷启动（ghost_score=null）**不渲染**
  // ——把"没数据"画成 0 分会被读成"这岗位很健康"，比不显示更糟。
  "applyQueue.insights.ghost.badge": "僵尸 {score}",
  "applyQueue.insights.ghost.popoverTitle": "可能不招人",
  "applyQueue.insights.ghost.hint": "按你自己这条岗位的复采历史算的，不是平台的结论。",
  "applyQueue.insights.ghost.emptyEvidence": "还没有足够的复采记录。",
  "applyQueue.insights.ghost.ignore": "忽略此岗位",
  "applyQueue.insights.ghost.ignoreTitle": "不再提示这条？",
  "applyQueue.insights.ghost.ignoreBody": "只收起这个徽标，岗位仍留在队列里。",
  "applyQueue.insights.ghost.ignoreOk": "忽略提示",
  "applyQueue.insights.ghost.ignored": "已忽略这条岗位的僵尸分",
  "applyQueue.insights.ghost.ignoreFailed": "忽略没生效，可以再试一次",

  // #15B JD 变更（被动式）：只在下一次采集发现变化时出现，**不主动重抓**。
  // 契约只有布尔值、没有「几处变更」，所以徽标不写数字（写"1 处"会是假的）。
  "applyQueue.insights.jdChange.badge": "你投的岗位有变更",
  "applyQueue.insights.jdChange.title": "岗位描述变更",
  "applyQueue.insights.jdChange.passive": "被动式：下次采集时更新",
  "applyQueue.insights.jdChange.before": "上次采集",
  "applyQueue.insights.jdChange.after": "本次采集",
  "applyQueue.insights.jdChange.seenAt": "本次采集时间 {time}",
  "applyQueue.insights.jdChange.seenAtUnknown": "还没有第二次采集的时间",
  "applyQueue.insights.jdChange.unchanged": "上次采集与本次一致，没有变更。",
  "applyQueue.insights.jdChange.empty": "这条岗位还没有第二版描述可比。",
  "applyQueue.insights.jdChange.error": "变更明细取不到；投递记录不受影响。",
  "applyQueue.insights.jdChange.noId": "这条记录没有对应的队列条目，看不到前后对比。",
  "applyQueue.insights.jdChange.added": "新增",
  "applyQueue.insights.jdChange.removed": "删除",
} as const;

export default applyQueue;
