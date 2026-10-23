// SPDX-License-Identifier: Apache-2.0
/**
 * 纸面 iframe 里的**选区 → 加粗目标**换算：命中哪条路径、落在第几个可见字符、菜单画在哪。
 *
 * 这一层刻意全是纯函数（入参只有 `Document` / `Element` / 事件），因为它的每一条判断都
 * 只在"右键之后"才看得见，而且都不会报错：
 *
 * 1. **跨字段的选区**不能加粗（一对标记不许跨字段，是后端写死的规则）——两个端点必须命中
 *    **同一个** `[data-resume-path]`；
 * 2. **原生输入框里**的选区不归我们管（右键菜单应该是浏览器的）；
 * 3. **偏移量对不上**时不劫持：`**` 不计入可见字符，若 DOM 里的文字与源串剥掉标记后的
 *    长度不一致（模板改过、空白被折叠），任何偏移换算都是猜的——猜错会把星号插到词中间。
 *
 * 跨 realm 的两处写法不是风格问题：iframe 里的 `Element` 与父窗口的 `Element` 是两个构造
 * 函数，所以属性一律走 `getAttribute`，元素判断一律走 `nodeType` / `tagName`。
 */
import { clamp, VIEWPORT_MARGIN } from "../../features/ai-polish/overlayGeometry";
import { isBoldVisible, visibleLength } from "./richText";

/** 后端模板给每处文本打的属性名（与 `clickToEdit.ts` 同一串）。 */
const PATH_ATTR = "data-resume-path";

/** 菜单的估算尺寸：只用于"别让整张菜单掉出视口"的夹取。 */
const MENU_WIDTH = 156;
const MENU_HEIGHT = 190;

/** 一次右键命中的全部事实：菜单点下去要的就这些。 */
export interface RichSelectionHit {
  /** 命中的 `[data-resume-path]` 元素（跨 realm，只当 `Element` 用）。 */
  element: Element;
  /** 元素所在的文档（iframe 里那个）。 */
  doc: Document;
  path: string;
  /** 这一栏当前的源串（含 `**`）。 */
  raw: string;
  /** 选区起止（**渲染态**偏移，标记不计）。 */
  start: number;
  end: number;
  /** 选区是否整段已经加粗：决定菜单显示「加粗」还是「取消加粗」。 */
  isBold: boolean;
}

/** 取一个节点所属元素（文本节点取父元素）。 */
function elementOf(node: Node | null): Element | null {
  if (!node) return null;
  if (node.nodeType === 1) return node as Element;
  return node.parentElement ?? null;
}

/** 从节点往上找最近的带路径节点，返回它的路径（空串视为没命中）。 */
function pathAt(node: Node | null): { element: Element; path: string } | null {
  const hit = elementOf(node)?.closest(`[${PATH_ATTR}]`) ?? null;
  if (!hit) return null;
  const path = (hit.getAttribute(PATH_ATTR) ?? "").trim();
  return path.length > 0 ? { element: hit, path } : null;
}

/**
 * 容器里"从头到某个边界点"的可见字符数。
 *
 * `Range.toString()` 只取文本、不含标签，正是渲染态的口径；`selectNodeContents` 打底 +
 * `setEnd` 收边是唯一不依赖遍历的算法（元素边界、跨 `<strong>` 都成立）。
 */
function offsetWithin(root: Element, node: Node, offset: number, doc: Document): number | null {
  if (!root.contains(node) && node !== root) return null;
  const range = doc.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(node, offset);
  } catch {
    // 偏移越界（DOM 刚被换掉）：当没命中，交给原生菜单。
    return null;
  }
  return range.toString().length;
}

/**
 * 判读当前选区是不是"一处可加粗的纸面字段"。
 *
 * `read` 由宿主提供（它才知道 overlay 之后的真实源串）；任何一环拿不到就返回 `null`，
 * 调用方据此**不** `preventDefault`——原生右键菜单照旧。
 */
export function resolveRichSelection(
  doc: Document | null,
  read: (path: string) => string | null,
  selection?: Selection | null,
): RichSelectionHit | null {
  if (!doc) return null;
  const sel = selection ?? doc.defaultView?.getSelection() ?? null;
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  // 原生输入框里的选区归浏览器：那边有剪切 / 粘贴 / 拼写检查。
  if (elementOf(sel.anchorNode)?.closest("input, textarea, select")) return null;
  const range = sel.getRangeAt(0);
  const head = pathAt(range.startContainer);
  const tail = pathAt(range.endContainer);
  // 跨两个字段（或只命中一边）→ 不加粗：一对标记不许跨字段。
  if (!head || !tail || head.element !== tail.element) return null;
  const raw = read(head.path);
  if (raw === null) return null;
  const start = offsetWithin(head.element, range.startContainer, range.startOffset, doc);
  const end = offsetWithin(head.element, range.endContainer, range.endOffset, doc);
  if (start === null || end === null) return null;
  const [first, second] = start <= end ? [start, end] : [end, start];
  if (first === second) return null;
  // 偏移量必须与源串对得上：否则宁可放行原生菜单，也不要猜着插标记。
  const rendered = head.element.textContent ?? "";
  if (rendered.length !== visibleLength(raw) || second > rendered.length) return null;
  return {
    element: head.element,
    doc,
    path: head.path,
    raw,
    start: first,
    end: second,
    isBold: isBoldVisible(raw, first, second),
  };
}

/**
 * 把 iframe 内的指针坐标换算成**父页面**的视口坐标。
 *
 * 菜单画在父页面（iframe 里画会把选区弄丢，而且纸面有 `zoom`/分栏变换）。iframe 被 CSS
 * 缩放时 `clientX` 与父页面的像素不是 1:1，用 `rect.width / offsetWidth` 补偿；`offsetWidth`
 * 取不到（jsdom、display:none）时按 1 处理，此时 rect 也基本是 0，结果退化成 clientX。
 */
export function menuPoint(doc: Document, event: { clientX: number; clientY: number }) {
  const frame = doc.defaultView?.frameElement as HTMLElement | null;
  const rect = frame?.getBoundingClientRect();
  const layoutWidth = frame?.offsetWidth ?? 0;
  const layoutHeight = frame?.offsetHeight ?? 0;
  const scaleX = rect && layoutWidth > 0 ? rect.width / layoutWidth : 1;
  const scaleY = rect && layoutHeight > 0 ? rect.height / layoutHeight : 1;
  const left = (rect?.left ?? 0) + event.clientX * scaleX;
  const top = (rect?.top ?? 0) + event.clientY * scaleY;
  return {
    x: clamp(left, VIEWPORT_MARGIN, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN),
    y: clamp(top, VIEWPORT_MARGIN, window.innerHeight - MENU_HEIGHT - VIEWPORT_MARGIN),
  };
}

/** 容器里的全部文本节点（文档顺序）。 */
function textNodesOf(root: Element): Text[] {
  const nodes: Text[] = [];
  const visit = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) nodes.push(child as Text);
      else if (child.nodeType === 1) visit(child);
    }
  };
  visit(root);
  return nodes;
}

/** 渲染态偏移 → `(文本节点, 节点内偏移)`；越界时贴到最后一个文本节点末尾。 */
function locate(nodes: Text[], index: number): { node: Text; offset: number } | null {
  let remaining = Math.max(0, index);
  for (const node of nodes) {
    const length = node.nodeValue?.length ?? 0;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
  }
  const last = nodes[nodes.length - 1];
  if (!last) return null;
  return { node: last, offset: last.nodeValue?.length ?? 0 };
}

/**
 * 把选区放回 `[start, end)`（渲染态偏移）。
 *
 * 菜单点完「加粗」后 DOM 被就地替换过，浏览器原来的选区已经失效；不恢复的话，用户看到的
 * 是"刚选中一段、点完加粗选区没了"，接着想再点一次就只能重新划。
 */
export function restoreRichSelection(element: Element | null, start: number, end: number): void {
  if (!element || !element.isConnected) return;
  const sel = element.ownerDocument.defaultView?.getSelection() ?? null;
  if (!sel) return;
  const nodes = textNodesOf(element);
  const head = locate(nodes, start);
  const tail = locate(nodes, end);
  if (!head || !tail) return;
  if (typeof sel.setBaseAndExtent === "function") {
    sel.setBaseAndExtent(head.node, head.offset, tail.node, tail.offset);
    return;
  }
  const range = element.ownerDocument.createRange();
  range.setStart(head.node, head.offset);
  range.setEnd(tail.node, tail.offset);
  sel.removeAllRanges();
  sel.addRange(range);
}
