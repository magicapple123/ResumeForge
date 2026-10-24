// SPDX-License-Identifier: Apache-2.0
/**
 * W03 验收：**混合 30 步**（正文 + 排版参数）→ 连续撤销到初态 → 连续恢复回末态，
 * 内容与参数逐项一致。
 *
 * 为什么用真实定时器：合并窗口是 `debounceMs=300`，假定时器要和 antd/React 的调度
 * 混用（容易测出"假绿"）；这里每步等 330ms 让历史点真的落地，单个用例 ~25s 可接受。
 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import { t } from "../../i18n";
import type { ResumeContent, ResumeLayout } from "../../types";
import { DEFAULT_LAYOUT } from "../ResumeLayoutControls.testkit";
import ResumeZoomModal from "./ResumeZoomModal";

vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
vi.mock("../ResumePreview", () => ({
  default: () => <div data-testid="workbench-preview" />,
}));

const CONTENT: ResumeContent = {
  photo: "",
  name: "Alex",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  personal_website: "",
  github: "",
  job_intent: "Backend",
  summary: "",
  education: [],
  experience: [],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
};

const OPENING_LAYOUT: ResumeLayout = { ...DEFAULT_LAYOUT, format_config: {} };

function nameInput(): HTMLInputElement {
  const input = document.getElementById("name");
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

/** 打开左栏「历史」页签。 */
function openHistoryTab(): void {
  const params = document.querySelector<HTMLElement>(".resume-wb-col-params");
  expect(params).not.toBeNull();
  fireEvent.click(within(params as HTMLElement).getByText(t("workbench.history.title")));
}

function historyButtons(): { undo: HTMLButtonElement; redo: HTMLButtonElement } {
  const params = document.querySelector<HTMLElement>(".resume-wb-col-params") as HTMLElement;
  const buttons = [...params.querySelectorAll("button")];
  const byText = (label: string) =>
    buttons.find((node) => (node.textContent ?? "").replace(/\s+/g, "") === label);
  const undo = byText(t("workbench.history.undo"));
  const redo = byText(t("workbench.history.redo"));
  if (!(undo instanceof HTMLButtonElement) || !(redo instanceof HTMLButtonElement)) {
    throw new Error("历史页签里没有撤销/恢复按钮");
  }
  return { undo, redo };
}

/** 连续点某一颗历史按钮直到它禁用；返回实际点了几次（每次给 React 一拍让 effect 落地）。 */
async function clickUntilDisabled(kind: "undo" | "redo"): Promise<number> {
  let count = 0;
  while (count < 80) {
    const button = historyButtons()[kind];
    if (button.hasAttribute("disabled")) break;
    fireEvent.click(button);
    count += 1;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  return count;
}

const WAIT_COMMIT_MS = 330;

function renderWorkbench() {
  const holder: { layout: ResumeLayout } = { layout: OPENING_LAYOUT };
  function Harness() {
    const [layout, setLayout] = useState<ResumeLayout>(OPENING_LAYOUT);
    holder.layout = layout;
    return (
      <AntdApp>
        <ResumeZoomModal
          open
          html="<html></html>"
          warnings={[]}
          pages={1}
          onClose={vi.fn()}
          layout={layout}
          resumeId={42}
          content={CONTENT}
          onApplyLayout={(next) => setLayout(next)}
          onSaveContent={vi.fn(async () => undefined)}
        />
      </AntdApp>
    );
  }
  render(<Harness />);
  return holder;
}

async function waitCommit(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, WAIT_COMMIT_MS));
  });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("制作台 · 统一历史（W03）", () => {
  it("混合 30 步：撤销到初态再恢复回末态，内容与排版参数一致", async () => {
    const holder = renderWorkbench();

    // 28 步正文（每步一次停顿 = 一个历史点）。
    for (let step = 1; step <= 28; step += 1) {
      fireEvent.change(nameInput(), { target: { value: `Alex ${step}` } });
      await waitCommit();
    }
    // 2 步排版参数（色板切换 = 一次参数改动）。
    fireEvent.click(screen.getAllByRole("button", { name: t("workbench.color.navy") })[0]);
    await waitCommit();
    fireEvent.click(screen.getAllByRole("button", { name: t("workbench.color.forest") })[0]);
    await waitCommit();

    expect(nameInput().value).toBe("Alex 28");
    const finalAccent = holder.layout.format_config?.accent;
    expect(finalAccent).toBeTruthy();
    openHistoryTab();

    // 连续撤销到初态：正文回到 "Alex"，参数回到打开时（format_config 为空）。
    const undoCount = await clickUntilDisabled("undo");
    expect(undoCount).toBeGreaterThanOrEqual(30);
    await waitFor(() => expect(nameInput().value).toBe("Alex"));
    expect(holder.layout.format_config).toEqual({});
    // 已经到底：撤销按钮应禁用（没有可撤销的步骤）。
    expect(historyButtons().undo.getAttribute("disabled")).not.toBeNull();

    // 连续恢复到末态（最后一句正文与最后的参数）。
    const redoCount = await clickUntilDisabled("redo");
    expect(redoCount).toBeGreaterThanOrEqual(30);
    await waitFor(() => expect(nameInput().value).toBe("Alex 28"));
    expect(holder.layout.format_config?.accent).toBe(finalAccent);
    expect(historyButtons().redo.getAttribute("disabled")).not.toBeNull();
  }, 90000);
});
