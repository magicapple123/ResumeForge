// SPDX-License-Identifier: Apache-2.0
/**
 * 题库的「材料来源」：外部简历只带文本与文件名、不带内部 id；超大文件在解析前拒绝；
 * 材料为空时不能生成题目。
 *
 * 守的是**边界**不是按钮：文件大小、来源为空、内部 id 泄漏到提示词，这三类问题在界面上
 * 看不出，只有到生成结果里才会发现。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { QUESTION_BANK_TYPES } from "../../types";
import QuestionBankPanel from "./QuestionBankPanel";

const api = vi.hoisted(() => ({
  generateQuestionBank: vi.fn(),
  listQuestionBanks: vi.fn(),
  saveQuestionBank: vi.fn(),
  deleteQuestionBank: vi.fn(),
  extractInterviewMaterial: vi.fn(),
}));
const external = vi.hoisted(() => ({ listExternalResumes: vi.fn(), getExternalResume: vi.fn() }));
vi.mock("../../api/interview", () => api);
vi.mock("../../api/externalResumes", () => external);
vi.mock("../../api/jobs", () => ({
  listJobs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getJob: vi.fn(),
}));
vi.mock("../../api/resumes", () => ({
  listResumes: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getResume: vi.fn(),
}));
const MATERIAL = {
  name: "candidate.docx",
  text: "Engineer with Python",
  warnings: ["review extraction"],
};
const RESULT = {
  job_id: null,
  job_title: "",
  company: "",
  resume_id: null,
  resume_title: MATERIAL.name,
  groups: [
    {
      type: QUESTION_BANK_TYPES[0],
      questions: [{ question: "Explain your project", purpose: "", answer_hint: "" }],
    },
  ],
  llm_used: true,
  notes: [],
};
function mount(onStartSession = vi.fn()) {
  render(
    <AntdApp>
      <QuestionBankPanel onStartSession={onStartSession} />
    </AntdApp>,
  );
  return onStartSession;
}
// Q3 之后只有**简历侧**还有「导入文件」；岗位侧按决策只留「从记录选」，
// 所以这里不再按下标取，改为断言只有一组可点。
function fileMode() {
  const radios = screen.getAllByRole("radio", { name: t("interviewPage.setup.material.fromFile") });
  expect(radios).toHaveLength(1);
  fireEvent.click(radios[0]);
}
function upload(file: File) {
  const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
  fireEvent.change(input, { target: { files: [file] } });
}
beforeEach(() => {
  vi.clearAllMocks();
  api.listQuestionBanks.mockResolvedValue([]);
  api.generateQuestionBank.mockResolvedValue(RESULT);
  api.saveQuestionBank.mockResolvedValue({ id: 1 });
  api.extractInterviewMaterial.mockResolvedValue(MATERIAL);
  external.listExternalResumes.mockResolvedValue({
    items: [
      { id: 9, name: "candidate.docx", has_text: true },
      { id: 10, name: "scan.pdf", has_text: false },
    ],
    total: 2,
  });
  external.getExternalResume.mockResolvedValue({ id: 9, has_text: true, ...MATERIAL });
});
afterEach(cleanup);

it("external resume uses text and filename without an internal id", async () => {
  const start = mount();
  fireEvent.mouseDown(
    screen
      .getByText(t("questionBankPanel.select.resumePlaceholder"))
      .closest(".ant-select-content")!,
  );
  const missingText = await screen.findByText(/scan.pdf/);
  expect(missingText.closest(".ant-select-item-option")).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(await screen.findByText("candidate.docx"));
  await screen.findByText(
    t("interviewPage.setup.material.parsed", { chars: MATERIAL.text.length }),
  );
  fireEvent.click(screen.getByRole("button", { name: /生成题库/ }));
  await screen.findByText("1. Explain your project");
  expect(api.generateQuestionBank).toHaveBeenCalledWith(
    {
      job_id: null,
      resume_text: MATERIAL.text,
      resume_title: MATERIAL.name,
    },
    expect.anything(),
  );
  expect(api.saveQuestionBank).toHaveBeenCalledWith(
    expect.objectContaining({
      resume_id: null,
      resume_title: MATERIAL.name,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /开始模拟面试/ }));
  expect(start).toHaveBeenCalledWith(
    ["Explain your project"],
    expect.objectContaining({
      resumeMaterial: { name: MATERIAL.name, text: MATERIAL.text, warnings: [], parser: "text" },
    }),
  );
});

it("resume file side can generate alone; upload metadata stays outside request", async () => {
  mount();
  fileMode();
  upload(new File(["material"], "candidate.docx"));
  await screen.findByText(MATERIAL.name);
  fireEvent.click(screen.getByRole("button", { name: /生成题库/ }));
  await waitFor(() => expect(api.generateQuestionBank).toHaveBeenCalledTimes(1));
  const payload = api.generateQuestionBank.mock.calls[0][0];
  expect(payload).toEqual({
    job_id: null,
    resume_text: MATERIAL.text,
    resume_title: MATERIAL.name,
  });
  expect(payload).not.toHaveProperty("warnings");
  expect(payload).not.toHaveProperty("parser");
  expect(document.querySelector("textarea")).toBeNull();
});

it("job side has no file import (Q3 keeps record-only on the job side)", () => {
  mount();
  expect(
    screen.queryAllByRole("radio", { name: t("interviewPage.setup.material.fromFile") }),
  ).toHaveLength(1);
});

it("12 MB file is rejected before parsing and an empty file source cannot generate", async () => {
  mount();
  fileMode();
  upload(new File([new Uint8Array(12 * 1024 * 1024)], "large.pdf"));
  await screen.findByText(t("interviewPage.setup.material.tooLarge"));
  expect(api.extractInterviewMaterial).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /生成题库/ }));
  await screen.findByText(t("questionBankPanel.validate.needJobOrResume"));
  expect(api.generateQuestionBank).not.toHaveBeenCalled();
});
