// SPDX-License-Identifier: Apache-2.0
/**
 * 深色主题下的「草稿纸面」染色（问题 19 方案 A）——**纯函数层**。
 *
 * ## 为什么是滤镜而不是换一套深色调色板
 *
 * 纸面是后端模板渲染出来的 HTML，颜色来自每个模板自己 `:root` 里的 `--bg / --text / …`，
 * 而「页面背景色」又是用户可以改的格式字段。要"深色下纸也暗"只有两条路：
 *
 *  - 改 `--bg`：等于给 9 个模板各写一套深色映射（第二份真源，模板一改就漂），而且会把
 *    用户自己选的米色/浅灰**整个盖掉**——他会以为设置坏了；
 *  - 整体反色：模板零维护，用户选的背景色保留相对关系（米色→深米色），新增模板自动生效。
 *
 * 所以对草稿 iframe 整体做 `invert(1) hue-rotate(180deg)`，再对 iframe 内部的图片 / 矢量
 * 图做**同一组滤镜抵消一次**（否则证件照会变成负片）。`invert(1)` 是唯一有精确反函数的
 * 档位：`invert(0.88)` 这类"温柔"档位还原不回去，照片会发灰。
 *
 * ## 纸底靠反算色，不靠调 invert（I-36）
 *
 * 反色后的纸底 = 模板 `--bg` 的反相。白纸会翻成 **#000 纯黑**，比应用底色还暗，读成
 * "页面被挖空了一块"。解决办法不是把 `invert(1)` 调成小数（照片会跟着发灰），而是给
 * 深色纸**反向写一个 #e1e1e1 的 body 底色**：`invert(1)` 正好得回 #1e1e1e 中性炭灰
 * （`hue-rotate(180deg)` 对无彩度灰是恒等）。顺带把用户自选的页面背景色统一掉——这是
 * I-36 拍板的取舍，导出 / 打印仍用模板原色。
 *
 * 这条 body 底色**必须包在 `@media screen` 里**：样式注入同样作用于 `Ctrl+P` 的打印
 * 预览，不包就会打出一张灰纸（父页面的 `@media print { filter: none }` 只关滤镜，
 * 关不掉这条背景）。
 *
 * ## 边界（三条都不能破）
 *
 * 1. **只作用于预览**。样式注入的是 iframe **内部**的文档（父页面样式进不去），导出走服务端
 *    渲染，一行都没碰；
 * 2. **不写后端模板**：模板里一旦出现前端交互样式，PDF / DOCX 产物也会带上它；
 * 3. 样式表**常驻、只注入一次**，开关只切 `<html>` 上的 class——反复切主题不该反复增删节点。
 *    文档还没解析完（`documentElement` 为空）时安全返回，与 `clickToEdit.ts` 同一套做法。
 */

/** 注入 iframe `<html>` 上的 class：反色与图片抵消都只在它底下生效。 */
export const PAPER_DARK_CLASS = "rf-paper-dark";

/** 注入 iframe 的那个 `<style>` 的 id（重复注入靠它判重）。 */
export const PAPER_DARK_STYLE_ID = "rf-paper-dark-style";

/** 深色纸底经过 `invert(1)` 之后要落地成的颜色（与 `--rf-preview-paper` 同值）。 */
export const DARK_PAPER_BG = "#1e1e1e";

/**
 * 深色纸底的**反算色**：`invert(1)` 把 `#e1e1e1` 翻回 `#1e1e1e`。
 *
 * 直接写 `#1e1e1e` 会被滤镜再翻一次，纸会变成浅灰 `#e1e1e1`。
 */
export const DARK_PAPER_BG_INVERSE = "#e1e1e1";

/**
 * 注入 iframe 的样式：抵消图片与内联矢量图，并把纸底反算成炭灰。
 *
 * 用 `img` / `svg` 两个元素选择器而不是"排除法"：模板里的装饰性色块（分隔线、标题竖条）
 * 本来就该跟着一起反色，只有**照片与图标**需要保持原样。`svg` 一并抵消是为了不让图标
 * 在深色纸上变成一块白底负片。
 *
 * 第二条 `body` 底色包在 `@media screen` 里：打印预览必须还是模板原本的白纸（I-36）。
 */
export const PAPER_DARK_CSS = [
  `html.${PAPER_DARK_CLASS} img,html.${PAPER_DARK_CLASS} svg`,
  "{filter:invert(1) hue-rotate(180deg)}",
  `@media screen{html.${PAPER_DARK_CLASS} body{background: ${DARK_PAPER_BG_INVERSE} !important}}`,
].join("");

/**
 * 把一个 iframe 文档刷成"深色纸 / 白纸"。
 *
 * 样式表**始终注入一次**（规则全挂在开关 class 底下，关掉时是空转），开关只切 class。
 */
export function paintPaperTheme(doc: Document | null, dark: boolean): void {
  if (!doc?.documentElement) return;
  if (!doc.getElementById(PAPER_DARK_STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = PAPER_DARK_STYLE_ID;
    style.textContent = PAPER_DARK_CSS;
    (doc.head ?? doc.documentElement).appendChild(style);
  }
  doc.documentElement.classList.toggle(PAPER_DARK_CLASS, dark);
}

/**
 * 把视口里**已经加载好**的每个 iframe 刷成当前主题。
 *
 * 切主题时不能靠"改 `srcDoc` 触发重载"：那会闪白、丢滚动位置、丢缩放档位。但父页面也
 * 进不去正在显示的文档，所以只能遍历容器里的 iframe 逐个刷——文档会随 `srcDoc` 重载被
 * 换掉，因此每次都从容器上现场找，不记住文档引用。
 */
export function paintLoadedPaperFrames(container: HTMLElement | null, dark: boolean): void {
  if (!container) return;
  for (const frame of Array.from(container.querySelectorAll("iframe"))) {
    paintPaperTheme(frame.contentDocument, dark);
  }
}
