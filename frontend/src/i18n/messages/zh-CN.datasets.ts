// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页的数据集卡片：列表、切换/重命名/删除、导入备份、导出对话框。
 *
 * 说明段落里原来的 `<strong>` 高亮改成文案内的强调词：片段拼接在英文里语序不通，
 * 而 i18n 没有富文本插值（与投递队列页同一处理）。
 */
const datasets = {
  "datasets.card.title": "数据集",
  "datasets.action.create": "新建空数据集",
  "datasets.action.import": "导入备份为新数据集",
  "datasets.action.exportCurrent": "导出当前数据集",
  "datasets.action.exportAll": "导出全部数据集",
  "datasets.action.export": "导出",
  "datasets.action.switch": "切换",
  "datasets.action.rename": "重命名",
  "datasets.action.delete": "删除",
  "datasets.intro":
    "数据集是一份完整的简历库（岗位、资料、简历、收藏与助手会话），可整份导出、导入或切换，互不影响。",
  "datasets.hint.summary": "备份包默认包含全局模型配置、API Key 与自定义字体。",
  "datasets.export.contents.title": "导出包里包含什么",
  "datasets.export.contents.action": "查看说明",
  "datasets.option.globalConfig": "备份中包含全局模型配置与 API Key（所有已保存记录）",
  "datasets.hint.globalConfig":
    "默认勾选。全局模型配置存在数据目录的「global_settings.json」，不在任何数据集的库里；勾选后会作为独立的一段随包导出，导入时合并回本机（同名且本地已有内容的记录保留本地）。",
  "datasets.hint.apiKey":
    "默认勾选。API Key 跟随这一项：勾选时按本机存储的形态一并写入（Windows 上为系统加密、绑定当前用户与这台电脑，换电脑恢复后可能需要重新填写；macOS/Linux 上密钥以明文随包），取消勾选则配置与密钥都不带。勾选后的备份包更敏感，请妥善保管，不要发给不信任的人。",
  "datasets.hint.fonts":
    "自定义字体（数据目录的「data/fonts/」）会随包一起导出：换机器导入后，简历里引用的字体不会断；本机已有同名字体时保留本机版本，不会被包里那份覆盖。",
  "datasets.dropzone.hint": "松开即可导入备份包（.zip）",
  "datasets.dropzone.aria": "选择备份文件",
  "datasets.import.tooltip": "导入会新增一份数据集，不会改动当前正在使用的数据",
  "datasets.empty": "暂无数据集",
  "datasets.tooltip.active": "正在使用",
  "datasets.tooltip.switch": "切换到这份数据",
  "datasets.badge.current": "当前",
  "datasets.source.sample": "示例体验",
  /** 数据集来源（后端 `_describe` 的 source_code）：中文与落盘的 source 原文逐字一致。 */
  "datasets.source.machine": "本机",
  "datasets.source.created": "新建",
  "datasets.source.imported": "导入",
  "datasets.source.restored": "随备份包导入",
  "datasets.confirm.delete": "删除数据集“{name}”？",
  "datasets.default.allName": "全部数据集",
  "datasets.default.importName": "导入的数据集",
  "datasets.rename.title": "重命名数据集",
  "datasets.rename.save": "保存",
  "datasets.rename.hint": "名称只用于在列表里区分，不影响数据内容。",
  "datasets.create.title": "新建空数据集",
  "datasets.create.ok": "新建",
  "datasets.create.hint":
    "新建后进入数据集列表，可随时切换过去；激活后是一份空数据（岗位、简历、资料都从零开始）。",
  "datasets.create.placeholder": "数据集名称（例如：秋招专用）",
  "datasets.export.titleAll": "导出全部数据集",
  "datasets.export.titleOne": "导出数据集",
  "datasets.export.includeConfig": "导出包中包含全局模型配置与 API Key（所有已保存记录）",
  "datasets.export.hint": "这个名字会作为下载文件名，可含中文；扩展名会自动补 .zip。",
  "datasets.export.placeholder": "例如：校招线-20261019-101500",
  "datasets.export.aria": "导出文件名",
} as const;

export default datasets;
