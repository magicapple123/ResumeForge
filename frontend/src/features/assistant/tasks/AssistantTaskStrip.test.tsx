/**
 * 助手任务条（18A）：只列 source=assistant 的未结束任务；暂停/取消/进度复用首页任务卡。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { AgentTask } from "../../../api/agentTasks";
import AssistantTaskStrip from "./AssistantTaskStrip";

const controller = {
  tasks: [] as AgentTask[],
  loading: false,
  error: null as string | null,
  start: vi.fn(),
  resume: vi.fn(),
  pause: vi.fn(),
  cancel: vi.fn(),
};

vi.mock("./useAgentTasks", () => ({
  useAgentTasks: () => controller,
}));

function makeTask(id: number, source: string, status: AgentTask["status"]): AgentTask {
  return {
    id,
    conversation_id: null,
    title: `Task ${id}`,
    goal: "",
    status,
    resume_cursor: status === "done" ? 3 : 1,
    source,
    created_at: "2026-11-11T00:00:00",
    updated_at: "2026-11-11T00:00:00",
    finished_at: null,
    error: "",
    steps: [
      {
        step_index: 0,
        kind: "read",
        title: "Read records",
        status: "done",
        input_digest: "",
        output_ref: null,
        attempt: 1,
        error: "",
        started_at: null,
        finished_at: null,
      },
      {
        step_index: 1,
        kind: "edit",
        title: "Rewrite entries",
        status: "running",
        input_digest: "",
        output_ref: null,
        attempt: 0,
        error: "",
        started_at: null,
        finished_at: null,
      },
      {
        step_index: 2,
        kind: "save",
        title: "Save draft",
        status: "pending",
        input_digest: "",
        output_ref: null,
        attempt: 0,
        error: "",
        started_at: null,
        finished_at: null,
      },
    ],
  };
}

/** antd 会给两个汉字的按钮插空格，且图标自带 aria-label：用"逐字允许空白"的正则匹配。 */
function buttonName(key: Parameters<typeof t>[0]): RegExp {
  return new RegExp(t(key).split("").join("\\s*"));
}

function renderStrip() {
  render(
    <AntdApp>
      <AssistantTaskStrip />
    </AntdApp>,
  );
}

afterEach(() => {
  cleanup();
  controller.tasks = [];
  controller.error = null;
  for (const fn of [controller.start, controller.resume, controller.pause, controller.cancel]) {
    fn.mockReset();
  }
});

describe("AssistantTaskStrip", () => {
  it("renders only assistant-created, unfinished tasks", () => {
    controller.tasks = [
      makeTask(1, "assistant", "running"),
      makeTask(2, "reminder", "running"),
      makeTask(3, "assistant", "done"),
    ];
    renderStrip();

    expect(screen.getByText(t("assistantBreadth.tasks.title"))).toBeTruthy();
    expect(screen.getByTestId("agent-task-1")).toBeTruthy();
    expect(screen.queryByTestId("agent-task-2")).toBeNull();
    expect(screen.queryByTestId("agent-task-3")).toBeNull();
  });

  it("renders nothing when there is no assistant task", () => {
    controller.tasks = [makeTask(2, "reminder", "running")];
    renderStrip();
    expect(screen.queryByText(t("assistantBreadth.tasks.title"))).toBeNull();
  });

  it("pauses a running task through the real REST action", () => {
    controller.tasks = [makeTask(1, "assistant", "running")];
    renderStrip();

    fireEvent.click(
      screen.getByRole("button", { name: buttonName("assistantBreadth.tasks.pause") }),
    );
    expect(controller.pause).toHaveBeenCalledWith(1);
  });

  it("collapses the task body from the header action", () => {
    controller.tasks = [makeTask(1, "assistant", "running")];
    renderStrip();

    fireEvent.click(
      screen.getByRole("button", { name: buttonName("assistantBreadth.tasks.hide") }),
    );
    expect(screen.queryByTestId("agent-task-1")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: buttonName("assistantBreadth.tasks.show") }),
    );
    expect(screen.getByTestId("agent-task-1")).toBeTruthy();
  });
});
