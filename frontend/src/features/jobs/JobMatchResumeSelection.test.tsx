// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位匹配的「用哪份简历」：单条与批量必须发同一份显式选择；结果要显示真实来源并在输入
 * 变了时提示失效；简历列表加载失败时仍保留「默认」可选，并给重试。
 *
 * 守的是**缓存归属**：选错简历不会报错，只会安静地拿另一份简历去匹配——最贵也最难发现。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, JobMatchOut, JobMatchResult } from "../../types";
import { t } from "../../i18n";
import JobMatchModal from "./JobMatchModal";
import JobMatchBatchPanel from "./JobMatchBatchPanel";
import JobMatchSourceNotice from "./JobMatchSourceNotice";
import JobMatchResumeSelect from "./JobMatchResumeSelect";

const mocks = vi.hoisted(() => ({
  listResumes: vi.fn(),
  getJobMatch: vi.fn(),
  createAiTask: vi.fn(),
  startJobMatchBatchTask: vi.fn(),
  listJobMatchBatches: vi.fn(),
}));
vi.mock("../../api/resumes", () => ({ listResumes: mocks.listResumes }));
vi.mock("../../api/jobs", () => ({ ...mocks }));
vi.mock("../../api/aiTasks", () => ({ createAiTask: mocks.createAiTask }));
vi.mock("../../hooks/useBackgroundTasks", () => ({ useBackgroundTasks: () => [] }));
vi.mock("../../hooks/useJobMatchBackgroundTasks", () => ({ useJobMatchBackgroundTasks: () => [] }));
vi.mock("../../utils/backgroundTasks", () => ({
  backgroundTaskKey: () => "test-key",
  attachTaskUi: () => () => {},
  watchAiTask: vi.fn(),
}));
vi.mock("../../utils/jobMatchBackgroundTasks", () => ({ watchJobMatchBatchTask: vi.fn() }));
const result: JobMatchResult = {
  hard_conditions: [],
  core_abilities: [],
  bonus_items: [],
  hard_gate: "unknown",
  admission: "needs_confirm",
  advice: "",
  notes: [],
};
const job = { id: 12, title: "Agent PM" } as Job;
const output: JobMatchOut = {
  id: 0,
  job_id: 12,
  job_title: "Agent PM",
  company: "",
  result,
  hard_gate: "unknown",
  requires_confirm: false,
  model: "",
  created_at: "",
  updated_at: "",
  reference_score: null,
};

async function selectResume() {
  fireEvent.mouseDown(screen.getByRole("combobox"));
  fireEvent.click(await screen.findByText("Resume A"));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listResumes.mockResolvedValue({ items: [{ id: 31, title: "Resume A" }], total: 1 });
  mocks.getJobMatch.mockResolvedValue(output);
  mocks.createAiTask.mockResolvedValue({ id: 5, kind: "job_match", status: "pending" });
  mocks.startJobMatchBatchTask.mockResolvedValue({ task_id: "batch-1", status: "pending" });
  mocks.listJobMatchBatches.mockResolvedValue([]);
});
afterEach(cleanup);
describe("matching resume source", () => {
  it("sends an explicit resume to the single background analysis and reads selected staleness", async () => {
    render(
      <AntdApp>
        <JobMatchModal job={job} onClose={vi.fn()} />
      </AntdApp>,
    );
    await selectResume();
    await waitFor(() => expect(mocks.getJobMatch).toHaveBeenCalledWith(12, 31));
    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(t("jobMatch.action.start")) }),
    );
    await waitFor(() =>
      expect(mocks.createAiTask).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { job_id: 12, resume_id: 31, force: false },
        }),
      ),
    );
  });
  it("sends the same selected resume for the entire batch", async () => {
    render(
      <AntdApp>
        <JobMatchBatchPanel open jobIds={[12, 13]} onClose={vi.fn()} />
      </AntdApp>,
    );
    await selectResume();
    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(t("jobMatchBatch.action.start")) }),
    );
    await waitFor(() =>
      expect(mocks.startJobMatchBatchTask).toHaveBeenCalledWith({
        job_ids: [12, 13],
        resume_id: 31,
        force: false,
        mode: "match",
      }),
    );
  });
  it("shows the actual result source and warns on changed inputs", () => {
    const source = {
      resume_id: 31,
      resume_title: "Resume A",
      resume_revision: 2,
      content_hash: "abc",
      fingerprint: "def",
    };
    render(<JobMatchSourceNotice result={{ ...result, source }} stale />);
    expect(
      screen.getByText(t("jobMatch.resume.source", { title: "Resume A", revision: 2 })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("jobMatch.resume.stale"))).toBeInTheDocument();
  });
  it("keeps the default usable after a list error and provides retry", async () => {
    mocks.listResumes.mockRejectedValueOnce(new Error("offline"));
    const onChange = vi.fn();
    render(<JobMatchResumeSelect onChange={onChange} />);
    await screen.findByText(t("jobMatch.resume.loadError"));
    expect(screen.getByRole("combobox")).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: t("jobMatch.resume.retry") }));
    await waitFor(() => expect(mocks.listResumes).toHaveBeenCalledTimes(2));
    await selectResume();
    expect(onChange).toHaveBeenCalledWith(31);
  });
});
