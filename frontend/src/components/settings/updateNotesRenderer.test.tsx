// SPDX-License-Identifier: Apache-2.0
/** 更新说明渲染器（markdown 子集）单测：新增语法覆盖 + 链接协议白名单。
 *
 * 为什么单独一个文件、而不是继续往 UpdateCard.test.tsx 里加：那个文件已经 429 行，
 * 工程约束是单文件 ≤500 行；而渲染器本身是纯函数，直接测比经 antd 卡片挂载既快又准。
 * 卡片侧的回归（`##` / `- ` / `**`）仍留在 UpdateCard.test.tsx 里，两处都在跑。
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderReleaseNotes } from "./updateNotesRenderer";

/** 渲染一段说明并返回容器；断言只看结构与 textContent，不依赖样式。 */
function renderNotes(notes: string): HTMLElement {
  const { container } = render(<div>{renderReleaseNotes(notes)}</div>);
  return container;
}

describe("renderReleaseNotes：新增语法", () => {
  it("`# 一级标题` 变成五号标题，井号不再出现在界面上", () => {
    // 线上 v2.0.0 公告首行就是 `# ResumeForge 2.0.0`，此前原样显示井号。
    const container = renderNotes("# ResumeForge 2.0.0\n\n正文");

    expect(container.querySelector("h5")?.textContent).toBe("ResumeForge 2.0.0");
    expect(container.textContent ?? "").not.toContain("#");
  });

  it("表格渲染成 <table>：首行进 thead、数据行进 tbody，管道符与分隔行都不显示", () => {
    const container = renderNotes(
      [
        "| 你的情况 | 建议 |",
        "| --- | --- |",
        "| 1.x 用户 | 直接升级 |",
        "| 全新安装 | 下载安装包 |",
      ].join("\n"),
    );

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll("thead th")).toHaveLength(2);
    expect(table?.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(table?.textContent).toContain("直接升级");
    // 原始符号不该漏到界面上。
    expect(container.textContent ?? "").not.toContain("|");
    expect(container.textContent ?? "").not.toContain("---");
  });

  it("表格列数不齐时按最多列补空单元格", () => {
    // 手写公告很容易少写一根竖线；补齐比让浏览器自己乱排要稳。
    const container = renderNotes(["| A | B |", "| --- | --- |", "| 只有一个 |"].join("\n"));

    const cells = container.querySelectorAll("tbody tr td");
    expect(cells).toHaveLength(2);
    expect(cells[0].textContent).toBe("只有一个");
    expect(cells[1].textContent).toBe("");
  });

  it("表格单元格里的 `**粗体**` 与行内代码继续被渲染", () => {
    const container = renderNotes(
      ["| 项 | 说明 |", "| --- | --- |", "| **包** | 见 `docs` |"].join("\n"),
    );

    expect(container.querySelector("td strong")?.textContent).toBe("包");
    expect(container.querySelector("td code")?.textContent).toBe("docs");
  });

  it("`---` / `***` 单独一行变成 <hr>", () => {
    const container = renderNotes("上文\n\n---\n\n中间\n\n***\n\n下文");

    expect(container.querySelectorAll("hr")).toHaveLength(2);
    expect(container.textContent ?? "").not.toContain("---");
    expect(container.textContent ?? "").not.toContain("***");
  });

  it("行内代码变成 <code>，反引号不再显示", () => {
    const container = renderNotes("支持 `C++` 与 `legacy-archive/2026/files/` 两个位置");

    const codes = container.querySelectorAll("code");
    expect(codes).toHaveLength(2);
    expect(codes[0].textContent).toBe("C++");
    expect(codes[1].textContent).toBe("legacy-archive/2026/files/");
    expect(container.textContent ?? "").not.toContain("`");
  });

  it("`[文字](https://…)` 变成新窗口打开的链接", () => {
    const container = renderNotes("升级前请读 [升级说明](https://example.com/docs/upgrading)");

    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute("href", "https://example.com/docs/upgrading");
    expect(link).toHaveAttribute("target", "_blank");
    // target=_blank 必须配 noopener（防 window.opener 反向控制）+ noreferrer。
    expect(link?.getAttribute("rel")).toContain("noopener");
    expect(link?.getAttribute("rel")).toContain("noreferrer");
    expect(container.textContent ?? "").not.toContain("](");
  });

  it("`* ` 与 `- ` 同等，`1. ` 变成有序列表", () => {
    const container = renderNotes("* 甲\n* 乙\n\n1. 第一\n2. 第二");

    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.textContent ?? "").not.toContain("* ");
    expect(container.textContent ?? "").not.toContain("1.");
  });
});

describe("renderReleaseNotes：链接安全", () => {
  it("非 http/https 的链接只渲染 link text，不产生 <a>，URL 连字符都不进 DOM", () => {
    // 公告正文来自 GitHub，但仍按不可信输入处理：只放行 http/https。
    const container = renderNotes(
      [
        "[点我](javascript:alert(1))",
        "[点我](javascript:alert)",
        "[点我](data:text/html,abc)",
      ].join("\n\n"),
    );

    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("[href]")).toBeNull();
    // 只留文字：既没有裸露的方括号/圆括号，也没有 javascript: 字样落到页面上。
    expect(container.textContent ?? "").toContain("点我");
    expect(container.textContent ?? "").not.toContain("[");
    expect(container.textContent ?? "").not.toContain("](");
    expect(container.textContent ?? "").not.toContain("javascript:");
    expect(container.textContent ?? "").not.toContain("data:text");
  });

  it("相对路径链接（真实 v2.0.0 的 docs/upgrading.md）只显示路径文字", () => {
    // 用户实测那句：「完整步骤见 [docs/upgrading.md](docs/upgrading.md)。」
    // 地址不是 http/https，做不成链接，但也不该把 markdown 原文照抄给用户看。
    const container = renderNotes("完整步骤见 [docs/x.md](docs/x.md)。");

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent ?? "").toContain("docs/x.md");
    expect(container.textContent ?? "").not.toContain("[");
    expect(container.textContent ?? "").not.toContain("](");
    expect(container.textContent ?? "").toBe("完整步骤见 docs/x.md。");
  });

  it("合法的 http/https 之外，驼峰写法的 HTTPS 也认（协议大小写不敏感）", () => {
    const container = renderNotes("[发布页](HTTPS://example.com/releases)");

    expect(container.querySelector("a")).toHaveAttribute("href", "HTTPS://example.com/releases");
  });
});

describe("renderReleaseNotes：原有语法回归", () => {
  it("`##` / `- ` / `**` 三条老断言仍然成立", () => {
    const container = renderNotes("## 新增\n- **深挖** 模式支持从台账直出报告\n\n修复问题");

    expect(container.querySelector("h5")?.textContent).toBe("新增");
    expect(container.querySelector("li strong")?.textContent).toBe("深挖");
    expect(container.textContent).toContain("修复问题");
    expect(container.textContent ?? "").not.toContain("##");
    expect(container.textContent ?? "").not.toContain("**");
  });
});
