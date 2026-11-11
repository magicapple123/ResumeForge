// SPDX-License-Identifier: Apache-2.0
/**
 * 技能工作台：内置模板的名称与说明、表格、导入导出提示、空态、使用说明与新建 / 编辑弹窗。
 *
 * **模板的 prompt 正文不在本文件**：那是喂给模型的系统指令（「改写要求 1/2/3…」），
 * 翻译它等于换一套生成行为——模型会跟着用英文产出，对中文简历是灾难。所以 prompt
 * 保持中文并加 `i18n-ok` 豁免，这里只翻用户能看到的名称与说明。
 */
const skills = {
  "skills.builtin.digest.label": "简历要点精炼",
  "skills.builtin.digest.hint": "把经历压成 3 条以内的简历要点",
  "skills.builtin.digest.name": "简历要点精炼",
  "skills.builtin.digest.description": "用户贴出一段经历、要求改写成简历要点时使用",
  "skills.builtin.interview.label": "面试问题预测",
  "skills.builtin.interview.hint": "按岗位 JD 预测面试问题并给出回答思路",
  "skills.builtin.interview.name": "面试问题预测",
  "skills.builtin.interview.description": "用户准备面试、要求模拟提问时使用",
  "skills.builtin.match.label": "岗位匹配分析",
  "skills.builtin.match.hint": "对照 JD 与资料说明匹配点、差距与补强建议",
  "skills.builtin.match.name": "岗位匹配分析",
  "skills.builtin.match.description": "用户问「这个岗位我能不能投」「匹配度如何」时使用",

  "skills.toast.deleted": "已删除技能「{name}」",
  "skills.toast.deleteFailed": "删除技能失败",
  "skills.toast.imported": "已导入技能「{name}」",
  "skills.toast.importFailed": "导入技能失败",

  "skills.action.view": "查看 / 编辑",
  "skills.action.delete": "删除",
  "skills.action.import": "导入技能（.md / .zip）",
  "skills.action.create": "新建技能",
  "skills.confirm.delete": "删除技能「{name}」？删除后所有对话都不再能启用它。",

  "skills.column.skill": "技能",
  "skills.column.prompt": "提示词",
  "skills.column.promptLength": "{count} 字",
  "skills.column.files": "知识文件",
  "skills.column.source": "来源",
  "skills.column.updatedAt": "更新时间",
  "skills.column.actions": "操作",
  "skills.none": "无",
  "skills.fileCount": "{count} 个",

  "skills.breadcrumb": "工作台",
  "skills.tab.skills": "技能",
  "skills.guide.whatTitle": "技能是什么",
  "skills.guide.whatBody":
    "技能由两部分组成：提示词是启用它的对话里加进助手系统提示的要求（例如「改写简历要点时每条不超过 35 字」）；知识文件是助手按需查阅的参考资料（例如常见面试题清单）。技能只影响助手怎么回答，不会改动你的岗位、简历和资料。",
  "skills.guide.howTitle": "工作台怎么用",
  "skills.guide.how1": "从下面的模板复制一个起点，或直接点「新建技能」；",
  "skills.guide.how2": "用「你要…」「不要…」把要求写具体；保存后在对话的技能菜单里勾选即可使用；",
  "skills.guide.how3":
    "技能在对话里启用，**不在技能库里全局开启**：每次新建对话都从空技能开始，也可以「导入技能」加载别人分享的 .md / .zip。",
  "skills.guide.templates": "模板：",
  "skills.budget.title":
    "本对话启用的技能越多，系统提示越长：技能提示词总量超过预算时，靠后的技能不会被加载（助手会用一句话说明）。",
  "skills.error.loadFailed": "技能加载失败：{error}",
  "skills.empty": "还没有技能，先用模板建一个试试",

  "skills.editor.detailTitle": "技能详情",
  "skills.editor.createTitle": "新建助手技能",
  "skills.editor.editTitle": "技能详情与编辑",
  "skills.editor.intro":
    "技能提示词只在启用它的对话里生效；知识文件是助手按需查阅的参考资料。保存后到对话的技能菜单里勾选即可使用。",
  "skills.editor.name": "技能名称",
  "skills.editor.namePlaceholder": "如：简历要点精炼",
  "skills.editor.nameRequired": "请填写技能名称",
  "skills.editor.scenario": "适用场景（一句话说明什么时候用它）",
  "skills.editor.scenarioHint": "会拼成「适用场景：…」给模型判断何时该用；写得越具体越容易命中",
  "skills.editor.scenarioPlaceholder": "如：把经历描述压缩成 3 条以内的简历要点",
  "skills.editor.prompt": "技能提示词",
  "skills.editor.promptPlaceholder":
    "用「你要…」「不要…」这类明确要求描述你希望助手怎么做。\n例如：改写简历要点时，每条不超过 35 字，必须包含动作动词与可核对的成果。",
  "skills.editor.promptRequired": "请填写技能提示词，它决定这个技能让助手怎么做",
  "skills.editor.promptLong": "较长：多个技能同时启用时会被截断（本对话均分 {budget} 字）",
  "skills.editor.files": "知识文件",
  "skills.editor.filesHint": "助手需要时才会读取（如常见面试题、公司清单）",
  "skills.editor.filesBudget": "{count} / {maxCount} 个 · {chars} / {maxChars} 字",
  "skills.editor.filesFull": "已到 {maxCount} 个上限；要再加请先删掉一个（或把内容合并进已有文件）",
  "skills.editor.filesOverBudget": "知识文件合计已超过 {maxChars} 字；请精简后再保存",
  "skills.editor.filesTruncated":
    "这个技能的知识文件体积很大，本次没有加载全部内容；保存时不会改动知识文件（只更新提示词）。",
  "skills.editor.filePathPlaceholder": "文件名，如 面试问题.md",
  "skills.editor.fileContentPlaceholder": "知识文件内容（纯文本或 Markdown）",
  "skills.editor.addFile": "添加知识文件",
  "skills.editor.removeFile": "删除知识文件 {path}",
  "skills.editor.loadFailed": "加载技能失败",
  "skills.editor.saveFailed": "保存技能失败",
  "skills.editor.created": "已创建技能「{name}」；在对话的技能菜单里勾选即可使用",
  "skills.editor.saved": "已保存技能「{name}」；在对话的技能菜单里勾选即可使用",
  // #31D/E/F 技能学习：从对话生成待验证技能、验证徽标、90 天归档提示
  "skills.learning.title": "从对话生成技能",
  "skills.learning.intro":
    "助手可以从最近一次对话里发现可复用的流程，生成一份四段内容齐全的技能草稿。保存后是「待验证」状态，不会自动生效；在对话里勾选启用前，请先确认它符合你的做法。",
  "skills.learning.detect": "检测最近一次对话",
  "skills.learning.detectHint":
    "满足任一条件才会提议：同一流程在两次对话里重复、你明确说「以后都这么做」、或一次任务连续 5 步成功。",
  "skills.learning.noConversation": "还没有对话记录，先去和助手聊一次",
  "skills.learning.noSignal": "这次对话没有可生成技能的模式（证据不足，不提议）",
  "skills.learning.detectFailed": "检测失败，请稍后重试",
  "skills.learning.trigger.repeat_workflow": "同一流程在多个对话里重复出现",
  "skills.learning.trigger.persistent_rule": "你明确说过以后都这么做",
  "skills.learning.trigger.long_success_trajectory": "一次任务连续 5 步成功",
  "skills.learning.modal.title": "确认技能草稿",
  "skills.learning.modal.intro": "四段内容都可以修改。保存后默认「待验证」，不会自动生效。",
  "skills.learning.modal.triggers": "触发原因",
  "skills.learning.modal.ok": "保存为待验证技能",
  "skills.learning.modal.cancel": "取消",
  "skills.learning.form.name": "技能名",
  "skills.learning.form.nameRequired": "请填写技能名",
  "skills.learning.form.description": "一句话说明",
  "skills.learning.form.descriptionRequired": "请写一句适用场景",
  "skills.learning.form.whenToUse": "何时使用",
  "skills.learning.form.whenToUseRequired": "请写触发条件",
  "skills.learning.form.steps": "步骤（每行一步）",
  "skills.learning.form.stepsRequired": "至少写一步",
  "skills.learning.form.pitfalls": "反例与注意事项（每行一条）",
  "skills.learning.accepted": "已保存技能「{name}」（待验证，不会自动启用）",
  "skills.learning.saveFailed": "保存技能失败",
  "skills.learning.pendingBadge": "待验证",
  "skills.learning.action.validate": "标为已验证",
  "skills.learning.validateConfirm": "确认这个技能已经实际用过且效果正确？标记后视为已验证。",
  "skills.learning.validated": "已标记为已验证",
  "skills.learning.validateFailed": "标记失败，请稍后重试",
  "skills.learning.archive.title": "有 {count} 个对话生成的技能 90 天未被加载",
  "skills.learning.archive.body":
    "这些技能长期没被加载：可以继续保留，也可以到列表里删除。系统不会自动删除。",
  "skills.learning.archive.item": "{name}（最近加载：{time}）",
  "skills.learning.archive.neverLoaded": "从未加载",
} as const;

export default skills;
