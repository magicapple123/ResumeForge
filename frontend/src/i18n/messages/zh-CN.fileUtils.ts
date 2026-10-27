// SPDX-License-Identifier: Apache-2.0
/**
 * 文件与附件工具的执行期提示：附件读取、下载与打印、PDF 转 PNG、图片导出打包。
 *
 * 这些文案由 utils 在函数体或回调里经模块级 `t()` 取用；错误在发生的当下经
 * `message.error` 显示，渲染它们的组件不必为这些文案额外订阅 locale。
 */
const fileUtils = {
  "fileUtils.attachments.error.read": "读取附件失败",
  "fileUtils.download.error.popupBlocked": "浏览器拦截了弹窗，请允许本站弹窗后重试",
  "fileUtils.pdfToPng.error.canvasToPng": "浏览器未能把画布转成 PNG（画布可能过大）",
  "fileUtils.pdfToPng.error.noPages": "这份 PDF 里没有可渲染的页面",
  "fileUtils.pngExport.fallbackStem": "简历",
  "fileUtils.pngExport.error.conversionFailed":
    "PDF 已生成，图片转换失败。需要投递时可直接改用「PDF」导出。",
  "fileUtils.pngExport.error.conversionFailedWithDetail":
    "PDF 已生成，图片转换失败：{detail}。需要投递时可直接改用「PDF」导出。",
} as const;

export default fileUtils;
