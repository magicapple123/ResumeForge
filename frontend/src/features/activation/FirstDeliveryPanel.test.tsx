/** 面板渲染断言：三阶段文案、CTA href、无模型提示、完成态/未来态的呈现。 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { Stats } from "../../types/search";
import { FirstDeliveryPanel } from "./FirstDeliveryPanel";
import { computeActivationStages } from "./useActivationProgress";

function statsWith(overrides: Partial<Stats>): Stats {
  return {
    job_count: 0,
    open_job_count: 0,
    resume_count: 0,
    week_resume_count: 0,
    latest_jobs: [],
    latest_resumes: [],
    favorite_job_count: 0,
    pending_claim_count: 0,
    pending_claims: [],
    stalled_application_count: 0,
    apply_queue_count: 0,
    claim_count: 0,
    resume_with_job_count: 0,
    latest_applications: [],
    ...overrides,
  };
}

function renderPanel(stats: Stats) {
  return render(
    <MemoryRouter>
      <FirstDeliveryPanel stages={computeActivationStages(stats)} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("FirstDeliveryPanel", () => {
  it("空库：标题、三阶段文案与无模型提示都在，当前步 CTA 指向我的资料", () => {
    renderPanel(statsWith({}));

    expect(screen.getByText("从零到第一份可交付简历")).toBeInTheDocument();
    expect(screen.getByText("准备事实")).toBeInTheDocument();
    expect(screen.getByText("选择目标岗位")).toBeInTheDocument();
    expect(screen.getByText("核实并交付")).toBeInTheDocument();
    expect(screen.getByText(/手动填写、本地检查与导出不需要配置模型/)).toBeInTheDocument();

    const cta = screen.getByRole("link", { name: /去我的资料录入/ });
    expect(cta).toHaveAttribute("href", "/profile");
  });

  it("空台账：核实阶段显示真实进度『台账为空』而不是已完成", () => {
    // 前两步完成、有简历但台账为空：阶段 3 是当前步，必须显示"台账为空"而非完成态。
    renderPanel(
      statsWith({ resume_count: 1, job_count: 3, resume_with_job_count: 1, claim_count: 0 }),
    );
    expect(screen.getByText(/台账为空/)).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /去事实台账录入主张/ });
    expect(cta).toHaveAttribute("href", "/claims");
  });

  it("部分核实：进度以『已核实 N/M 条主张』呈现", () => {
    renderPanel(
      statsWith({
        claim_count: 5,
        resume_count: 1,
        job_count: 3,
        resume_with_job_count: 1,
        pending_claim_count: 2,
      }),
    );
    expect(screen.getByText("已核实 3/5 条主张")).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /核实 2 条待确认事实/ });
    expect(cta).toHaveAttribute("href", "/claims");
  });

  it("有岗位但无关联动作：当前步 CTA 指向简历中心", () => {
    renderPanel(statsWith({ claim_count: 1, job_count: 3 }));
    expect(screen.getByRole("link", { name: /为岗位生成或关联简历/ })).toHaveAttribute(
      "href",
      "/resumes",
    );
  });

  it("全完成（示例数据口径）：没有 CTA，已完成标记出现", () => {
    renderPanel(
      statsWith({ job_count: 6, resume_count: 3, claim_count: 12, resume_with_job_count: 2 }),
    );
    expect(screen.getAllByText("已完成")).toHaveLength(3);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
