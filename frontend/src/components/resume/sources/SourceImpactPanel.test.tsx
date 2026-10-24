// SPDX-License-Identifier: Apache-2.0
/** 来源更新影响面：行列表、采纳=重链、保持原稿=本地标记、解除与失败。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../api/client";
import { pt } from "../../../features/resume-provenance/i18n";
import SourceImpactPanel from "./SourceImpactPanel";

const apiMocks = vi.hoisted(() => ({
  fetchSourceImpact: vi.fn(),
  fetchSource: vi.fn(),
  createBlockLink: vi.fn(),
  deleteBlockLink: vi.fn(),
}));
vi.mock("../../../features/resume-provenance/api", () => apiMocks);

const IMPACT = {
  source_id: 9,
  kind: "claim",
  title: "事实台账·云商科技",
  current_fingerprint: "fp-2",
  stale_count: 1,
  affected: [
    {
      resume_id: 5,
      resume_title: "Backend Engineer Resume",
      link_id: 71,
      source_id: 9,
      object_id: "exp_1",
      point_id: null,
      path: "experience.0.company",
      field: "company",
      linked_fingerprint: "fp-1",
      current_fingerprint: "fp-2",
      stale: true,
      resume_deleted: false,
    },
  ],
};

beforeEach(() => {
  apiMocks.fetchSourceImpact.mockResolvedValue(IMPACT);
  apiMocks.fetchSource.mockResolvedValue({
    id: 9,
    kind: "claim",
    external_ref: "claim:12",
    title: "事实台账·云商科技",
    current_fingerprint: "fp-2",
    latest_revision_no: 2,
    revisions: [],
    blocks: [],
  });
  apiMocks.createBlockLink.mockResolvedValue({});
  apiMocks.deleteBlockLink.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPanel(overrides: Partial<React.ComponentProps<typeof SourceImpactPanel>> = {}) {
  const onAdopted = vi.fn();
  render(
    <AntdApp>
      <SourceImpactPanel sourceId={9} revision={2} onAdopted={onAdopted} {...overrides} />
    </AntdApp>,
  );
  return { onAdopted };
}

describe("SourceImpactPanel", () => {
  it("加载真实影响面：受影响简历与路径逐条列出", async () => {
    renderPanel();
    expect(await screen.findByText("Backend Engineer Resume")).toBeTruthy();
    expect(apiMocks.fetchSourceImpact).toHaveBeenCalledWith(9);
  });

  it("采纳最新：用来源描述重链到最新修订（path/object_id 原样带上），并回调宿主", async () => {
    const { onAdopted } = renderPanel();
    await screen.findByText("Backend Engineer Resume");
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.impact.adopt") }));
    await waitFor(() => expect(apiMocks.createBlockLink).toHaveBeenCalledTimes(1));
    expect(apiMocks.createBlockLink.mock.calls[0][0]).toBe(5);
    expect(apiMocks.createBlockLink.mock.calls[0][1]).toMatchObject({
      path: "experience.0.company",
      object_id: "exp_1",
      field: "company",
      source: { kind: "claim", external_ref: "claim:12" },
    });
    await waitFor(() => expect(onAdopted).toHaveBeenCalledWith(["experience.0.company"]));
  });

  it("保持原稿只是本地标记：不发任何写请求", async () => {
    renderPanel();
    await screen.findByText("Backend Engineer Resume");
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.impact.keep") }));
    expect(apiMocks.createBlockLink).not.toHaveBeenCalled();
    expect(apiMocks.deleteBlockLink).not.toHaveBeenCalled();
    expect(apiMocks.fetchSource).not.toHaveBeenCalled();
  });

  it("解除关联：调用 deleteBlockLink 后重新拉影响面", async () => {
    renderPanel();
    await screen.findByText("Backend Engineer Resume");
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.chain.unlink") }));
    await waitFor(() => expect(apiMocks.deleteBlockLink).toHaveBeenCalledWith(5, 71));
    await waitFor(() => expect(apiMocks.fetchSourceImpact).toHaveBeenCalledTimes(2));
  });

  it("采纳失败（409 版本冲突）：提示刷新后重试，不假装成功", async () => {
    apiMocks.createBlockLink.mockRejectedValue(
      new ApiError("conflict", 409, { businessCode: "resume_revision_conflict" }),
    );
    const { onAdopted } = renderPanel();
    await screen.findByText("Backend Engineer Resume");
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.impact.adopt") }));
    expect(await screen.findByText(pt("provenance.impact.revisionConflict"))).toBeTruthy();
    expect(onAdopted).not.toHaveBeenCalled();
  });
});
