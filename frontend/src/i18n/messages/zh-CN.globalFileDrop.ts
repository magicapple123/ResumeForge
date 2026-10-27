// SPDX-License-Identifier: Apache-2.0
/**
 * 全应用拖入导入（`components/GlobalFileDrop.tsx`）：投放遮罩、`.zip` 备份导入确认、
 * `.json` 新建简历、`.csv` 转去岗位页，以及拖入多个文件 / 不支持的类型时的提示。
 *
 * 为什么 `.csv` 只负责带路：解析与逐行预览都在岗位页，这里再实现一套会变成两份逻辑。
 *
 * 确认弹窗的「取消」复用 `common.action.cancel`，不另建同义 key。
 */
const globalFileDrop = {
  /** 拖文件到窗口任意位置时出现的整屏遮罩。 */
  "globalFileDrop.dragOverlay.title": "松开即可导入",
  "globalFileDrop.dragOverlay.hint": "支持 .zip 数据集备份、.csv 岗位表格、.json 简历内容",

  /** `.zip`：导入备份包，新增一份数据集，当前正在使用的数据不受影响。 */
  "globalFileDrop.zipImport.title": "导入备份包为新数据集？",
  "globalFileDrop.zipImport.content":
    "{name} 会新增一份数据集，当前正在使用的数据不受影响；导入后可以随时切换过去。",
  "globalFileDrop.zipImport.confirm": "导入",
  /** 导入完成后点名新建的那份数据集。整包可能只恢复了一部分，失败项另行提示。 */
  "globalFileDrop.zipImport.success": "已导入数据集「{name}」",

  /** `.json`：按文件内容新建一份手写简历。 */
  "globalFileDrop.jsonImport.title": "从 JSON 新建一份简历？",
  "globalFileDrop.jsonImport.content":
    "{name} 会作为一份新的手写简历保存，正文按文件里的内容填写。",
  "globalFileDrop.jsonImport.confirm": "新建简历",
  /** 文件不是合法 JSON：内容没被读进来，用户重选或修文件即可。 */
  "globalFileDrop.jsonImport.parseError": "这个 JSON 解析失败，请确认文件没有损坏",
  /** 合法 JSON 但不是一份简历对象：说明要提供什么形状，而不是只说"格式不对"。 */
  "globalFileDrop.jsonImport.shapeError": "JSON 里必须是一个简历对象（包含姓名、经历等字段）",
  "globalFileDrop.jsonImport.success": "已新建简历「{name}」",

  /** `.csv`：全局投放不解析表格，只把人带到岗位页。 */
  "globalFileDrop.csvImport.title": "CSV 请从岗位页导入",
  "globalFileDrop.csvImport.content":
    "岗位页的「导入 CSV」支持一次选多个文件、也支持直接粘贴表格内容，并能逐行预览会导入什么。",
  "globalFileDrop.csvImport.confirm": "去岗位页",

  /** 拖入的文件本身不构成一份可导入的来源。 */
  "globalFileDrop.fileInfo.multiple":
    "一次拖入一个文件；岗位 CSV 支持多选，请到岗位页使用「导入 CSV」",
  "globalFileDrop.fileInfo.unsupported":
    "不支持的文件类型「{extension}」：可以拖入 {formats}（.zip 数据集备份、.csv 岗位表格、.json 简历内容）",

  /** 文件名去掉扩展名后为空时，新建简历的默认标题。 */
  "globalFileDrop.resume.defaultTitle": "导入的简历",
} as const;

export default globalFileDrop;
