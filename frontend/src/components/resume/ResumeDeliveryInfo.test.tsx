/** PR-09：ResumeDeliveryInfo 的三态语义区分与错误态（失败 ≠ 暂无投递记录）。 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeliverySummary } from "../../types";

const listResumeDeliveries = vi.fn();
vi.mock("../../api/resumes", () => ({
  listResumeDeliveries: (...args: unknown[]) => listResumeDeliveries(...args),
}));

import ResumeDeliveryInfo from "./ResumeDeliveryInfo";

afterEach(() => {
  cleanup();
  listResumeDeliveries.mockReset();
});

function delivery(overrides: Partial<DeliverySummary>): DeliverySummary {
  return {
    id: 1,
    created_at: "2026-10-13T08:00:00Z",
    source: "apply",
    job_title: "后端开发",
    company: "示例科技",
    resume_title: "后端岗位简历",
    export_format: "",
    filename: "",
    pages: null,
    content_sha256: "abcd1234" + "0".repeat(56),
    rendered_config_sha256: "f".repeat(64),
    ...overrides,
  };
}

describe("ResumeDeliveryInfo", () => {
  it("apply 来源显示「已投递给」（唯一代表真实投递）", async () => {
    listResumeDeliveries.mockResolvedValue([delivery({})]);
    render(<ResumeDeliveryInfo recordId={1} parentRevisionId={null} />);
    await waitFor(() => expect(screen.getByText(/已投递给\s*示例科技/)).toBeTruthy());
  });

  it("track 来源显示「进度关联」，并明确不是投递台发送", async () => {
    listResumeDeliveries.mockResolvedValue([delivery({ source: "track" })]);
    render(<ResumeDeliveryInfo recordId={1} parentRevisionId={null} />);
    await waitFor(() => expect(screen.getByText(/进度关联：\s*示例科技/)).toBeTruthy());
    expect(screen.getByText(/手工关联，非投递台发送/)).toBeTruthy();
  });

  it("export 来源显示「导出存档」，并明确不代表已实际发送", async () => {
    listResumeDeliveries.mockResolvedValue([
      delivery({ source: "export", export_format: "pdf", filename: "简历.pdf" }),
    ]);
    render(<ResumeDeliveryInfo recordId={1} parentRevisionId={null} />);
    await waitFor(() => expect(screen.getByText(/导出存档：\s*示例科技/)).toBeTruthy());
    expect(screen.getByText(/不代表已实际发送/)).toBeTruthy();
  });

  it("旧快照目的地为空时显示「目的地未记录」，不编造", async () => {
    listResumeDeliveries.mockResolvedValue([delivery({ company: "", job_title: "" })]);
    render(<ResumeDeliveryInfo recordId={1} parentRevisionId={null} />);
    await waitFor(() => expect(screen.getByText(/目的地未记录/)).toBeTruthy());
  });

  it("请求失败显示错误态 + 重试，而不是「暂无投递记录」", async () => {
    listResumeDeliveries.mockRejectedValue(new Error("network down"));
    render(<ResumeDeliveryInfo recordId={1} parentRevisionId={null} />);
    await waitFor(() => expect(screen.getByText(/投递记录加载失败/)).toBeTruthy());
    expect(screen.queryByText(/独立版本，暂无投递记录/)).toBeNull();

    // 重试成功后错误态消失、记录展示。
    listResumeDeliveries.mockResolvedValue([delivery({})]);
    fireEvent.click(screen.getByTestId("delivery-retry"));
    await waitFor(() => expect(screen.queryByText(/加载失败/)).toBeNull());
    expect(screen.getByText(/已投递给\s*示例科技/)).toBeTruthy();
  });

  it("确实没有记录时才显示「独立版本，暂无投递记录」", async () => {
    listResumeDeliveries.mockResolvedValue([]);
    render(<ResumeDeliveryInfo recordId={1} parentRevisionId={null} />);
    await waitFor(() => expect(screen.getByText(/独立版本，暂无投递记录/)).toBeTruthy());
  });
});
