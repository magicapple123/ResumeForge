// SPDX-License-Identifier: Apache-2.0
/**
 * 「草稿模式编辑」的**纯函数层**：常量、持久化、命中判定、往 iframe 里注入反馈样式。
 *
 * 它只做"给定一个 document（或一个事件目标），返回/改变什么"，**不含任何状态**——
 * 状态机与监听注册在 `./useClickToEditPreview` 里。这样切分的目的很实际：jsdom 里
 * 可以直接喂一个 `createHTMLDocument()` 造出来的文档来测命中与注入，不必挂 React、
 * 也不必造真 iframe。
 *
 * ## 视觉反馈为什么必须注入 iframe 内部
 *
 * 纸面是后端渲染的 HTML，加载在 `sandbox="allow-same-origin"` 的 iframe 里：
 * 父页面的样式表**进不去**。所以这里往那个文档的 `<head>` 插一个 `<style>`，再靠
 * `<html>` 上的 `is-click-to-edit` 开关它。**不改后端模板**——模板里一旦出现前端交互样式，
 * 导出产物（PDF / DOCX）也会带上它。
 *
 * 样式表**常驻**（规则全挂在开关 class 底下，关掉时是空转）：反复开关不该反复增删节点，
 * 而"插一次"要能判重，靠的就是那个固定的 `id`。
 */

/** 偏好类数据，允许进 `localStorage`（与 `resume.wb.widths` 同一类）。 */
export const CLICK_TO_EDIT_STORAGE_KEY = "resume.preview.clickEdit";

/** 注入 iframe 的那个 `<style>` 的 id（重复注入靠它判重）。 */
export const CLICK_TO_EDIT_STYLE_ID = "resume-click-to-edit-style";

/** 开关注入到 iframe `<html>` 上的 class：样式只在它底下生效。 */
export const CLICK_TO_EDIT_CLASS = "is-click-to-edit";

/** 后端模板给每处文本打的属性名（见 `_resume_sections.j2`）。 */
export const CLICK_TO_EDIT_PATH_ATTR = "data-resume-path";

/**
 * 注入 iframe 的样式。
 *
 * 颜色写死成半透明蓝而不是 `var(--rf-*)`：这个文档里**没有**前端的 token（它是后端模板
 * 渲染的纸面），能用的只有模板自己的 `:root` 变量。半透明色在深浅两种页面上都能盖在
 * 文字上而不遮字。
 */
export const CLICK_TO_EDIT_CSS = [
  `.${CLICK_TO_EDIT_CLASS} [${CLICK_TO_EDIT_PATH_ATTR}]`,
  "{cursor:pointer;border-radius:2px;transition:background-color .12s ease,box-shadow .12s ease}",
  `.${CLICK_TO_EDIT_CLASS} [${CLICK_TO_EDIT_PATH_ATTR}]:hover`,
  "{background-color:rgba(30,58,138,.12);box-shadow:0 0 0 2px rgba(30,58,138,.12)}",
].join("");

/** 读一次持久化的勾选值。`localStorage` 在隐私模式/配额满时会抛，所以整段包住。 */
export function readStoredClickToEdit(): boolean {
  try {
    return window.localStorage.getItem(CLICK_TO_EDIT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** 写一次持久化值。落盘失败不影响本次会话：勾选在这一次浏览里仍然生效。 */
export function writeStoredClickToEdit(value: boolean): void {
  try {
    window.localStorage.setItem(CLICK_TO_EDIT_STORAGE_KEY, value ? "1" : "0");
  } catch {
    // 忽略：偏好存不下不是功能错误。
  }
}

/**
 * 把一个 iframe 文档刷成"可点 / 不可点"。
 *
 * 样式表**始终注入一次**，勾选状态只切 `<html>` 上的 class。文档还没解析完
 * （`documentElement` 为空）时安全返回。
 */
export function paintClickToEdit(doc: Document | null, enabled: boolean): void {
  if (!doc?.documentElement) return;
  if (!doc.getElementById(CLICK_TO_EDIT_STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = CLICK_TO_EDIT_STYLE_ID;
    style.textContent = CLICK_TO_EDIT_CSS;
    (doc.head ?? doc.documentElement).appendChild(style);
  }
  doc.documentElement.classList.toggle(CLICK_TO_EDIT_CLASS, enabled);
}

/**
 * 把视口里**已经加载好**的每个 iframe 文档刷成当前勾选状态。
 *
 * 用户在同一个页面上勾/取消勾，不该为了看到反馈先去改一次内容触发 iframe 重载。
 * 从容器上找 iframe 而不是让 hook 记住所有文档：文档会随 `srcDoc` 重载被换掉，
 * 记住它们只会留下"已经被丢弃的文档"。
 */
export function paintLoadedFrames(container: HTMLElement | null, enabled: boolean): void {
  if (!container) return;
  for (const frame of Array.from(container.querySelectorAll("iframe"))) {
    paintClickToEdit(frame.contentDocument, enabled);
  }
}

/**
 * 纸面上有没有**非空文本选区**（用户正在拖选文字）。
 *
 * 拖选结束必然跟一发 `click`：那一拍如果照常"点哪跳哪"，编辑栏的 textarea 会把焦点抢走，
 * 刚拖出来的选区立刻作废——体感就是"预览里根本选不中字"（2026-10-29 用户反馈）。
 * 所以"有没有选区"要能被单独判定，且能脱离真实 iframe 单测（`defaultView` 在
 * `createHTMLDocument()` 造出来的文档里是 null，真实 iframe 里一定不是）。
 */
export function hasTextSelection(doc: Document | null): boolean {
  const selection = doc?.defaultView?.getSelection?.() ?? null;
  if (!selection || selection.isCollapsed) return false;
  return selection.toString().trim().length > 0;
}

/**
 * 从事件目标往上找最近的「带路径的节点」，返回它的 `data-resume-path`。
 *
 * 用 `getAttribute` 而不是 `dataset`：跨文档时（iframe 里的 Element 与父窗口的 `Element`
 * 是两个 realm）只有属性读写是同一套语义。空串 / 纯空白也算没命中。
 */
export function resolvePickPath(target: EventTarget | null): string | null {
  const element = target as { closest?: unknown; getAttribute?: unknown } | null;
  if (!element || typeof element.closest !== "function") return null;
  const hit = (element.closest as (selector: string) => Element | null)(
    `[${CLICK_TO_EDIT_PATH_ATTR}]`,
  );
  if (!hit) return null;
  const path = (hit.getAttribute(CLICK_TO_EDIT_PATH_ATTR) ?? "").trim();
  return path.length > 0 ? path : null;
}
