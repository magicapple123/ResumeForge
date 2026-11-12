// SPDX-License-Identifier: Apache-2.0
/** Job-match running panel: "done" and "still running" must be mutually exclusive (issue 13). */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import JobMatchBatchRunning from "./JobMatchBatchRunning";
import { t } from "../../i18n";
import type { JobMatchBackgroundTaskView } from "../../utils/jobMatchBackgroundTasks";

function view(overrides: Partial<JobMatchBackgroundTaskView> = {}): JobMatchBackgroundTaskView {
  return {
    id: "task-1",
    label: "job match (3 jobs)",
    status: "running",
    requestedCount: 3,
    completedCount: 3,
    failedCount: 0,
    currentJobTitle: "Growth Operations",
    message: "3/3 jobs processed",
    error: "",
    batchId: null,
    ...overrides,
  };
}

function renderRunning(task: JobMatchBackgroundTaskView) {
  return render(
    <JobMatchBatchRunning task={task} cancelling={false} onCancel={() => {}} onClose={() => {}} />,
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("JobMatchBatchRunning finished state", () => {
  it("percent=100 while the task is still running shows no success state (no checkmark)", () => {
    const { container } = renderRunning(view({ status: "running" }));

    // antd flips a circle Progress to success on 100% unless `status` is explicit:
    // that default is exactly what produced "checkmark + 3/3 + still analyzing".
    expect(container.querySelector(".ant-progress-status-success")).toBeNull();
    expect(container.querySelector(".ant-progress-status-active")).not.toBeNull();
    expect(container.querySelector(".anticon-check")).toBeNull();
  });

  it("a really completed task shows the success state", () => {
    const { container } = renderRunning(view({ status: "completed", currentJobTitle: "" }));

    expect(container.querySelector(".ant-progress-status-success")).not.toBeNull();
    expect(container.querySelector(".ant-progress-status-active")).toBeNull();
  });

  it("a cancelled task stuck at N/N is still not a checkmark", () => {
    const { container } = renderRunning(view({ status: "cancelled", currentJobTitle: "" }));

    expect(container.querySelector(".ant-progress-status-success")).toBeNull();
  });
});

describe("JobMatchBatchRunning current job copy", () => {
  it("shows the job that is actually being analyzed first", () => {
    renderRunning(view({ completedCount: 0, currentJobTitle: "Backend Platform" }));

    expect(
      screen.getByText(t("jobMatchBatch.running.current", { title: "Backend Platform" })),
    ).toBeInTheDocument();
    expect(screen.queryByText(t("jobMatchBatch.running.waiting"))).toBeNull();
  });

  it("shows the wrapping-up copy once every job is counted but the task is unfinished", () => {
    renderRunning(view({ status: "running", completedCount: 2, currentJobTitle: "Growth Ops" }));
    expect(
      screen.getByText(t("jobMatchBatch.running.current", { title: "Growth Ops" })),
    ).toBeInTheDocument();

    cleanup();
    renderRunning(view({ status: "running", completedCount: 3, currentJobTitle: "Growth Ops" }));

    expect(screen.getByText(t("jobMatchBatch.running.finalizing"))).toBeInTheDocument();
    expect(
      screen.queryByText(t("jobMatchBatch.running.current", { title: "Growth Ops" })),
    ).toBeNull();
  });
});
