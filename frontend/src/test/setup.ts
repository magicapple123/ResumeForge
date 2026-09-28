import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// `findBy*` 的默认等待窗口只有 1 秒，而这些页面要挂载 antd 的整套组件、再等几个 mock 接口
// 依次 resolve；机器一忙就会在"还没渲染完"的时候超时，表现为随机失败（同一个文件里不同的用例
// 轮流失败）。
//
// 15 秒这个值是按**全量并行时的实测**定的，不是拍脑袋：vitest 默认按 CPU 数开线程（本机 32 核
// → 30 多个 jsdom 实例抢 CPU），重页面（设置页六张卡 + 消息列表）单个用例实测要 8~12 秒，
// 5 秒必然在满负载下随机超时——这正是"单跑全过、全量随机挂 3 个"的来源。
//
// 上限刻意**低于** vitest.config.ts 的 `testTimeout: 30000`：断言窗口和用例总预算取同一个值的话，
// 一次真正的"元素找不到"要等满 30 秒才报出来，失败的反馈速度会明显变差。
configure({ asyncUtilTimeout: 15000 });

const jsdomGetComputedStyle = window.getComputedStyle.bind(window);

// 只在测试里成立的 display 缺省值。判定依据是 HTML 的 UA 样式表对这几个标签的约定，
// 不是本项目自己的 CSS。
const INLINE_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "cite",
  "code",
  "data",
  "dfn",
  "em",
  "i",
  "kbd",
  "label",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
]);
const REPLACED_TAGS = new Set(["button", "input", "select", "textarea", "img", "svg", "iframe"]);
const NEVER_RENDERED_TAGS = new Set([
  "script",
  "style",
  "link",
  "meta",
  "title",
  "head",
  "template",
  "noscript",
]);

/**
 * 无障碍查询真正会读的只有 `display` 与 `visibility`，这里按内联样式快速回答，
 * 读不到就给一个符合 UA 样式的缺省值；其余属性返回 null 表示"照旧交给 jsdom"。
 */
function fastStyleProperty(element: Element, property: string): string | null {
  if (property !== "display" && property !== "visibility") return null;
  const inline = (element as HTMLElement).style?.getPropertyValue(property);
  if (inline) return inline;
  if (property === "visibility") return "visible";
  const tag = element.tagName.toLowerCase();
  if (NEVER_RENDERED_TAGS.has(tag)) return "none";
  if (INLINE_TAGS.has(tag)) return "inline";
  if (REPLACED_TAGS.has(tag)) return "inline-block";
  return "block";
}

// jsdom 的 getComputedStyle 会把文档里每个样式表的规则跑一遍级联匹配，而 antd 的 CSS-in-JS
// 给每个页面注入三四十张样式表、上千条规则；@testing-library 的 `getByRole` 要对**每个候选
// 元素**问一次 display / visibility（`isInaccessible` 还要沿祖先链逐级问），于是"挂载之后
// 第一次按角色查找"实测要 2.6 秒，同一批元素第二次只要 13 毫秒——那 2.6 秒全部花在级联上。
//
// 后果落在重页面（设置页、我的资料）上：单个用例光查询就吃掉十几秒，30 秒的用例预算在 CI 上
// 直接不够用（2026-09-28 CI 上「编辑态可以修改自定义字段名并保留原值」就是等满 30 秒超时的）。
//
// 测试不校验视觉，所以这里让 `display` / `visibility` 走内联样式 + UA 缺省值，绕过级联；
// 代理转发其余一切取法，`toHaveStyle` 之类仍然拿得到 jsdom 的真实值。已知代价：**只由样式表**
// 设置的 `display: none` 不再被 `getByRole` 当成隐藏，而本项目没有依赖它的用例。
Object.defineProperty(window, "getComputedStyle", {
  configurable: true,
  value: (element: Element, pseudoElement?: string | null) => {
    // ::before / ::after 的内容由样式表决定，没法用缺省值代替。
    if (pseudoElement) return jsdomGetComputedStyle(element, pseudoElement);
    // 惰性：只有真要读别的属性时才去调 jsdom（那一次调用才是贵的）。
    let real: CSSStyleDeclaration | null = null;
    const realStyle = () => (real ??= jsdomGetComputedStyle(element));
    return new Proxy({} as CSSStyleDeclaration, {
      get(_target, property) {
        if (typeof property === "string") {
          const fast = fastStyleProperty(element, property);
          if (fast !== null) return fast;
          if (property === "getPropertyValue") {
            return (name: string) =>
              fastStyleProperty(element, name) ?? realStyle().getPropertyValue(name);
          }
        }
        const value = Reflect.get(realStyle(), property, real);
        return typeof value === "function" ? value.bind(real) : value;
      },
    });
  },
});

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(window, "ResizeObserver", {
  configurable: true,
  value: ResizeObserverMock,
});

// jsdom 没有实现对象 URL，而下载与打印都依赖它。
Object.defineProperty(URL, "createObjectURL", {
  configurable: true,
  writable: true,
  value: () => "blob:jsdom-object-url",
});

Object.defineProperty(URL, "revokeObjectURL", {
  configurable: true,
  writable: true,
  value: () => undefined,
});

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});
