// SPDX-License-Identifier: Apache-2.0
/**
 * 备选岗位抽屉：**同一时刻只有一个弹层容器**，关闭语义"一次退一层"。
 *
 * 这一组守的是方案 §4.7 的契约（也是 B3 唯一的真实回归风险面）：
 * 1. 列表里点卡片 → 进详情，弹层容器数量仍是 1（以前是 Drawer + Modal = 2）；
 * 2. 详情里点编辑 → 进表单，仍然只有 1 个容器，且按钮组在抽屉 footer 里；
 * 3. 详情态按 Esc → 只回列表；列表态按 Esc → 才真的收掉抽屉。
 *
 * 弹层数量一律数 `[role="dialog"]`；断言文案只写 `t(key)`，数据用常量持有。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t, type MessageKey } from "../../i18n";
import type { CandidateJob, CandidateJobDetail } from "../../types";
import CandidateJobsDrawer from "./CandidateJobsDrawer";

const api = vi.hoisted(() => ({
  listCandidateJobsPage: vi.fn(),
  getCandidateJob: vi.fn(),
  createCandidateJob: vi.fn(),
  updateCandidateJob: vi.fn(),
  deleteCandidateJob: vi.fn(),
}));

vi.mock("../../api/candidateJob", () => api);

/** 候选的标题与 JD 属于**数据**（用户内容），不是界面文案。 */
const TITLE = "frontend engineer";
const SECOND_TITLE = "backend engineer";
const JD_BODY = "server side development";

const CANDIDATE: CandidateJob = {
  id: 7,
  title: TITLE,
  company: "acme",
  location: "",
  salary: "",
  source: "粘贴文本",
  source_url: "",
  raw_text: "",
  status: "pending",
  imported_job_id: null,
  note: "",
  images: [],
  collect_task_id: null,
  created_at: "2026-10-01T08:00:00",
  updated_at: "2026-10-01T08:00:00",
};

const DETAIL: CandidateJobDetail = {
  ...CANDIDATE,
  description: JD_BODY,
  requirements: "",
  job_type: "",
  additional_info: "",
};

/** 第二条候选：批量删除要能数出「2 条」，一条夹具不够。 */
const SECOND: CandidateJob = {
  ...CANDIDATE,
  id: 8,
  title: SECOND_TITLE,
};

function dialogCount(): number {
  return document.querySelectorAll('[role="dialog"]').length;
}

/**
 * antd 会给**两个汉字**的按钮插一个空格（「编 辑」），直接比字符串会找不到。
 * 用 `t(key)` 拼出"字间可有空白"的正则，测试里就不必写中文字面量。
 */
function spaced(key: MessageKey): RegExp {
  return new RegExp(
    `^${Array.from(t(key))
      .map((char) => `\\s*${char}`)
      .join("")}\\s*$`,
  );
}

function renderDrawer() {
  const onClose = vi.fn();
  render(
    <AntdApp>
      <CandidateJobsDrawer open onClose={onClose} onImport={vi.fn()} />
    </AntdApp>,
  );
  return { onClose };
}

beforeEach(() => {
  api.listCandidateJobsPage.mockResolvedValue({ items: [CANDIDATE], total: 1 });
  api.getCandidateJob.mockResolvedValue(DETAIL);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CandidateJobsDrawer 视图切换", () => {
  it("点卡片进详情：仍然只有一个弹层容器", async () => {
    renderDrawer();
    fireEvent.click(await screen.findByText(TITLE));

    expect(await screen.findByText(JD_BODY)).toBeInTheDocument();
    expect(dialogCount()).toBe(1);
    // 标题随视图走（详情视图的标题由抽屉承担）。
    expect(screen.getByText(t("jobs.candidate.detail.title"))).toBeInTheDocument();
  });

  it("详情里点编辑进表单：仍然只有一个容器，保存按钮在抽屉 footer", async () => {
    renderDrawer();
    fireEvent.click(await screen.findByText(TITLE));
    await screen.findByText(JD_BODY);

    fireEvent.click(screen.getByRole("button", { name: spaced("jobs.candidate.action.edit") }));

    expect(await screen.findByText(t("jobs.candidate.form.title-edit"))).toBeInTheDocument();
    expect(screen.getByPlaceholderText(t("jobs.candidate.form.title-placeholder"))).toBeEnabled();
    expect(screen.getByRole("button", { name: t("jobs.candidate.action.save") })).toBeEnabled();
    expect(dialogCount()).toBe(1);
  });

  it("详情态按 Esc 只回列表，不关抽屉", async () => {
    const { onClose } = renderDrawer();
    fireEvent.click(await screen.findByText(TITLE));
    await screen.findByText(JD_BODY);

    fireEvent.keyDown(document, { key: "Escape" });

    // 回列表：卡片又在，抽屉没关。
    await waitFor(() => expect(screen.queryByText(JD_BODY)).not.toBeInTheDocument());
    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(dialogCount()).toBe(1);
  });

  it("列表态按 Esc 才真的关抽屉", async () => {
    const { onClose } = renderDrawer();
    await screen.findByText(TITLE);

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

/**
 * 批量删除的确认形态（方案 §3.7）：抽屉开着时**不许再开第二层容器**。
 *
 * 以前这里是 `useCandidateBatchTools` 里的 `modal.confirm`——抽屉(1) + confirm(1) =
 * 两个 `[role="dialog"]`。现在换成工具条上的就地 `Popconfirm`（Popover 形态，不占容器层），
 * 语义不变：仍是"动作 + 条数 + 后果"的三段确认，点确认才真的删。
 */
describe("CandidateJobsDrawer 批量删除就地确认", () => {
  it("勾 2 条点批量删除：确认就地弹出，容器仍是 1 个，确认后才真删", async () => {
    api.listCandidateJobsPage.mockResolvedValue({ items: [CANDIDATE, SECOND], total: 2 });
    api.deleteCandidateJob.mockResolvedValue(undefined);
    renderDrawer();

    await screen.findByText(TITLE);
    // R8 之后多选入口在卡片右键菜单里。
    fireEvent.contextMenu(screen.getByText(TITLE));
    fireEvent.click(await screen.findByRole("menuitem", { name: /批量选择/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "全选本页" }));

    fireEvent.click(screen.getByRole("button", { name: "批量删除" }));

    // 确认 UI 就地出现（条数写进标题）；Popover 不是容器，弹层数量仍是 1。
    expect(
      await screen.findByText(t("jobs.candidate.batch.delete-confirm", { count: 2 })),
    ).toBeInTheDocument();
    expect(document.querySelector(".ant-popconfirm")).not.toBeNull();
    expect(dialogCount()).toBe(1);
    // 没点确认之前不许发删除请求。
    expect(api.deleteCandidateJob).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: spaced("jobs.candidate.batch.delete-action") }),
    );

    await waitFor(() => expect(api.deleteCandidateJob).toHaveBeenCalledTimes(2));
    expect(api.deleteCandidateJob).toHaveBeenCalledWith(CANDIDATE.id);
    expect(api.deleteCandidateJob).toHaveBeenCalledWith(SECOND.id);
    expect(dialogCount()).toBe(1);
  });
});
