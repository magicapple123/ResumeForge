// SPDX-License-Identifier: Apache-2.0
/** 扫描件 OCR 面板（简历识别入口里的「扫描件 OCR」）。 */
const ocrScan = {
  "ocrScan.entry": "扫描件 OCR",
  "ocrScan.title": "扫描件 OCR 识别",
  "ocrScan.hint":
    "把没有文字层的扫描件 PDF 或图片上传，DeepSeek 按页识别成文字（按页计费）。识别在服务端后台进行，关掉这个窗口也不会中断。",
  "ocrScan.pickFile": "选择文件",
  "ocrScan.start": "开始识别",
  "ocrScan.cancelUpload": "取消上传",
  "ocrScan.stopWaiting": "停止等待",
  "ocrScan.stopNote": "停止等待只是不再刷新进度：服务端仍会识别完并照常计费，不能中途退钱。",
  "ocrScan.uploading": "正在上传原件…",
  "ocrScan.recognizing": "正在识别…",
  "ocrScan.pages": "已识别 {done} / {total} 页",
  "ocrScan.elapsed": "耗时 {seconds} 秒",
  "ocrScan.resultTitle": "识别结果",
  "ocrScan.chars": "共 {count} 字",
  "ocrScan.copy": "复制全文",
  "ocrScan.copied": "已复制",
  "ocrScan.close": "关闭",
  "ocrScan.failed": "识别失败：{reason}",
  "ocrScan.noFile": "先选一份文件",
  "ocrScan.emptyResult": "识别完成但没有文字，换一份更清晰的扫描件试试",
  "ocrScan.fileTooLarge": "文件超过 100 MB 上限",
  "ocrScan.stopped": "已停止等待（服务端仍在识别）",
};

export default ocrScan;
