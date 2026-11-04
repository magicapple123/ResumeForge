// SPDX-License-Identifier: Apache-2.0
/**
 * 批量 AI 的跨页浮条：非岗位页显示（岗位页已有内联进度）、可停止、空闲不渲染。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import BulkAiFloatingBar from "./BulkAiFloatingBar";

const runnerMocks = vi.hoisted(() => ({ useBulkAiState: vi.fn(), stopBulkAi: vi.fn() }));

vi.mock("../../features/jobs/jobBulkAiRunner", () => ({
  useBulkAiState: runnerMocks.useBulkAiState,
  stopBulkAi: runnerMocks.stopBulkAi,
}));

const JOB_TITLE = "后端开发工程师";

const RUNNING = {
  running: true,
  kind: "resume" as const,
  total: 3,
  done: 1,
  failed: 0,
  currentTitle: JOB_TITLE,
  stopRequested: false,
};

const IDLE = { ...RUNNING, running: false, kind: null, total: 0, done: 0, currentTitle: "" };

/** antd 会在两个汉字之间插入空格（autoInsertSpace），按去空白后的文本匹配按钮。 */
function button(text: string): HTMLElement {
  const compact = (value: string | null) => (value ?? "").replace(/\s+/g, "");
  const found = screen
    .getAllByRole("button")
    .find((candidate) => compact(candidate.textContent) === compact(text));
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BulkAiFloatingBar />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  runnerMocks.useBulkAiState.mockReset();
  runnerMocks.stopBulkAi.mockReset();
});

afterEach(cleanup);

describe("BulkAiFloatingBar", () => {
  it("非岗位页显示进度、岗位名与两颗按钮", () => {
    runnerMocks.useBulkAiState.mockReturnValue(RUNNING);
    const { container } = renderAt("/tracker");

    expect(container.querySelector(".bulk-ai-floating-bar")).not.toBeNull();
    expect(
      screen.getByText(
        t("batchOperation.floating.running.resume", { done: 1, total: 3, title: JOB_TITLE }),
      ),
    ).toBeInTheDocument();
    expect(button(t("batchOperation.floating.view"))).toBeEnabled();
    expect(button(t("batchOperation.floating.stop"))).toBeEnabled();
  });

  it("岗位页不显示（那里已有工具栏内联进度条）", () => {
    runnerMocks.useBulkAiState.mockReturnValue(RUNNING);
    const { container } = renderAt("/jobs");

    expect(container.querySelector(".bulk-ai-floating-bar")).toBeNull();
  });

  it("空闲时不渲染", () => {
    runnerMocks.useBulkAiState.mockReturnValue(IDLE);
    const { container } = renderAt("/tracker");

    expect(container.querySelector(".bulk-ai-floating-bar")).toBeNull();
  });

  it("点停止调用 stopBulkAi，且已请求停止时按钮禁用", () => {
    runnerMocks.useBulkAiState.mockReturnValue(RUNNING);
    const first = renderAt("/tracker");
    fireEvent.click(button(t("batchOperation.floating.stop")));
    expect(runnerMocks.stopBulkAi).toHaveBeenCalledTimes(1);
    first.unmount();

    runnerMocks.useBulkAiState.mockReturnValue({ ...RUNNING, stopRequested: true });
    renderAt("/tracker");
    expect(button(t("batchOperation.floating.stop"))).toBeDisabled();
  });
});
