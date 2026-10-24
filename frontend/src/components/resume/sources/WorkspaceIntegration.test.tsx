// SPDX-License-Identifier: Apache-2.0
/**
 * W12 真实集成（挂载级）：选中 locator → 来源链/事实锁/写作候选三条链路。
 *
 * 这里直接渲染 wb-core 的宿主 hook `useWorkbenchProvenancePanels`（它把三个面板装配在一起），
 * 验证的是"接线"而不是单个面板：locator 传给 chain API、事实锁新建带上定位、
 * 409 的 payload.violations 逐条进面板、未关联时不猜。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../api/client";
import { pt } from "../../../features/resume-provenance/i18n";
import type { ResumeContent } from "../../../types";
import { useWorkbenchProvenancePanels } from "../useWorkbenchProvenancePanels";
import type { ProvenanceLocator } from "../../../features/resume-provenance/selection";

const apiMocks = vi.hoisted(() => ({
  fetchProvenance: vi.fn(),
  fetchSourceChain: vi.fn(),
  listFactLocks: vi.fn(),
  createFactLock: vi.fn(),
  deleteFactLock: vi.fn(),
  createBlockLink: vi.fn(),
  deleteBlockLink: vi.fn(),
  rewriteField: vi.fn(),
}));
vi.mock("../../../features/resume-provenance/api", () => apiMocks);

const LOCATOR: ProvenanceLocator = {
  object_id: "exp_1",
  point_id: null,
  path: "experience.0.description.1",
};

const CONTENT: ResumeContent = {
  basic_info: { name: "张三" },
  summary: "负责后端服务开发。",
  experience: [
    { company: "云商科技", role: "后端工程师", description: ["把接口响应时间降了一半。"] },
  ],
} as unknown as ResumeContent;

function Harness({ onApplyContent }: { onApplyContent: (next: ResumeContent) => void }) {
  const { sourcesPanel } = useWorkbenchProvenancePanels({
    resumeId: 5,
    locator: LOCATOR,
    content: CONTENT,
    onApplyContent,
  });
  return <AntdApp>{sourcesPanel}</AntdApp>;
}

beforeEach(() => {
  apiMocks.fetchProvenance.mockResolvedValue({
    resume_id: 5,
    objects: [{ object_id: "exp_1", point_id: null, path: "experience.0", field: "experience" }],
    links: [],
  });
  apiMocks.listFactLocks.mockResolvedValue({ locks: [] });
  apiMocks.fetchSourceChain.mockResolvedValue({ sources: [], objects: [] });
  apiMocks.createFactLock.mockResolvedValue({ id: 1 });
  apiMocks.deleteFactLock.mockResolvedValue(undefined);
  apiMocks.deleteBlockLink.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("W12 来源面板集成", () => {
  it("挂载即拉整份来源与事实锁；chain 请求带上 locator；未关联不猜", async () => {
    render(<Harness onApplyContent={vi.fn()} />);
    await waitFor(() => expect(apiMocks.fetchSourceChain).toHaveBeenCalledTimes(1));
    expect(apiMocks.fetchProvenance).toHaveBeenCalledWith(5);
    expect(apiMocks.listFactLocks).toHaveBeenCalledWith(5);
    expect(apiMocks.fetchSourceChain).toHaveBeenCalledWith(5, {
      object_id: "exp_1",
      path: "experience.0.description.1",
    });
    expect(await screen.findByText(pt("provenance.unlinked"))).toBeTruthy();
  });

  it("事实锁新建：payload 带上当前定位（object_id + path）", async () => {
    render(<Harness onApplyContent={vi.fn()} />);
    await screen.findByText(pt("provenance.unlinked"));
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.lock.add") }));
    await waitFor(() => expect(apiMocks.createFactLock).toHaveBeenCalledTimes(1));
    expect(apiMocks.createFactLock.mock.calls[0][1]).toMatchObject({
      object_id: "exp_1",
      path: "experience.0.description.1",
    });
  });

  it("新建锁遇到 409：payload.violations 逐条展示（不是一句通用失败）", async () => {
    apiMocks.createFactLock.mockRejectedValue(
      new ApiError("conflict", 409, {
        businessCode: "fact_lock_conflict",
        payload: {
          code: "fact_lock_conflict",
          violations: [
            {
              lock_id: 9,
              kind: "institution",
              label: "company",
              path: "experience.0.company",
              field: "company",
              reason: "value changed",
              locked_value: "Cloud Commerce Ltd",
              current_value: "Cloud Commerce Limited",
            },
          ],
        },
      }),
    );
    render(<Harness onApplyContent={vi.fn()} />);
    await screen.findByText(pt("provenance.unlinked"));
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.lock.add") }));
    expect(await screen.findByText(pt("provenance.lock.violations"))).toBeTruthy();
    expect(
      await screen.findByText(
        pt("provenance.lock.violationLine", {
          label: "company",
          locked: "Cloud Commerce Ltd",
          current: "Cloud Commerce Limited",
        }),
      ),
    ).toBeTruthy();
  });
});
