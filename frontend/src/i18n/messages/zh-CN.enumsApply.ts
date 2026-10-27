// SPDX-License-Identifier: Apache-2.0
/**
 * 投递 / 匹配域的**协议值展示名**（中文正本）。
 *
 * 这些文案的正本原本在 `types/apply/*.ts` 的 `*_META` / `*_LABELS` 里，值逐字搬到这里
 * （渲染结果不变，现有中文断言照旧通过），再由 `i18n/enum/apply.ts` 建立
 * 「协议值 → key」映射。types 表仍是**协议值清单**的正本：键（`pending` / `allow` /
 * `selector_invalid` …）是后端下发与落库值，永不翻译，也不随语言切换而变化。
 *
 * 新增协议值时两处都要改：types 表（值）+ 这里（key），漏一处会让界面掉回原码。
 */
const enumsApply = {
  // ===== 队列状态（QUEUE_STATUS_META）=====
  "enumsApply.queueStatus.pending": "待投递",
  "enumsApply.queueStatus.skipped": "已跳过",
  "enumsApply.queueStatus.done": "已投递",

  // ===== 批次状态（TASK_STATUS_META）=====
  "enumsApply.taskStatus.pending": "等待中",
  "enumsApply.taskStatus.running": "进行中",
  "enumsApply.taskStatus.paused": "已暂停",
  "enumsApply.taskStatus.breaker_paused": "连续失败过多，已自动暂停",
  "enumsApply.taskStatus.completed": "已完成",
  "enumsApply.taskStatus.stopped": "已停止",
  "enumsApply.taskStatus.failed": "失败",

  // ===== 批次内单条状态（TASK_ITEM_STATUS_META）=====
  "enumsApply.taskItemStatus.pending": "待投递",
  "enumsApply.taskItemStatus.running": "进行中",
  "enumsApply.taskItemStatus.success": "成功",
  "enumsApply.taskItemStatus.failed": "失败",
  "enumsApply.taskItemStatus.skipped": "已跳过",

  // ===== 受控浏览器状态（BROWSER_STATE_META）=====
  "enumsApply.browserState.stopped": "未启动",
  "enumsApply.browserState.starting": "启动中",
  "enumsApply.browserState.running": "运行中",
  "enumsApply.browserState.unknown": "状态未知",

  // ===== 浏览器选项（BROWSER_CHOICE_META）=====
  // chrome / edge 的名称是品牌名，中英文逐字相同且不含中文，仍取 types 表（见映射模块注释）。
  "enumsApply.browserChoice.auto.label": "自动（优先 Chrome）",
  "enumsApply.browserChoice.auto.hint": "优先用 Chrome；没装 Chrome 时自动回退 Edge。",
  "enumsApply.browserChoice.chrome.hint": "只用 Chrome；找不到会明确提示，不会改用别的浏览器。",
  "enumsApply.browserChoice.edge.hint": "只用 Edge；找不到会明确提示，不会改用别的浏览器。",
  "enumsApply.browserChoice.custom.label": "自定义路径",
  "enumsApply.browserChoice.custom.hint": "填写浏览器可执行文件的完整路径（必须真实存在）。",

  // ===== 准入结论（ADMISSION_META）=====
  "enumsApply.admission.allow": "可投递",
  "enumsApply.admission.needs_confirm": "需确认",
  "enumsApply.admission.block": "不投",

  // ===== 匹配结论（MATCH_STATUS_META）=====
  "enumsApply.matchStatus.matched": "已匹配",
  "enumsApply.matchStatus.expression_gap": "表达缺口",
  "enumsApply.matchStatus.evidence_insufficient": "证据不足",
  "enumsApply.matchStatus.real_gap": "真实缺口",
  "enumsApply.matchStatus.to_confirm": "待确认",

  // ===== 匹配度参考分的五个分项（后端 MATCH_SCORE_DIMENSIONS 的 key）=====
  // 中文逐字等于后端 match_scoring.py 的 label：换语言包不改变中文界面。
  "enumsApply.matchDimension.skill_coverage": "技能覆盖",
  "enumsApply.matchDimension.experience_years": "年限",
  "enumsApply.matchDimension.project_relevance": "项目相关度",
  "enumsApply.matchDimension.hard_gate": "硬性门槛",
  "enumsApply.matchDimension.jd_keyword_coverage": "JD 关键词覆盖",

  // ===== 失败分类（FAILURE_CATEGORY_LABELS）=====
  "enumsApply.failure.selector_invalid": "页面结构变化 / 选择器失效",
  "enumsApply.failure.login_required": "需要登录",
  "enumsApply.failure.captcha_required": "需要验证码或安全验证",
  "enumsApply.failure.greeting_missing": "招呼语缺失",
  "enumsApply.failure.network_timeout": "网络超时",
  "enumsApply.failure.file_upload_failed": "简历上传失败",
  "enumsApply.failure.site_unsupported": "岗位来源不支持自动投递",
  "enumsApply.failure.profile_insufficient": "资料不足，需要先补充简历/网申资料",
  "enumsApply.failure.unconfirmed": "无法确认投递结果，请到浏览器核对",
  "enumsApply.failure.unknown": "未知失败",

  // ===== 执行步骤（STEP_LABELS；键是后端步骤码，未登记的码原样显示）=====
  "enumsApply.step.opening": "打开岗位页",
  "enumsApply.step.filling": "填写表单",
  "enumsApply.step.greeting": "发送招呼语",
  "enumsApply.step.uploading": "上传简历",
  "enumsApply.step.submitting": "提交投递",
  "enumsApply.step.verifying": "确认结果",
  "enumsApply.step.waiting": "岗位间间隔",
  "enumsApply.step.idle": "空闲",
} as const;

export default enumsApply;
