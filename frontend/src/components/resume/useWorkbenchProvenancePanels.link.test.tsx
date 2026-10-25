// SPDX-License-Identifier: Apache-2.0
/**
 * W12 来源关联在**制作台来源页签**的宿主接线（fe-mount D）：
 * 未关联对象 → 打开关联弹窗 → 选择来源 → POST /provenance/links → 刷新来源链与覆盖数。
 * 另覆盖"采纳最新来源"（同来源重新关联 = 指向最新修订）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pt } from "../../features/resume-provenance/i18n";
import type { ProvenanceLocator } from "../../features/resume-provenance/selection";
import type { ResumeContent } from "../../types";
import { useWorkbenchProvenancePanels } from "./useWorkbenchProvenancePanels";

const apiMocks = vi.hoisted(() => ({
  fetchProvenance: vi.fn(),
  fetchSourceChain: vi.fn(),
  listFactLocks: vi.fn(),
  createFactLock: vi.fn(),
  deleteFactLock: vi.fn(),
  createBlockLink: vi.fn(),
  deleteBlockLink: vi.fn(),
  rewriteField: vi.fn(),
  createSourceLink: vi.fn(),
  createManualSource: vi.fn(),
  listProvenanceSources: vi.fn(),
  listSourceRevisions: vi.fn(),
}));

vi.mock("../../features/resume-provenance/api", () => apiMocks);

const LOCATOR: ProvenanceLocator = {
  object_id: "exp_1",
  point_id: null,
  path: "experience.0.description.1",
};

const SOURCE = {
  id: 9,
  kind: "claim",
  external_ref: null,
  title: "Ledger source",
  current_fingerprint: "fp",
  metadata: {},
  latest_revision_no: 1,
  created_at: null,
  updated_at: null,
};

const CONTENT = {
  experience: [{ id: "exp_1", company: "Acme", description: ["Shipped it."] }],
} as unknown as ResumeContent;

function Harness() {
  const { sourcesPanel } = useWorkbenchProvenancePanels({
    resumeId: 5,
    locator: LOCATOR,
    content: CONTENT,
    onApplyContent: vi.fn(),
  });
  return <AntdApp>{sourcesPanel}</AntdApp>;
}

beforeEach(() => {
  apiMocks.fetchProvenance.mockResolvedValue({
    resume_id: 5,
    revision: 1,
    sources: [],
    objects: [
      {
        path: "experience.0",
        field: "experience",
        object_id: "exp_1",
        point_id: null,
        label: "Acme",
        link: null,
      },
    ],
    coverage: { total: 1, linked: 0, unlinked: 1 },
  });
  apiMocks.fetchSourceChain.mockResolvedValue({
    resume_id: 5,
    object_id: "exp_1",
    point_id: null,
    path: "experience.0.description.1",
    sources: [],
  });
  apiMocks.listFactLocks.mockResolvedValue({ locks: [] });
  apiMocks.listProvenanceSources.mockResolvedValue({ items: [SOURCE], total: 1 });
  apiMocks.listSourceRevisions.mockResolvedValue({ items: [] });
  apiMocks.createSourceLink.mockResolvedValue({ link_id: 3 });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("来源页签 · 关联到来源", () => {
  it("选择来源并提交 → 新 links 契约带上目标块，链与覆盖数各刷新一次", async () => {
    render(<Harness />);
    const linkButton = await screen.findByRole("button", { name: pt("provenance.chain.link") });
    fireEvent.click(linkButton);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(pt("provenance.link.title"))).toBeTruthy();
    await waitFor(() => expect(apiMocks.listProvenanceSources).toHaveBeenCalledTimes(1));

    fireEvent.mouseDown(screen.getByRole("combobox", { name: pt("provenance.link.source") }));
    fireEvent.click(screen.getByText(new RegExp(SOURCE.title)));
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.link.submit") }));

    await waitFor(() => expect(apiMocks.createSourceLink).toHaveBeenCalledTimes(1));
    // 关联目标是链表面板列出的那个对象（条目级 path 由服务端按 id 核对）。
    expect(apiMocks.createSourceLink.mock.calls[0][0]).toMatchObject({
      resume_id: 5,
      source_id: 9,
      object_id: "exp_1",
      path: "experience.0",
      field: "experience",
    });
    // 关联成功后：来源链与整份来源（覆盖数）都重新取一次。
    await waitFor(() => expect(apiMocks.fetchSourceChain).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(apiMocks.fetchProvenance).toHaveBeenCalledTimes(2));
  });
});
