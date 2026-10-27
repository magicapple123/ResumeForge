// SPDX-License-Identifier: Apache-2.0
/**
 * 技能工作台：内置模板的名称与说明、表格、导入导出提示、空态与使用说明。
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

  "skills.toast.toggleFailed": "切换技能状态失败",
  "skills.toast.deleted": "已删除技能「{name}」",
  "skills.toast.deleteFailed": "删除技能失败",
  "skills.toast.imported": "已导入技能「{name}」",
  "skills.toast.importFailed": "导入技能失败",

  "skills.action.view": "查看 / 编辑",
  "skills.action.delete": "删除",
  "skills.action.import": "导入技能（.md / .zip）",
  "skills.action.create": "新建技能",
  "skills.confirm.delete": "删除技能「{name}」？删除后助手不再按它的要求作答。",

  "skills.column.skill": "技能",
  "skills.column.enabled": "启用",
  "skills.column.prompt": "提示词",
  "skills.column.promptLength": "{count} 字",
  "skills.column.files": "知识文件",
  "skills.column.source": "来源",
  "skills.column.updatedAt": "更新时间",
  "skills.column.actions": "操作",
  "skills.aria.enable": "启用技能「{name}」",
  "skills.aria.disable": "停用技能「{name}」",
  "skills.none": "无",
  "skills.fileCount": "{count} 个",

  "skills.breadcrumb": "工作台",
  "skills.tab.skills": "技能",
  "skills.guide.whatTitle": "技能是什么",
  "skills.guide.whatBody":
    "技能由两部分组成：提示词是加进助手系统提示的长期要求（例如「改写简历要点时每条不超过 35 字」）；知识文件是助手按需查阅的参考资料（例如常见面试题清单）。技能只影响助手怎么回答，不会改动你的岗位、简历和资料。",
  "skills.guide.howTitle": "工作台怎么用",
  "skills.guide.how1": "从下面的模板复制一个起点，或直接点「新建技能」；",
  "skills.guide.how2": "用「你要…」「不要…」把要求写具体，保存后技能立即生效；",
  "skills.guide.how3":
    "在求职助手页可以随时开关技能，也可以用「导入技能」加载别人分享的 .md / .zip。",
  "skills.guide.templates": "模板：",
  "skills.budget.title":
    "启用的技能越多，系统提示越长：技能提示词总量超过预算时，后面的技能不会被加载（助手会用一句话说明）。",
  "skills.error.loadFailed": "技能加载失败：{error}",
  "skills.empty": "还没有技能，先用模板建一个试试",
} as const;

export default skills;
