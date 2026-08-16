/** 浏览器端文件下载与打印工具。 */

/** 触发浏览器下载 blob 文件 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** 在新窗口打开 HTML 并自动调起打印（另存为 PDF） */
export function printHtml(html: string): void {
  const win = window.open("", "_blank");
  if (!win) {
    throw new Error("浏览器拦截了弹窗，请允许本站弹窗后重试");
  }
  win.document.write(html);
  win.document.close();
  // 等浏览器完成渲染后再调起打印
  setTimeout(() => {
    win.focus();
    win.print();
  }, 300);
}
