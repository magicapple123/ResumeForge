// SPDX-License-Identifier: Apache-2.0
/**
 * MarkdownBlock：块级 Markdown 子集的渲染与安全边界。
 *
 * 这一组用例守两件事：
 * 1. 模型输出里的 `**` / `-` / `1.` / `###` / 管道表格真的成型，而不是原样裸露
 *    （面试页曾经直接插值，用户看到的就是一堆星号和短横线）；
 * 2. **安全**：解析结果是 React 节点，`<script>` 与 `javascript:` 都不许被当成可执行内容。
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import MarkdownBlock from "./MarkdownBlock";

function renderBlock(content: string) {
  return render(<MarkdownBlock content={content} />).container;
}

afterEach(cleanup);

describe("MarkdownBlock 的块级渲染", () => {
  it("把 **粗体** 渲染成 strong，页面上不留星号", () => {
    const container = renderBlock("结论是 **cost 数据没有出处**。");
    expect(container.querySelectorAll("strong")).toHaveLength(1);
    expect(container.querySelector("strong")?.textContent).toBe("cost 数据没有出处");
    expect(container.textContent).not.toContain("**");
  });

  it("有序与无序列表各自成型，并带项目符号", () => {
    const container = renderBlock("1. 第一条\n2. 第二条\n- 无序项");
    const items = container.querySelectorAll(".assistant-markdown-list-item");
    expect(items).toHaveLength(3);
    // 标记在 aria-hidden 的 span 里：视觉上有缩进层级，读屏不会重复念编号。
    expect(items[0].querySelector("span")?.textContent).toBe("1.");
    expect(items[2].querySelector("span")?.textContent).toBe("•");
    expect(items[2].textContent).toContain("无序项");
  });

  it("### 标题渲染成 h4 层级标题", () => {
    const container = renderBlock("### 核心结论");
    expect(container.querySelector("h4")?.textContent).toBe("核心结论");
  });

  it("管道表格渲染成真正的 table", () => {
    const container = renderBlock("| 阶段 | 建议 |\n| --- | --- |\n| 网申 | 关注官网 |");
    expect(container.querySelectorAll("table")).toHaveLength(1);
    expect(container.querySelectorAll("th")).toHaveLength(2);
    expect(container.querySelectorAll("td")).toHaveLength(2);
    expect(container.querySelector("tbody")?.textContent).toContain("关注官网");
  });

  it("行内代码与链接可点，外链带 noopener noreferrer", () => {
    const container = renderBlock("看 `npm ci` 与 [官方文档](https://example.com/docs)");
    expect(container.querySelector("code")?.textContent).toBe("npm ci");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/docs");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("段落之间由空行分隔，不会挤成一段", () => {
    const container = renderBlock("第一段\n\n第二段");
    expect(container.querySelectorAll("p")).toHaveLength(2);
    // 空行单独成为一个 spacer，而不是被塞进段落里（否则行距会翻倍）。
    expect(container.querySelectorAll(".assistant-markdown-spacer")).toHaveLength(1);
  });
});

describe("MarkdownBlock 的安全边界", () => {
  it("<script> 与内联事件不会被当成 HTML 执行", () => {
    const container = renderBlock('<script>alert("xss")</script><img src=x onerror="alert(1)">');
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    // 原样当文本画出来：用户看得见它是什么，但它什么都不做。
    expect(container.textContent).toContain("<script>");
  });

  it("javascript: 链接退化成纯文本，不产生可点的 a", () => {
    const container = renderBlock("[点我](javascript:alert(1))");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("javascript:alert(1)");
  });
});
