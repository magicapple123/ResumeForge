// SPDX-License-Identifier: Apache-2.0
/** 双语字段对照（v2 item 路径）：差异行、事实锁/只读字段不可采纳、全一致空态、未翻译提示。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bt } from "../../../features/resume-bilingual/i18n";
import {
  buildBilingualPairs,
  defaultPairLabels,
} from "../../../features/resume-bilingual/fieldPairs";
import { MOCK_PRIMARY } from "../../../test/bilingualMock";
import type { ResumeDocument } from "../../../types/resumeDocument";
import BilingualCompareView from "./BilingualCompareView";

const LABELS = defaultPairLabels();

function translated(): ResumeDocument {
  const next = structuredClone(MOCK_PRIMARY);
  const experience = next.sections.find((section) => section.key === "experience");
  const entry = experience?.entries[0];
  const text = entry?.items.find((item) => item.kind === "text");
  if (text && text.kind === "text") text.text = "Halved API latency worldwide.";
  const role = entry?.items.find((item) => item.kind === "field" && item.key === "role");
  if (role && role.kind === "field") role.value = "Backend Engineer (Remote)";
  const summary = next.sections.find((section) => section.key === "summary");
  const summaryText = summary?.entries[0]?.items.find((item) => item.kind === "text");
  if (summaryText && summaryText.kind === "text") summaryText.text = "English summary.";
  return next;
}

/** 带一个列表字段的文档：列表只读展示（不参与逐项采纳）。 */
function withList(): ResumeDocument {
  const next = structuredClone(MOCK_PRIMARY);
  const education = next.sections.find((section) => section.key === "education");
  education?.entries[0]?.items.push({
    kind: "list",
    id: "mock_edu_courses",
    key: "courses",
    label: "",
    values: ["Data Structures", "Algorithms"],
    placement: "lead",
    join: "semicolon",
    show_label: true,
    solo: false,
    body_style: "bullet",
  });
  return next;
}

afterEach(() => cleanup());

describe("BilingualCompareView", () => {
  it("按分组渲染两侧文本（v2 item 路径）", () => {
    render(
      <AntdApp>
        <BilingualCompareView pairs={buildBilingualPairs(MOCK_PRIMARY, translated(), LABELS)} />
      </AntdApp>,
    );
    // 分组标题来自板块 key/标题解析器；字段标签来自 item key。
    expect(screen.getAllByText("experience").length).toBeGreaterThan(0);
    expect(screen.getByText("Ten years on high concurrency trading systems.")).toBeTruthy();
    expect(screen.getByText("English summary.")).toBeTruthy();
  });

  it("有差异且未被锁定的行可采纳；事实锁行没有采纳按钮", () => {
    const onAdopt = vi.fn();
    const pairs = buildBilingualPairs(MOCK_PRIMARY, translated(), LABELS);
    render(
      <AntdApp>
        <BilingualCompareView pairs={pairs} onAdopt={onAdopt} />
      </AntdApp>,
    );
    const adoptButtons = screen
      .getAllByRole("button")
      .filter((button) => button.textContent === bt("bilingual.compare.adopt"));
    expect(adoptButtons.length).toBeGreaterThan(0);
    fireEvent.click(adoptButtons[0]);
    expect(onAdopt).toHaveBeenCalledTimes(1);
    expect(typeof onAdopt.mock.calls[0][0]).toBe("string");
    expect(screen.getAllByText(bt("bilingual.compare.locked")).length).toBeGreaterThan(0);
    const selectable = pairs.filter(
      (pair) => pair.status === "changed" && pair.adoptable && !pair.locked,
    );
    expect(adoptButtons.length).toBe(selectable.length);
  });

  it("列表字段只读：显示只读标记且没有采纳按钮", () => {
    const pairs = buildBilingualPairs(MOCK_PRIMARY, withList(), LABELS);
    render(
      <AntdApp>
        <BilingualCompareView pairs={pairs} onAdopt={vi.fn()} />
      </AntdApp>,
    );
    expect(screen.getByText(bt("bilingual.compare.readOnlyTag"))).toBeTruthy();
    const listPair = pairs.find((pair) => pair.path.endsWith("mock_edu_courses"));
    expect(listPair?.adoptable).toBe(false);
  });

  it("行内语种标签用对照视图既有类名：宽布局由容器查询隐藏、窄布局保留（Q24）", () => {
    const pairs = buildBilingualPairs(MOCK_PRIMARY, translated(), LABELS);
    const { container } = render(
      <AntdApp>
        <BilingualCompareView pairs={pairs} />
      </AntdApp>,
    );
    const primaryCells = container.querySelectorAll(".bilingual-compare__cell--primary");
    const secondaryCells = container.querySelectorAll(".bilingual-compare__cell--secondary");
    expect(primaryCells.length).toBeGreaterThan(0);
    expect(primaryCells.length).toBe(secondaryCells.length);
    // 行内标签就是这个语种名（窄布局没有表头，靠它区分两段）。
    expect(primaryCells[0].querySelector(".bilingual-compare__lang")?.textContent).toBe(
      bt("bilingual.compare.columnPrimary"),
    );
    expect(secondaryCells[0].querySelector(".bilingual-compare__lang")?.textContent).toBe(
      bt("bilingual.compare.columnSecondary"),
    );
    expect(primaryCells[0].querySelector(".bilingual-compare__value")).toBeTruthy();
    // 旧的重复标签类名已删除：不得再出现第二套 label 元素。
    expect(container.querySelector(".bilingual-compare__cell-label")).toBeNull();
  });

  it("两边都没有内容时显示空态说明", () => {
    render(
      <AntdApp>
        <BilingualCompareView pairs={buildBilingualPairs(null, null, LABELS)} />
      </AntdApp>,
    );
    expect(screen.getByText(bt("bilingual.compare.nothing"))).toBeTruthy();
  });

  it("identical 时提示「还没翻译」，不传则没有提示", () => {
    const pairs = buildBilingualPairs(MOCK_PRIMARY, translated(), LABELS);
    const first = render(
      <AntdApp>
        <BilingualCompareView pairs={pairs} identical />
      </AntdApp>,
    );
    expect(screen.getByText(bt("bilingual.compare.identical"))).toBeTruthy();
    first.unmount();

    render(
      <AntdApp>
        <BilingualCompareView pairs={pairs} />
      </AntdApp>,
    );
    expect(screen.queryByText(bt("bilingual.compare.identical"))).toBeNull();
  });
});
