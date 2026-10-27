// SPDX-License-Identifier: Apache-2.0
/**
 * hooks 在回调 / 渲染期抛出的界面文案：远程搜索下拉的状态与空态、简历选项的兜底名、
 * 投递批次明细的加载失败、识别文件的限额提示、更新下载状态的读取失败。
 *
 * 这些文案由 hook 在执行期经模块级 `t()` 取用（模块作用域不求值）；渲染它们的页面
 * 负责订阅语言变化。
 */
const hooksUi = {
  /** 远程搜索下拉正在取数时的空态（antd `notFoundContent`）。 */
  "hooksUi.remoteSearch.searching": "搜索中…",
  /** 远程搜索没命中时的空态：告诉用户可以继续输入关键词。 */
  "hooksUi.remoteSearch.empty": "无匹配结果，可输入关键词搜索",

  /** 简历没填标题时的下拉兜底名；`{id}` 是简历 id。 */
  "hooksUi.option.resumeFallback": "简历 #{id}",

  /** 展开批次后拉取明细失败（后端没给出更具体的原因时）。 */
  "hooksUi.batchItems.error.load": "加载批次明细失败",

  /** 选入的文件数已到上限；`{count}` 是上限条数。 */
  "hooksUi.recognition.warning.tooMany": "最多只能添加 {count} 个文件",
  /** 选中的文件既不是截图也不是受支持的文档；`{name}` 是文件名。 */
  "hooksUi.recognition.warning.unsupported":
    "「{name}」不是受支持的截图或文档（png/jpg/webp/gif/bmp/tiff、pdf/docx）",
  /** 单个文件超过体积上限；`{name}` 是文件名。 */
  "hooksUi.recognition.warning.tooLarge": "「{name}」超过 2 MB",
  /** 所有暂存文件的合计体积到上限。 */
  "hooksUi.recognition.warning.totalTooLarge": "文件总大小不能超过 5 MB",
  /** 文件读成 data URL 失败。 */
  "hooksUi.recognition.error.read": "读取文件失败",

  /** 下载状态接口读取失败：说清「怎么办」，用户才能决定要不要继续下载 / 安装。 */
  "hooksUi.updateStatus.error.read": "暂时无法读取下载状态，请重试读取后再下载或安装",
} as const;

export default hooksUi;
