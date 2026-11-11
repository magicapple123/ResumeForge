// SPDX-License-Identifier: Apache-2.0
/**
 * 响应式门槛的共用清单与采集函数。
 *
 * 两个来源必须一致：视口矩阵来自方案 §7.1，路由清单来自 `src/App.tsx` 的 `<Route>`。
 * 路由写死在这里是刻意的——从 App.tsx 里反射解析路由要跑一遍 TS，代价远大于维护一张
 * 18 行的表；`App.test.tsx` 已经守着"每个路由都能渲染"，这里只负责"渲染后不溢出"。
 */

/** 8 个主档（V1–V8）；960/768 只进截图 harness，不进 CI（E 档的结构性缺陷另记）。 */
export const VIEWPORTS = [
  { name: "V1-2560", width: 2560, height: 1440 },
  { name: "V2-2048", width: 2048, height: 1280 },
  { name: "V3-1920", width: 1920, height: 1080 },
  { name: "V4-1536", width: 1536, height: 864 },
  { name: "V5-1440", width: 1440, height: 900 },
  { name: "V6-1366", width: 1366, height: 768 },
  { name: "V7-1280", width: 1280, height: 720 },
  { name: "V8-1092", width: 1092, height: 614 },
] as const;

/**
 * 18 条路由（与 `App.tsx` 的 `<Route path=` 一一对应，`*` 除外）。
 *
 * `fitsViewport`：这条路由**声明自己必须装进一屏**（`.app-content` 不出现纵向滚动）。
 * 只有 `/assistant` 是这种三条式工作区（标题/消息/输入，消息区内部滚动）；其余页面是
 * 普通长页面，`.app-content` 就是滚动容器，纵向滚动是设计内的——把它们也判进去会得到
 * 80 条假红（2026-11-11 实测），那条守卫会立刻被人删掉。
 */
export const ROUTES = [
  { name: "home", path: "/" },
  { name: "jobs", path: "/jobs" },
  { name: "resumes", path: "/resumes" },
  { name: "apply", path: "/apply" },
  { name: "webform", path: "/webform" },
  { name: "tracker", path: "/tracker" },
  { name: "analytics", path: "/analytics" },
  { name: "favorites", path: "/favorites" },
  { name: "assistant", path: "/assistant", fitsViewport: true },
  { name: "materials", path: "/materials" },
  { name: "knowledge", path: "/knowledge" },
  { name: "skills", path: "/skills" },
  { name: "interview", path: "/interview" },
  { name: "profile", path: "/profile" },
  { name: "claims", path: "/claims" },
  { name: "trash", path: "/trash" },
  { name: "drill", path: "/claims/drill" },
  { name: "settings", path: "/settings" },
] as const;

export interface ResponsiveMetrics {
  docOverflow: number;
  mainOverflow: number;
  /** 真丢了的内容（`overflow: hidden` 且祖链上没有任何 auto/scroll）。 */
  clipped: string[];
  /** 越界元素（排除 fixed 与 antd 门户）。 */
  outOfViewport: string[];
  /** 控件重叠（面积 > 4px² 且非父子）。 */
  overlaps: string[];
}

/**
 * 在页面里采集四个硬指标。
 *
 * 判定口径（方案 §7.4，写进脚本而不是靠人判）：
 *   overflow > 1 且祖链无 auto/scroll → P0（内容丢失）
 *   overflow > 1 且祖链有 auto/scroll → P1（能滚到，允许存在）
 * 所以 "clipped" 只看**真的到不了**的那些；表格横滚不算失败。
 */
export async function collectMetrics(
  page: import("@playwright/test").Page,
): Promise<ResponsiveMetrics> {
  return page.evaluate(() => {
    const isScrollable = (node: Element) => {
      const style = getComputedStyle(node);
      return style.overflowX === "auto" || style.overflowX === "scroll";
    };
    const hasScrollableAncestor = (node: Element) => {
      let current: Element | null = node.parentElement;
      while (current) {
        if (isScrollable(current)) return true;
        current = current.parentElement;
      }
      return false;
    };

    const clipped: string[] = [];
    const outOfViewport: string[] = [];
    const overlaps: string[] = [];

    const describe = (node: Element) => {
      const cls = typeof node.className === "string" ? node.className : "";
      return `${node.tagName.toLowerCase()}${cls ? `.${cls.trim().split(/\s+/).slice(0, 2).join(".")}` : ""}`;
    };

    // P0：文本容器被 hidden 裁掉，且祖链上没有任何可滚容器。
    // 不看"看不见的节点"：antd 的 Select 会为占位符留一个 `opacity: 0` 的测量节点，
    // 数据加载中的一帧里它比容器宽，会被误判成"文本被裁掉"（2026-10-23 实测）。
    for (const node of document.querySelectorAll<HTMLElement>("main *")) {
      if (node.scrollWidth <= node.clientWidth + 1) continue;
      const style = getComputedStyle(node);
      if (style.overflowX !== "hidden" && style.overflowX !== "clip") continue;
      if (style.visibility === "hidden" || style.opacity === "0") continue;
      // 刻意的单行省略（`ellipsis + nowrap`）不是"内容被裁"：列表标题、卡片标题都是这种形态。
      if (style.textOverflow === "ellipsis" && style.whiteSpace === "nowrap") continue;
      if (node.closest('[aria-hidden="true"]')) continue;
      if (hasScrollableAncestor(node)) continue;
      if (!node.textContent?.trim()) continue;
      // 表单控件不算：`<input>` 的 scrollWidth 永远 ≥ clientWidth（文本在框内滚动），
      // 那是输入框的固有行为，不是"内容被裁掉"。
      if (node.matches("input, textarea, select")) continue;
      clipped.push(describe(node));
    }

    // 越界元素：fixed 与 antd 门户不参与（它们相对视口定位，属于刻意浮层）。
    const portalSelector =
      ".ant-drawer, .ant-modal-root, .ant-tooltip, .ant-dropdown, .ant-popover";
    for (const node of document.querySelectorAll<HTMLElement>("main *")) {
      if (node.closest(portalSelector)) continue;
      if (getComputedStyle(node).position === "fixed") continue;
      // 在横向滚动容器里"超出视口"是设计好的（简历表 1494 宽、要横滚才能看全）：
      // 能滚到就不算越界，真正的"丢内容"由 R2 的 clipped 判。
      if (hasScrollableAncestor(node)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.right > window.innerWidth + 1 || rect.left < -1) {
        outOfViewport.push(describe(node));
      }
    }

    // 控件重叠：只比同一父容器下的兄弟控件，避免把"卡片盖住背景"当成重叠。
    const controls = [...document.querySelectorAll<HTMLElement>("main button, main a, main input")];
    for (let i = 0; i < controls.length; i += 1) {
      for (let j = i + 1; j < controls.length; j += 1) {
        const a = controls[i];
        const b = controls[j];
        if (a.contains(b) || b.contains(a)) continue;
        if (a.parentElement !== b.parentElement) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const width = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const height = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        // 两个方向都要真的压进去 > 2px 才算重叠：antd 的 compact 组（输入框 + 搜索按钮）
        // 有 1px 的接缝重合，按面积判会把它当成"控件重叠"，那是假阳性。
        if (width > 2 && height > 2 && width * height > 4) {
          overlaps.push(`${describe(a)} × ${describe(b)}`);
        }
      }
    }

    const main = document.querySelector("main") as HTMLElement | null;
    return {
      docOverflow: document.documentElement.scrollWidth - window.innerWidth,
      mainOverflow: main ? main.scrollWidth - main.clientWidth : 0,
      clipped: [...new Set(clipped)],
      outOfViewport: [...new Set(outOfViewport)].slice(0, 10),
      overlaps: [...new Set(overlaps)].slice(0, 10),
    };
  });
}

/** 只有双栏（≥1093）才判纵向"装得下"：≤1092 是单栏，整页滚动是设计内的（#1/#2）。 */
export const DESKTOP_VIEWPORTS = VIEWPORTS.filter((viewport) => viewport.width >= 1093);

export interface VerticalMetrics {
  /** `.app-content` 的纵向溢出（scrollHeight − clientHeight）。 */
  contentOverflow: number;
  /** 声明式 `overflow: scroll` 却装得下 = 那条"没东西可滚"的滚动条。 */
  emptyScrollbars: string[];
  /** `/assistant` 的消息区高度；其它路由为 null。 */
  assistantMessagesHeight: number | null;
}

/**
 * R4 的采集函数（#2）。
 *
 * 为什么单独一个函数而不是并进 `collectMetrics`：那一份只量横向，而 R4 要判的是
 * **纵向**——两者成因完全不同（横向是内容比容器宽，纵向是高度链路没闭合）。
 * 混在一起会让失败信息说不清是哪一类。
 */
export async function collectVertical(
  page: import("@playwright/test").Page,
): Promise<VerticalMetrics> {
  return page.evaluate(() => {
    const content = document.querySelector(".app-content") as HTMLElement | null;
    const emptyScrollbars: string[] = [];

    // R4-b：只找**显式**写死 `overflow-y: scroll`（auto/overlay 是"需要时才出现"，
    // 装得下时本来就不显示滚动条，不该判红）。
    for (const node of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const style = getComputedStyle(node);
      if (style.overflowY !== "scroll") continue;
      if (node === document.scrollingElement) continue;
      if (node.scrollHeight <= node.clientHeight + 1) {
        const id = node.id ? `#${node.id}` : "";
        const cls = node.className && typeof node.className === "string"
          ? `.${node.className.trim().split(/\s+/).slice(0, 2).join(".")}`
          : "";
        emptyScrollbars.push(`${node.tagName.toLowerCase()}${id}${cls}`);
      }
    }

    const messages = document.querySelector(".assistant-messages") as HTMLElement | null;
    return {
      contentOverflow: content ? content.scrollHeight - content.clientHeight : 0,
      emptyScrollbars: [...new Set(emptyScrollbars)].slice(0, 5),
      assistantMessagesHeight: messages ? Math.round(messages.clientHeight) : null,
    };
  });
}
