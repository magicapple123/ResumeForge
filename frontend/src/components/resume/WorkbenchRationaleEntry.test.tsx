// SPDX-License-Identifier: Apache-2.0
/**
 * 左栏「查看生成说明」入口（#24 24F）。
 *
 * 钉三件事：
 * 1. **没有 rationale 就不渲染入口**（空串 / 只有空白同办）——留一个点开是空白的死链
 *    比不摆更糟；
 * 2. 有 rationale 时是可点的真按钮，读屏名与预览卡顶部那个入口**同一条 key**；
 * 3. 点开的正文是现有的 `RationaleParagraphs`（`.resume-rationale-body`），段落切分规则
 *    不在这里复制一份——所以断言落在那个类名上，而不是自己再写一遍分段逻辑。
 *
 * 本文件不含 CJK 字面量（棘轮对新增中文断言会红）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n";
import WorkbenchRationaleEntry from "./WorkbenchRationaleEntry";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const ARIA = t("resume.diagnostics.aria.rationale");
const LABEL = t("resume.diagnostics.entry.rationale");
const RATIONALE = "Target role: operations.\nCandidate pool: two projects.";

describe("WorkbenchRationaleEntry · generation rationale entry", () => {
  it("renders nothing without a rationale", () => {
    const { container, rerender } = render(<WorkbenchRationaleEntry rationale={null} />);
    expect(container.querySelector(".resume-wb-rationale")).toBeNull();
    expect(screen.queryByRole("button", { name: ARIA })).toBeNull();
    // 空串 / 只有空白与 null 同口径：都不许留一个空入口。
    rerender(<WorkbenchRationaleEntry rationale="" />);
    expect(container.querySelector(".resume-wb-rationale")).toBeNull();
    rerender(<WorkbenchRationaleEntry rationale={"  \n "} />);
    expect(container.querySelector(".resume-wb-rationale")).toBeNull();
  });

  it("is a real button labelled like the preview entry", () => {
    render(<WorkbenchRationaleEntry rationale={RATIONALE} />);
    const button = screen.getByRole("button", { name: ARIA });
    expect(button.textContent).toBe(LABEL);
    expect(button.className).toContain("resume-wb-rationale-entry");
  });

  it("shows the rationale through the shared paragraph renderer", async () => {
    render(<WorkbenchRationaleEntry rationale={RATIONALE} />);
    fireEvent.click(screen.getByRole("button", { name: ARIA }));
    expect(await screen.findByText("Target role: operations.")).toBeInTheDocument();
    expect(screen.getByText("Candidate pool: two projects.")).toBeInTheDocument();
    // 段落渲染件是现成那一份（#24 24F 明确不许搬新实现）。
    expect(document.querySelector(".resume-rationale-body")).not.toBeNull();
  });
});
