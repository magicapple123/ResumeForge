// SPDX-License-Identifier: Apache-2.0
/** PR-09：ResumeDeliveryInfo 的三态语义区分与错误态（失败 ≠ 暂无投递记录）。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeliverySummary } from "../../types";

const listResumeDeliveries = vi.fn();
const downloadDelivery = vi.fn();
vi.mock("../../api/resumes", () => ({
  listResumeDeliveries: (...args: unknown[]) => listResumeDeliveries(...args),
  downloadDelivery: (...args: unknown[]) => downloadDelivery(...args),
}));

const downloadBlob = vi.fn();
vi.mock("../../utils/download", () => ({
  downloadBlob: (...args: unknown[]) => downloadBlob(...args),
}));

import ResumeDeliveryInfo from "./ResumeDeliveryInfo";

afterEach(() => {
  cleanup();
  listResumeDeliveries.mockReset();
  downloadDelivery.mockReset();
  downloadBlob.mockReset();
});

// antd 的 message/modal 需要 <App> 提供 context（组件用 App.useApp() 取它们）。
function renderInfo(recordId = 1, parentRevisionId: number | null = null) {
  return render(
    <AntdApp>
      <ResumeDeliveryInfo recordId={recordId} parentRevisionId={parentRevisionId} />
    </AntdApp>,
  );
}

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
    renderInfo();
    await waitFor(() => expect(screen.getByText(/已投递给\s*示例科技/)).toBeTruthy());
  });

  it("track 来源显示「进度关联」，并明确不是投递台发送", async () => {
    listResumeDeliveries.mockResolvedValue([delivery({ source: "track" })]);
    renderInfo();
    await waitFor(() => expect(screen.getByText(/进度关联：\s*示例科技/)).toBeTruthy());
    expect(screen.getByText(/手工关联，非投递台发送/)).toBeTruthy();
  });

  it("export 来源显示「导出存档」，并明确不代表已实际发送", async () => {
    listResumeDeliveries.mockResolvedValue([
      delivery({ source: "export", export_format: "pdf", filename: "简历.pdf" }),
    ]);
    renderInfo();
    await waitFor(() => expect(screen.getByText(/导出存档：\s*示例科技/)).toBeTruthy());
    expect(screen.getByText(/不代表已实际发送/)).toBeTruthy();
  });

  it("旧快照目的地为空时显示「目的地未记录」，不编造", async () => {
    listResumeDeliveries.mockResolvedValue([delivery({ company: "", job_title: "" })]);
    renderInfo();
    await waitFor(() => expect(screen.getByText(/目的地未记录/)).toBeTruthy());
  });

  it("请求失败显示错误态 + 重试，而不是「暂无投递记录」", async () => {
    listResumeDeliveries.mockRejectedValue(new Error("network down"));
    renderInfo();
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
    renderInfo();
    await waitFor(() => expect(screen.getByText(/独立版本，暂无投递记录/)).toBeTruthy());
  });

  // ===== RR-04：存档下载可触达，且重放语义如实说明 =====

  it("每条交付记录都能下载存档（原简历删掉后也拿得到证据）", async () => {
    listResumeDeliveries.mockResolvedValue([delivery({ id: 7, export_format: "md" })]);
    downloadDelivery.mockResolvedValue({
      blob: new Blob(["md"]),
      filename: "resume.md",
      contentSha256: "a".repeat(64),
      artifactSha256: "a".repeat(64),
      replayed: true,
    });
    renderInfo();

    await waitFor(() => expect(screen.getByTestId("delivery-download-7")).toBeTruthy());
    fireEvent.click(screen.getByTestId("delivery-download-7"));

    await waitFor(() => expect(downloadDelivery).toHaveBeenCalledWith(7));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(downloadBlob.mock.calls[0][1] as string).toBe("resume.md");
    // 重放字节与历史指纹一致时不额外打扰用户。
    expect(screen.queryByText(/重新生成/)).toBeNull();
  });

  it("重放字节与历史指纹不一致时如实说明是重新生成的版本", async () => {
    listResumeDeliveries.mockResolvedValue([delivery({ id: 9, export_format: "html" })]);
    downloadDelivery.mockResolvedValue({
      blob: new Blob(["<html>"]),
      filename: "resume.html",
      contentSha256: "b".repeat(64),
      artifactSha256: "c".repeat(64),
      replayed: true,
    });
    renderInfo();

    await waitFor(() => expect(screen.getByTestId("delivery-download-9")).toBeTruthy());
    fireEvent.click(screen.getByTestId("delivery-download-9"));

    expect(await screen.findByText(/重新生成/)).toBeTruthy();
    expect(screen.getByText(/cccccccc/)).toBeTruthy();
  });
});
