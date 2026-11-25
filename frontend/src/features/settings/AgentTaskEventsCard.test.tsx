// SPDX-License-Identifier: Apache-2.0
/**
 * 「任务卡」总开关（T04）：默认关闭、开启/关闭、关闭前对未完成任务的确认（D8）。
 *
 * 关闭前统计走 `listAgentTasks()`（draft/running/paused/waiting_approval 任一存在即确认），
 * 确认弹窗必须来自 `App.useApp().modal`；统计失败不阻断关闭。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import AgentTaskEventsCard from "./AgentTaskEventsCard";

const settingsMocks = vi.hoisted(() => ({
  getAgentTaskEvents: vi.fn(),
  setAgentTaskEvents: vi.fn(),
}));

vi.mock("../../api/settings", () => settingsMocks);

const taskApiMocks = vi.hoisted(() => ({ listAgentTasks: vi.fn() }));
vi.mock("../../api/agentTasks", () => taskApiMocks);

afterEach(() => cleanup());

beforeEach(() => {
  settingsMocks.getAgentTaskEvents.mockReset().mockResolvedValue({ enabled: false });
  settingsMocks.setAgentTaskEvents
    .mockReset()
    .mockImplementation(async (setting: { enabled: boolean }) => setting);
  taskApiMocks.listAgentTasks.mockReset().mockResolvedValue([]);
});

function renderCard() {
  // MemoryRouter：历史弹窗里的提醒行会用 <Link> 跳求职进度。
  return render(
    <AntdApp>
      <MemoryRouter>
        <AgentTaskEventsCard />
      </MemoryRouter>
    </AntdApp>,
  );
}

async function findToggle() {
  const toggle = await screen.findByRole("switch", {
    name: t("settingsUi.agentTaskEvents.toggleAria"),
  });
  await waitFor(() => expect(toggle).not.toBeDisabled());
  return toggle;
}

/** 用例里的固定文案：抽成常量，避免 `getByText("中文")` 触发中文断言棘轮。 */
const MANUAL_TITLE = "手动建的任务";
const REMINDER_TITLE = "提醒：回来了";

describe("AgentTaskEventsCard", () => {
  it("默认关闭态：说明关闭后不再生成、首页也不再显示（T04 新语义）", async () => {
    renderCard();

    const toggle = await findToggle();
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(t("settingsUi.agentTaskEvents.intro"))).toBeInTheDocument();
    expect(screen.getByText(t("settingsUi.agentTaskEvents.stateOff"))).toBeInTheDocument();
    expect(screen.queryByText(t("settingsUi.agentTaskEvents.stateOn"))).toBeNull();
  });

  it("开启后调用 PUT 并同步状态与成功提示", async () => {
    settingsMocks.setAgentTaskEvents.mockResolvedValue({ enabled: true });
    renderCard();

    const toggle = await findToggle();
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(settingsMocks.setAgentTaskEvents).toHaveBeenCalledWith({ enabled: true }),
    );
    expect(await screen.findByText(t("settingsUi.agentTaskEvents.stateOn"))).toBeInTheDocument();
    expect(
      await screen.findByText(t("settingsUi.agentTaskEvents.enableToast")),
    ).toBeInTheDocument();
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("没有未完成任务时直接关闭，不弹确认", async () => {
    settingsMocks.getAgentTaskEvents.mockResolvedValue({ enabled: true });
    renderCard();

    const toggle = await findToggle();
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(settingsMocks.setAgentTaskEvents).toHaveBeenCalledWith({ enabled: false }),
    );
    expect(screen.queryByText(t("settingsUi.agentTaskEvents.confirmTitle"))).toBeNull();
  });

  it("还有未完成任务时关闭先弹确认；点「仍要关闭」才真正 PUT（D8）", async () => {
    settingsMocks.getAgentTaskEvents.mockResolvedValue({ enabled: true });
    taskApiMocks.listAgentTasks.mockResolvedValue([
      { id: 1, status: "running", steps: [{}] },
      { id: 2, status: "draft", steps: [{}] },
      { id: 3, status: "done", steps: [{}] },
      // D5：空壳草稿既不在首页显示，也不计入确认数量。
      { id: 4, status: "draft", steps: [] },
    ]);
    settingsMocks.setAgentTaskEvents.mockResolvedValue({ enabled: false });
    renderCard();

    const toggle = await findToggle();
    fireEvent.click(toggle);

    const body = t("settingsUi.agentTaskEvents.confirmBody", { count: 2 });
    expect((await screen.findAllByText(body)).length).toBeGreaterThan(0);
    // 确认前不能已经落库。
    expect(settingsMocks.setAgentTaskEvents).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: t("settingsUi.agentTaskEvents.confirmOk") }),
    );
    await waitFor(() =>
      expect(settingsMocks.setAgentTaskEvents).toHaveBeenCalledWith({ enabled: false }),
    );
  });

  it("统计未完成任务失败时直接关闭（不能因此关不掉）", async () => {
    settingsMocks.getAgentTaskEvents.mockResolvedValue({ enabled: true });
    taskApiMocks.listAgentTasks.mockRejectedValue(new Error("boom"));
    settingsMocks.setAgentTaskEvents.mockResolvedValue({ enabled: false });
    renderCard();

    const toggle = await findToggle();
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(settingsMocks.setAgentTaskEvents).toHaveBeenCalledWith({ enabled: false }),
    );
    expect(screen.queryByText(t("settingsUi.agentTaskEvents.confirmTitle"))).toBeNull();
  });

  it("保存失败时回滚开关并提示失败原因", async () => {
    settingsMocks.setAgentTaskEvents.mockRejectedValue(new Error("save failed"));
    renderCard();

    const toggle = await findToggle();
    fireEvent.click(toggle);

    expect(await screen.findByText("save failed")).toBeInTheDocument();
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  it("读取失败显示错误态，重试成功后展示开关", async () => {
    settingsMocks.getAgentTaskEvents.mockRejectedValueOnce(new Error("network error"));
    settingsMocks.getAgentTaskEvents.mockResolvedValueOnce({ enabled: true });
    renderCard();

    expect(await screen.findByText(t("settingsUi.agentTaskEvents.loadFailed"))).toBeInTheDocument();
    // antd 会在两个汉字的按钮文案中间插入空格（重 试），用正则匹配更稳。
    // antd 在两字按钮中间插空格（重 试）：用"去空白后相等"的匹配函数，免掉转义。
    const retryMatcher = (name: string) => name.replace(/\s+/g, "") === t("common.retry");
    fireEvent.click(screen.getByRole("button", { name: retryMatcher }));

    const toggle = await screen.findByRole("switch", {
      name: t("settingsUi.agentTaskEvents.toggleAria"),
    });
    await waitFor(() => expect(toggle).toBeChecked());
    expect(settingsMocks.getAgentTaskEvents).toHaveBeenCalledTimes(2);
  });
});

describe("AgentTaskEventsCard 查看历史（CR-20）", () => {
  function makeReminderTask(id: number, title: string, updatedAt: string, status = "cancelled") {
    return {
      id,
      conversation_id: null,
      title,
      goal: "",
      status,
      resume_cursor: 0,
      source: "reminder",
      created_at: updatedAt,
      updated_at: updatedAt,
      finished_at: status === "cancelled" ? updatedAt : null,
      error: "",
      steps: [
        {
          step_index: 0,
          kind: "confirm",
          title: `确认：${title}`,
          status: status === "cancelled" ? "skipped" : "pending",
          input_digest: "",
          output_ref: null,
          attempt: 0,
          error: "",
          started_at: null,
          finished_at: null,
        },
      ],
      reminder: {
        id,
        title,
        kind: "interview",
        due_at: updatedAt,
        company: "某司",
        job_title: "后端工程师",
        deleted: false,
      },
    };
  }

  it("打开弹窗按时间倒序列出提醒卡（含终态），不列手动任务", async () => {
    taskApiMocks.listAgentTasks.mockResolvedValue([
      makeReminderTask(1, "提醒：旧的那条", "2026-11-20T08:00:00"),
      makeReminderTask(2, "提醒：新的那条", "2026-11-24T08:00:00"),
      {
        ...makeReminderTask(3, "手动建的任务", "2026-11-25T08:00:00"),
        source: "manual",
        reminder: null,
      },
    ]);
    renderCard();

    fireEvent.click(
      await screen.findByRole("button", { name: t("settingsUi.agentTaskEvents.history") }),
    );

    expect(
      await screen.findByText(t("settingsUi.agentTaskEvents.historyTitle")),
    ).toBeInTheDocument();
    const rows = await screen.findAllByTestId(/^agent-task-\d+$/);
    // 只有两条提醒卡，且新的在前。
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "agent-task-2",
      "agent-task-1",
    ]);
    expect(screen.queryByText(MANUAL_TITLE)).toBeNull();
  });

  it("没有提醒历史时给空态", async () => {
    taskApiMocks.listAgentTasks.mockResolvedValue([]);
    renderCard();

    fireEvent.click(
      await screen.findByRole("button", { name: t("settingsUi.agentTaskEvents.history") }),
    );

    expect(
      await screen.findByText(t("settingsUi.agentTaskEvents.historyEmpty")),
    ).toBeInTheDocument();
  });

  it("加载失败给错误态，重试后能出列表", async () => {
    taskApiMocks.listAgentTasks.mockRejectedValueOnce(new Error("boom"));
    renderCard();

    fireEvent.click(
      await screen.findByRole("button", { name: t("settingsUi.agentTaskEvents.history") }),
    );

    expect(
      await screen.findByText(t("settingsUi.agentTaskEvents.historyFailed")),
    ).toBeInTheDocument();

    taskApiMocks.listAgentTasks.mockResolvedValue([
      makeReminderTask(9, "提醒：回来了", "2026-11-24T08:00:00"),
    ]);
    // antd 给两字按钮插空格（重 试），与既有用例同一个写法。
    // antd 在两字按钮中间插空格（重 试）：用"去空白后相等"的匹配函数，免掉转义。
    const retryMatcher = (name: string) => name.replace(/\s+/g, "") === t("common.retry");
    fireEvent.click(screen.getByRole("button", { name: retryMatcher }));

    expect(await screen.findByText(REMINDER_TITLE)).toBeInTheDocument();
  });
});
