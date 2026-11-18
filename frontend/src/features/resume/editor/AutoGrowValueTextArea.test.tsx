// SPDX-License-Identifier: Apache-2.0
/**
 * I-14 的结构守卫：值输入框必须"按内容自适应（1–4 行）"。
 *
 * jsdom 没有布局，量不到真实高度（1 行 vs 4 行的像素、超过 4 行才出现的滚动条），
 * 所以这里钉的是**可断言的结构**：
 * - 传给壳的 `autoSize` 边界（minRows 1 / maxRows 4），且 `rows` / `resizable` 都不再传；
 * - `.rf-value-textarea` 的 CSS 仍保留 min-height / max-height，且不再声明 `resize`。
 *
 * 真实高度与"刚好 3 行 / 刚好 4 行"的临界换行必须在浏览器里看，见
 * `deliverables/execution/evidence/I-14/verify.md`（本文件不声称测过像素）。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AutoGrowValueTextArea from "./AutoGrowValueTextArea";

declare const process: { cwd(): string };

const seen = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("./InlineMarkTextArea", () => ({
  default: (props: Record<string, unknown>) => {
    seen.push(props);
    return null;
  },
}));

afterEach(() => {
  cleanup();
  seen.length = 0;
});

function lastProps(): Record<string, unknown> {
  return seen[seen.length - 1] ?? {};
}

describe("AutoGrowValueTextArea · 高度契约", () => {
  it("autoSize 1–4 行；不再传 rows / resizable，仍挂 rf-value-textarea 并拦 Enter", () => {
    render(<AutoGrowValueTextArea value="全日制" ariaLabel="value" onChange={() => undefined} />);
    const props = lastProps();
    expect(props.autoSize).toEqual({ minRows: 1, maxRows: 4 });
    expect(props.rows).toBeUndefined();
    expect(props.resizable).toBeUndefined();
    expect(props.className).toBe("rf-value-textarea");
    expect(props.size).toBe("small");
    expect(props.blockEnter).toBe(true);
  });

  it("值 / 无障碍名 / 结构化写回原样透传：改高度不许动数据契约", () => {
    const rich = { runs: [], onChange: () => undefined };
    const onChange = () => undefined;
    render(
      <AutoGrowValueTextArea value="8/126" ariaLabel="value" rich={rich} onChange={onChange} />,
    );
    const props = lastProps();
    expect(props.value).toBe("8/126");
    expect(props.ariaLabel).toBe("value");
    expect(props.rich).toBe(rich);
    expect(props.onChange).toBe(onChange);
  });
});

describe("CSS 契约（jsdom 不解析外部样式，只能读原文）", () => {
  const css = readFileSync(
    [process.cwd(), "src", "features", "resume", "editor", "auto-grow-value-textarea.css"].join(
      "/",
    ),
    "utf8",
  );

  it("保留 30px 下限与 40vh 上限（窄视口兜底）", () => {
    expect(css).toContain("min-height: 30px");
    expect(css).toContain("max-height: 40vh");
  });

  it("不再声明 resize：autoSize 下 rc-textarea 强制 none，写了只会误导", () => {
    // 注释里可以提 `resize`（解释为什么删掉），只钉"没有这条声明"。
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/resize\s*:/);
  });
});
