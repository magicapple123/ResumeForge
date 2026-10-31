// SPDX-License-Identifier: Apache-2.0
/**
 * 预览 iframe 专用的 HTML 清洗：去掉后端模板里的「排页探针脚本」。
 *
 * 草稿画布用 `<iframe sandbox="allow-same-origin">`（**没有** allow-scripts）：脚本本来
 * 就不会执行，只会在控制台刷一条 `Blocked script execution in 'about:srcdoc' …`（Q22）。
 * 去掉它不改变任何行为——预览的溢出 / 页数由前端自己量（`layout.ts` +
 * `resumeLayoutMeasure.ts`），不读这个脚本写出的 `body.dataset`；而**导出单文件 HTML**
 * 不经过这个函数，探针照常保留（那是"离线文件超没超页"的唯一回答者）。
 *
 * 只删脚本块，不动其它标签：模板里的样式表、`data-resume-path`、字体 @font-face 都要原样进
 * iframe，否则预览与导出会在这里分叉。
 */
const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script>/gi;

export function stripPreviewScripts(html: string): string {
  return html.includes("<script") ? html.replace(SCRIPT_BLOCK, "") : html;
}
