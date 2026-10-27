// SPDX-License-Identifier: Apache-2.0
/**
 * 「经历参考资料」字段：补充总结的名称与内容、导入 / 替换 / 移除 / 预览动作，以及读文件
 * 失败时的提示。
 *
 * 这段总结是随资料表单一起提交的一段文本；名称为空时界面回落到「手动输入总结」，手动输入
 * 内容时也会自动填入同名文件名（带 `.md`）。两者都是用户看得见的展示文案，按文案翻译。
 */
const referenceFile = {
  /** 名称输入框的标签。 */
  "referenceFile.label.name": "补充总结名称",
  /** 名称输入框下方的说明。 */
  "referenceFile.extra.name": "导入文件会自动填入名称；直接输入内容时可自定义名称",
  /** 名称输入框的占位符。 */
  "referenceFile.placeholder.name": "如：项目总结.md",
  /** 内容输入框的标签；还没命名时，它同时是预览弹窗的标题。 */
  "referenceFile.label.content": "补充总结内容",
  /** 内容输入框下方的说明。 */
  "referenceFile.extra.content": "支持直接输入，最多 200,000 字符",
  /** 内容输入框的占位符。 */
  "referenceFile.placeholder.content": "可直接粘贴或输入项目总结、工作成果、校园经历细节等内容",
  /** 还没有名称时显示的名字。 */
  "referenceFile.name.manual": "手动输入总结",
  /** 手动输入内容时自动填入的文件名。 */
  "referenceFile.name.manualFile": "手动输入总结.md",
  /** 选择文件按钮。 */
  "referenceFile.action.import": "导入文件",
  /** 已经导入过文件时的按钮。 */
  "referenceFile.action.replace": "替换文件",
  /** 移除已添加的总结。 */
  "referenceFile.action.remove": "移除总结",
  /** 打开预览弹窗。 */
  "referenceFile.action.view": "查看内容",
  /** 拖文件悬停时的提示。 */
  "referenceFile.hint.drop": "松开即可导入总结文件（.md / .txt）",
  /** 扩展名不在白名单里。 */
  "referenceFile.error.extension": "仅支持 .md 或 .txt 格式的总结文件",
  /** 文件名过长。 */
  "referenceFile.error.nameTooLong": "总结文件名不能超过 255 个字符",
  /** 文件过大。 */
  "referenceFile.error.size": "总结文件不能超过 200 KB",
  /** 读文件时抛出的非编码错误。 */
  "referenceFile.error.readFailed": "读取总结文件失败",
  /** 解码失败：文件不是有效的 UTF-8。 */
  "referenceFile.error.encoding": "文件不是有效的 UTF-8 编码，请转换编码后重试",
  /** 读入成功，但要点「保存」才会随资料提交。 */
  "referenceFile.toast.added": "总结文件已添加，保存全部资料后生效",
  /** 字数；`{count}` 已经按千分位格式化。 */
  "referenceFile.count.chars": "{count} 字",
} as const;

export default referenceFile;
