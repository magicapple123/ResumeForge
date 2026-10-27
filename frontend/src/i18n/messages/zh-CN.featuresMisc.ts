// SPDX-License-Identifier: Apache-2.0
/**
 * 收尾批次的零散展示文案：CSV 批量导入的上限与失败兜底、数据集整包导入的逐份点名、
 * 分区拖拽脚手架的读屏标签、网申资料识别的提示，以及设置页技能列表的失败兜底。
 *
 * 这些文案分别由 `useCsvFileBatch` / `datasetImportFeedback` / `profileReorderHarness.testkit` /
 * `useWebformParse` / `useSettingsSkills` 在调用期（渲染时或事件回调里）取用，模块作用域
 * 只存 key。分句之间的标点也是 key（中文全角分号、英文半角分号加空格），避免英文界面
 * 出现全角标点。
 */
const featuresMisc = {
  /** CSV 批量导入：一次选太多文件、合并后超过行数上限。 */
  "featuresMisc.csvBatch.tooManyFiles": "一次最多 10 个 CSV 文件",
  "featuresMisc.csvBatch.tooManyRows": "合计超过 2000 行，请分批导入",
  /** 单个文件解析失败、某一块提交失败时的兜底原因（后端给了 message 就用后端的）。 */
  "featuresMisc.csvBatch.parseFailed": "解析 CSV 失败",
  "featuresMisc.csvBatch.commitFailed": "导入失败",

  /** 整包导入后逐份点名没恢复成功的数据集（最多列 3 份，其余只说份数）。 */
  "featuresMisc.datasetImport.failedSummary": "{count} 份数据集失败：{items}",
  "featuresMisc.datasetImport.skippedSummary": "{count} 份数据集跳过：{items}",
  "featuresMisc.datasetImport.failedRest": "；另有 {count} 份失败",
  "featuresMisc.datasetImport.skippedRest": "；另有 {count} 份跳过",
  "featuresMisc.datasetImport.item": "{name}：{reason}",
  "featuresMisc.datasetImport.unnamed": "未命名数据集",
  /** 逐份明细之间、以及失败/跳过两段之间的分隔符。 */
  "featuresMisc.datasetImport.separator": "；",

  /** 分区拖拽脚手架的读屏标签（{label} 是分区 key，既有用例按它定位按钮）。 */
  "featuresMisc.profileReorder.dragAria": "拖动调整{label}顺序",
  "featuresMisc.profileReorder.moveUpAria": "上移{label}",
  "featuresMisc.profileReorder.moveDownAria": "下移{label}",
  "featuresMisc.profileReorder.resetAria": "重置{label}",

  /** 网申资料识别：没有输入、没识别到栏目、请求失败。 */
  "featuresMisc.webformParse.needInput": "请先粘贴网申资料，或添加截图、上传文档",
  "featuresMisc.webformParse.emptyWarning":
    "没有识别到可填入的栏目，请检查粘贴的内容或换一种写法。",
  "featuresMisc.webformParse.failed": "识别网申资料失败",

  /** 设置页技能列表读取失败的兜底。 */
  "featuresMisc.settingsSkills.loadFailed": "加载技能失败",
} as const;

export default featuresMisc;
