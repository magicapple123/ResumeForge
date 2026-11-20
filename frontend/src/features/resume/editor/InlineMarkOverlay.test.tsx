// SPDX-License-Identifier: Apache-2.0
/**
 * 行内标记遮罩层（I-26）：**渲染层与文本域的接线**。
 *
 * 这一层测的不是"解析对不对"（那是 `inlineMarkRuns.test.ts` 与后端 fixture 的事），
 * 而是四条只有渲染层才会错的性质：
 *
 * 1. 遮罩层 `aria-hidden`，且**覆盖整串**（标记也要占位，否则两层错位）；
 * 2. 两层**共用** `.rf-inline-mark-layer` 这个字体度量类——它一旦只落在一层上，
 *    光标就会落在两个字的缝隙里，而任何文本断言都看不出来；
 * 3. 文本域的 value **一个字都不改**（受控值仍是含标记的源串）：行内格式的写回链路按
 *    源串偏移工作，这里若换成可见文本，那条链路会在错误坐标系里加标记；
 * 4. 输入法组合期给容器加 `is-composing`（预编辑串只画在文本域上，必须显形）；
 * 5. **只画四样**：文字 / 隐藏段 / 选区 / 链接下划线（T01：字号、字重、颜色一律不画）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { fieldItem, makeDocument, textItem } from "../document/documentFixtures";
import InlineMarkOverlay from "./InlineMarkOverlay";
import InlineMarkTextArea from "./InlineMarkTextArea";
import ItemEditor from "./ItemEditor";
import AutoGrowValueTextArea from "./AutoGrowValueTextArea";
import { FieldValueEditor } from "./itemValueEditors";

declare const process: { cwd(): string };

function readInlineMarkCss(): string {
  return readFileSync(
    [process.cwd(), "src", "styles", "inline-mark-overlay.css"].join("/"),
    "utf8",
  );
}

/** 只认"字色"声明：`caret-color: transparent` 不算（它前面是连字符，不是 `;` 或行首）。 */
const OPAQUE_TEXT_RE = /(?:^|;)\s*color:\s*transparent/;

/** 把一份扁平 CSS 拆成 选择器 / 声明体；注释先剥掉，避免注释里的示例被当成规则。 */
function cssRules(source: string): { selector: string; body: string }[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return stripped
    .split("}")
    .map((chunk) => chunk.split("{"))
    .filter((parts) => parts.length >= 2)
    .map(([selector, body]) => ({
      selector: selector.trim().replace(/\s+/g, " "),
      body: body.trim(),
    }));
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderOverlay(value: string): HTMLElement {
  const { container } = render(<InlineMarkOverlay value={value} />);
  const overlay = container.querySelector(".rf-inline-mark-overlay");
  if (!overlay) throw new Error("overlay not rendered");
  return overlay as HTMLElement;
}

describe("InlineMarkOverlay", () => {
  it("遮罩层对读屏隐藏，文本域仍是唯一可访问控件", () => {
    const overlay = renderOverlay("a**b**c");
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    expect(overlay.getAttribute("role")).toBeNull();
    // 遮罩层不接管指针事件（选区、点击、拖高手柄都留给文本域）。
    expect(overlay.className).toContain("rf-inline-mark-overlay");
  });

  it("镜像覆盖整串：标记段也在，只是不可见", () => {
    const overlay = renderOverlay("a**b**c");
    // 末尾那个换行是给"结尾空行"占位的，两层滚动高度对齐靠它。
    expect(overlay.textContent).toBe("a**b**c\n");
    const hidden = Array.from(overlay.querySelectorAll(".rf-inline-mark-hidden")).map(
      (node) => node.textContent,
    );
    expect(hidden).toEqual(["**", "**"]);
    // 标记段没有任何样式类，避免被误当成可见文字。
    for (const node of overlay.querySelectorAll(".rf-inline-mark-hidden")) {
      expect(node.className).not.toContain("rf-inline-mark-bold");
    }
  });

  /**
   * T01 改写：遮罩层**永不**画字号 / 颜色 / 字重。
   *
   * 旧实现如实画（font-size: 150% + color + 描边加粗），代价是"编辑时字突然变大变色"，
   * 而且 `font-size` 改前进宽度 → 与文本域逐字错位。真实样式的预览改由
   * `InlineMarkStatic`（开关打开 + 失焦 + 有格式）承担，两种渲染永不同框。
   */
  it("遮罩层不画字号/颜色/字重：带样式的区间与普通区间渲染完全一致", () => {
    const overlay = renderOverlay("x{@size=1.5,color=#2f6fd0}y{@}");
    const segments = Array.from(
      overlay.querySelectorAll(".rf-inline-mark-segment"),
    ) as HTMLElement[];
    const styled = segments.find((node) => node.textContent === "y");
    const plain = segments.find((node) => node.textContent === "x");
    expect(styled).toBeTruthy();
    expect(plain).toBeTruthy();
    expect(styled?.style.fontSize).toBe("");
    expect(styled?.style.color).toBe("");
    expect(plain?.style.fontSize).toBe("");
    expect(plain?.style.color).toBe("");
    // 整层都不许出现改变字宽的类。
    expect(overlay.querySelector(".rf-inline-mark-bold")).toBeNull();
  });

  it("加粗不再走类；链接下划线保留（不改字宽，且是唯一的链接提示）", () => {
    const overlay = renderOverlay("**bold** [label](https://example.com)");
    expect(overlay.querySelector(".rf-inline-mark-bold")).toBeNull();
    const boldSegment = Array.from(overlay.querySelectorAll(".rf-inline-mark-segment")).find(
      (node) => node.textContent === "bold",
    ) as HTMLElement | undefined;
    expect(boldSegment?.style.fontWeight).toBe("");
    expect(overlay.querySelector(".rf-inline-mark-link")?.textContent).toBe("label");
  });

  it("滚动同步用 transform，遮罩层自身不滚", () => {
    const { container } = render(
      <InlineMarkOverlay value={"**a**"} scrollTop={12} scrollLeft={3} />,
    );
    const mirror = container.querySelector(".rf-inline-mark-mirror") as HTMLElement;
    expect(mirror.style.transform).toBe("translate(-3px, -12px)");
  });

  it("与文本域共用字体度量类（错位的唯一防线）", () => {
    const { container } = render(<InlineMarkOverlay value={"**a**"} />);
    const mirror = container.querySelector(".rf-inline-mark-mirror");
    expect(mirror?.className).toContain("rf-inline-mark-layer");
  });
});

function Harness({ initial, onChange }: { initial: string; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <AntdApp>
      <AutoGrowValueTextArea
        ariaLabel="summary"
        value={value}
        onChange={(next) => {
          onChange?.(next);
          setValue(next);
        }}
      />
    </AntdApp>
  );
}

describe("AutoGrowValueTextArea · 行内标记接入", () => {
  it("值里有标记时渲染遮罩层，但文本域的值仍是原始源串", () => {
    const raw = "x{@size=1.2}y{@}**z**";
    render(<Harness initial={raw} />);
    const textarea = screen.getByRole("textbox", { name: "summary" }) as HTMLTextAreaElement;
    expect(textarea.value).toBe(raw);
    expect(textarea.className).toContain("rf-inline-mark-layer");
    const overlay = document.querySelector(".rf-inline-mark-overlay");
    expect(overlay).toBeTruthy();
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    // 容器是真实布局容器（不是 `display: contents`），否则遮罩层没有定位上下文。
    expect(
      (document.querySelector(".rf-inline-mark-field") as HTMLElement).className,
    ).not.toContain("is-plain");
  });

  it("没有标记时不渲染第二层，且容器不参与布局（DOM 稳、排版零变化）", () => {
    render(<Harness initial="plain value" />);
    expect(document.querySelector(".rf-inline-mark-overlay")).toBeNull();
    const field = document.querySelector(".rf-inline-mark-field") as HTMLElement;
    expect(field.className).toContain("is-plain");
    const textarea = screen.getByRole("textbox", { name: "summary" }) as HTMLTextAreaElement;
    expect(textarea.className).toContain("rf-inline-mark-layer");
  });

  it("onChange 契约不变：回传的是含标记的原始字符串", () => {
    const seen: string[] = [];
    render(<Harness initial="ab" onChange={(next) => seen.push(next)} />);
    const textarea = screen.getByRole("textbox", { name: "summary" }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "a**b**" } });
    expect(seen).toEqual(["a**b**"]);
    expect(textarea.value).toBe("a**b**");
  });

  it("输入法组合期把容器标成 is-composing（预编辑串要显形）", () => {
    render(<Harness initial="**a**" />);
    const textarea = screen.getByRole("textbox", { name: "summary" }) as HTMLTextAreaElement;
    const field = document.querySelector(".rf-inline-mark-field") as HTMLElement;
    fireEvent.compositionStart(textarea);
    expect(field.className).toContain("is-composing");
    fireEvent.compositionEnd(textarea);
    expect(field.className).not.toContain("is-composing");
  });

  it("单行语义不回退：Enter 仍被拦掉", () => {
    render(<Harness initial={"**a**"} />);
    const textarea = screen.getByRole("textbox", { name: "summary" }) as HTMLTextAreaElement;
    const notPrevented = fireEvent.keyDown(textarea, { key: "Enter" });
    expect(notPrevented).toBe(false);
  });
});

/**
 * 验收①（"输入框内看不到任何 `{@` 或 `**`"）依赖**三处入口都接上遮罩层**：
 * 单行字段值、字段正文（`placement === "body"`）、条目正文。少接任何一处，
 * 那条简历里就有一段字会露出标记语法，而测试只看单行那一处是发现不了的。
 */
describe("三处入口都渲染遮罩层", () => {
  const RAW = "x{@size=1.2}y{@}**z** [l](https://example.com)";

  /** 三处共用的断言：遮罩层在、对读屏隐藏、文本域的值仍是源串。 */
  function expectDecorated(): HTMLTextAreaElement {
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe(RAW);
    expect(textarea.className).toContain("rf-inline-mark-layer");
    const overlay = document.querySelector(".rf-inline-mark-overlay");
    expect(overlay).toBeTruthy();
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    // 遮罩层覆盖整串（含标记占位），所以下层的字形位置与文本域逐个对应。
    expect(overlay?.textContent).toBe(`${RAW}\n`);
    return textarea;
  }

  it("单行字段值（AutoGrowValueTextArea）", () => {
    render(
      <AntdApp>
        <AutoGrowValueTextArea ariaLabel="value" value={RAW} onChange={() => undefined} />
      </AntdApp>,
    );
    const textarea = expectDecorated();
    // I-14：单行语义保留（拦 Enter 见下），但高度改由 autoSize 驱动——
    // rc-textarea 在 autoSize 下强制 `resize: none`，可拖手柄必须消失。
    expect(textarea.style.resize).toBe("none");
    expect(textarea.className).toContain("rf-value-textarea");
  });

  it("壳本身：autoSize 模式不设 resize（自动长高与可拖手柄互斥）", () => {
    render(
      <AntdApp>
        <InlineMarkTextArea
          ariaLabel="value"
          value={RAW}
          autoSize={{ minRows: 2, maxRows: 8 }}
          onChange={() => undefined}
        />
      </AntdApp>,
    );
    const textarea = expectDecorated();
    // rc-textarea 开了 autoSize 就把 resize 强制成 none（所以"自动长高"与"可拖手柄"互斥）。
    expect(textarea.style.resize).toBe("none");
    // 多行正文照常允许换行：Enter 不被拦。
    expect(fireEvent.keyDown(textarea, { key: "Enter" })).toBe(true);
  });

  it("字段正文（FieldValueEditor，placement=body 的 autoSize 分支）", () => {
    render(
      <AntdApp>
        <FieldValueEditor
          item={fieldItem({ placement: "body", value: RAW })}
          sectionKey="education"
          onChange={() => undefined}
        />
      </AntdApp>,
    );
    // I-13：字段正文走结构化读——文本域里是**纯文本**，标记在读取时已经换算成 runs。
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("xyz l");
    expect(textarea.value).not.toContain("{@");
    expect(textarea.value).not.toContain("**");
    expect(textarea.className).toContain("rf-inline-mark-layer");
    const overlay = document.querySelector(".rf-inline-mark-overlay");
    expect(overlay).toBeTruthy();
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    // 纯文本没有隐藏段：遮罩层逐字等于文本域里的值。
    expect(overlay?.textContent).toBe("xyz l\n");
  });

  it("条目正文（ItemEditor，kind=text 的 autoSize 分支）", () => {
    render(
      <AntdApp>
        <ItemEditor
          document={makeDocument()}
          path="sections.0.entries.0.items.0"
          item={textItem({ text: RAW })}
          sectionKey="education"
          onChange={() => undefined}
        />
      </AntdApp>,
    );
    // I-12：文本块与字段同一条结构化读路径（后端 `TextItem.rich` 已补齐），
    // 文本域里是纯文本，标记在读取时已经换算成 runs。
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("xyz l");
    expect(textarea.value).not.toContain("{@");
    expect(textarea.value).not.toContain("**");
    expect(document.querySelector(".rf-inline-mark-overlay")?.textContent).toBe("xyz l\n");
  });
});

/**
 * P0 回归守卫（2026-11，`81bfd19f` 之后）：**"文字透明"必须由遮罩层是否挂载单方面决定**。
 *
 * 回归现象：普通值（不含 `*` / `[` / `{@`）在值输入框里一片空白——值没丢，只是上层文本域
 * 无条件 `color: transparent`，而下层遮罩层只在含标记时挂载，于是"上层透明 + 下层不存在"。
 *
 * 这里钉两条只有渲染层 + 样式合起来才成立的性质：
 * 1. DOM：`is-masked` 跟着 `decorated` 走（普通值**不得**带它）；
 * 2. CSS：`color: transparent` 只允许出现在带 `.is-masked` 的规则里，且 `::selection`
 *    的透明必须与它同进同出（只搬一半会让普通字段选中文字消失）。
 *
 * jsdom 没有布局、也不解析外部 CSS，所以第 2 条只能读原文——见
 * `workbenchLayoutContract.test.ts` 里同样的取舍说明。
 */
describe("普通值的字必须可见（P0 回归守卫）", () => {
  it("不含标记的值：文本域不带 is-masked（否则字全透明、且没有下层可画）", () => {
    render(<Harness initial="普通的值，没有任何标记" />);
    const textarea = screen.getByRole("textbox", { name: "summary" }) as HTMLTextAreaElement;
    expect(textarea.className).not.toContain("is-masked");
    // 下层确实不存在——这正是"必须靠上层自己可见"的原因。
    expect(document.querySelector(".rf-inline-mark-overlay")).toBeNull();
  });

  it("含标记的值：文本域带 is-masked（字形交给下层，光标仍由上层画）", () => {
    render(<Harness initial="**a**" />);
    const textarea = screen.getByRole("textbox", { name: "summary" }) as HTMLTextAreaElement;
    expect(textarea.className).toContain("is-masked");
    expect(document.querySelector(".rf-inline-mark-overlay")).toBeTruthy();
  });

  it("CSS：基础规则不含 color: transparent，透明只出现在 .is-masked 下", () => {
    const rules = cssRules(readInlineMarkCss());
    const textTransparent = rules.filter((rule) => OPAQUE_TEXT_RE.test(rule.body));
    expect(textTransparent.length).toBeGreaterThan(0);
    for (const rule of textTransparent) {
      // 每一条都必须挂在 .is-masked 上：写进基础规则 = 普通值立刻变空白。
      expect(rule.selector, `这条规则让字形透明却没有 is-masked 开关：${rule.selector}`).toContain(
        "is-masked",
      );
    }
    // 反向：`.is-masked` 那条**必须**还在，否则含标记的值会露 `**` 与 `{@`。
    expect(
      rules.some(
        (rule) =>
          rule.selector.includes("rf-inline-mark-layer") &&
          rule.selector.includes("is-masked") &&
          !rule.selector.includes("::selection") &&
          OPAQUE_TEXT_RE.test(rule.body),
      ),
      "没有找到 .is-masked 的 color: transparent 规则",
    ).toBe(true);
  });

  it("CSS：选区底色交给遮罩层自绘，文本域那层只保留透明（DF-4）", () => {
    const rules = cssRules(readInlineMarkCss());
    const masked = rules.filter(
      (rule) =>
        rule.selector.includes("::selection") &&
        rule.selector.includes("rf-inline-mark-layer") &&
        rule.selector.includes("is-masked") &&
        !rule.selector.includes("is-composing"),
    );
    expect(masked.length).toBeGreaterThan(0);
    for (const rule of masked) {
      // 源串选区会把 `{@color=…}` 那 20 个隐形字符也染上 → 一条没有文字的空蓝带。
      // 底色因此必须由遮罩层按可见文字自绘，文本域这一层不许再有底色。
      expect(rule.body).toContain("background: transparent");
      expect(rule.body).toContain("color: transparent");
      expect(rule.body).not.toContain("color-mix");
    }
    // 自绘高亮仍然半透明（不透明会把下层文字盖住）。
    const highlight = rules.find((rule) => rule.selector.includes(".rf-inline-mark-selection"));
    expect(highlight?.body).toContain("color-mix");
    // 组合期遮罩层让位，选区反馈必须交回文本域。
    const composing = rules.find(
      (rule) => rule.selector.includes("is-composing") && rule.selector.includes("::selection"),
    );
    expect(composing?.body).toContain("color-mix");
  });
});

describe("DF-4 · 遮罩层自绘选区", () => {
  it("高亮只覆盖可见文字，隐形标记不进高亮", () => {
    const raw = "a{@color=#c0392b}个人项目{@}b";
    const { container } = render(
      <InlineMarkOverlay value={raw} selection={{ start: 0, end: 6 }} />,
    );
    const marks = [...container.querySelectorAll(".rf-inline-mark-selection")];
    const highlighted = marks.map((node) => node.textContent).join("");
    expect(highlighted).toBe("a个人项目b");
    expect(highlighted).not.toContain("{@");
  });

  it("选区只覆盖可见文字的一部分时按字符切开", () => {
    const raw = "{@size=0.9}重点{@}说明";
    const { container } = render(
      <InlineMarkOverlay value={raw} selection={{ start: 0, end: 2 }} />,
    );
    expect(
      [...container.querySelectorAll(".rf-inline-mark-selection")].map((n) => n.textContent),
    ).toEqual(["重点"]);
  });
});
