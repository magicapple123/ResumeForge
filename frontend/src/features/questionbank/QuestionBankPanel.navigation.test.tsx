// SPDX-License-Identifier: Apache-2.0
/**
 * 题库的列表↔详情导航：进详情后列表卸载、返回时恢复页码/选中/滚动位置；历史为空时
 * 使用共享空态，而不是各写一份。
 *
 * 守的是「回来还在原地」：这类状态一旦丢了，用户只会觉得「点一下全乱了」，日志里什么都没有。
 */
import { App as AntdApp } from "antd";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { QuestionBankRecord } from "../../types";
import { QUESTION_BANK_TYPES } from "../../types";
import { t } from "../../i18n";
import QuestionBankPanel from "./QuestionBankPanel";

const api = vi.hoisted(() => ({ listQuestionBanks: vi.fn(), deleteQuestionBank: vi.fn() }));
vi.mock("../../api/interview", () => api);
vi.mock("../../api/jobs", () => ({
  listJobs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getJob: vi.fn(),
}));
vi.mock("../../api/resumes", () => ({
  listResumes: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getResume: vi.fn(),
}));
vi.mock("../../api/externalResumes", () => ({
  listExternalResumes: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getExternalResume: vi.fn(),
}));
const records: QuestionBankRecord[] = Array.from({ length: 12 }, (_, index) => ({
  id: index + 1,
  job_id: null,
  job_title: "",
  company: "",
  resume_id: null,
  resume_title: `History ${index + 1}`,
  model: "",
  groups: [
    {
      type: QUESTION_BANK_TYPES[0],
      questions: [{ question: `Question ${index + 1}`, purpose: "", answer_hint: "" }],
    },
  ],
  created_at: "2026-11-13T03:00:00",
  updated_at: "2026-11-13T03:00:00",
}));
function Harness() {
  const [record, setRecord] = useState<QuestionBankRecord | null>(null);
  return (
    <AntdApp>
      <QuestionBankPanel
        record={record}
        onOpenRecord={setRecord}
        onCloseRecord={() => setRecord(null)}
      />
    </AntdApp>
  );
}
beforeEach(() => {
  api.listQuestionBanks.mockResolvedValue(records);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("detail hides the mounted list and returns to its page, selection and scroll", async () => {
  render(<Harness />);
  await screen.findByText("History 1");
  expect(document.querySelector(".ant-collapse")).toBeNull();
  expect(screen.queryByText("Question 1")).toBeNull();
  fireEvent.click(screen.getByTitle("2"));
  const title = await screen.findByText("History 11");
  fireEvent.contextMenu(title);
  fireEvent.click(await screen.findByText(t("common.action.batchSelect")));
  const selectName = t("questionBankPanel.history.selectAria", { name: "History 11" });
  fireEvent.click(await screen.findByRole("checkbox", { name: selectName }));
  const mountedCard = screen.getByTestId("question-bank-history").firstElementChild;
  Object.defineProperty(window, "scrollY", { value: 413, configurable: true });
  fireEvent.click(
    screen.getAllByRole("button", { name: t("questionBankPanel.action.viewDetail") })[0],
  );
  await screen.findByText("1. Question 11");
  const history = screen.getByTestId("question-bank-history");
  expect(history).toHaveAttribute("hidden");
  expect(history.firstElementChild).toBe(mountedCard);
  expect(history).not.toBeVisible();
  expect(screen.getByText(t("questionBankPanel.history.breadcrumb", { id: 11 }))).toBeVisible();
  expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  fireEvent.click(screen.getByRole("button", { name: t("questionBankPanel.history.back") }));
  await waitFor(() => expect(history).not.toHaveAttribute("hidden"));
  expect(screen.getByRole("checkbox", { name: selectName })).toBeChecked();
  expect(screen.getByTitle("2")).toHaveClass("ant-pagination-item-active");
  await waitFor(() => expect(window.scrollTo).toHaveBeenLastCalledWith(0, 413));
});

it("empty history retains the shared empty state", async () => {
  api.listQuestionBanks.mockResolvedValue([]);
  render(<Harness />);
  expect(await screen.findByText(t("questionBankPanel.empty.noHistory"))).toBeVisible();
  expect(
    screen.queryByRole("button", { name: t("questionBankPanel.action.viewDetail") }),
  ).toBeNull();
});
