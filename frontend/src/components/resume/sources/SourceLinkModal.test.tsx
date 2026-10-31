// SPDX-License-Identifier: Apache-2.0
/** W12 关联弹窗：来源列表、选择来源/修订、手工来源、提交新 links 契约、空目标禁用。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pt } from "../../../features/resume-provenance/i18n";
import SourceLinkModal from "./SourceLinkModal";

const apiMocks = vi.hoisted(() => ({
  listProvenanceSources: vi.fn(),
  createManualSource: vi.fn(),
  listSourceRevisions: vi.fn(),
  createSourceLink: vi.fn(),
}));
vi.mock("../../../features/resume-provenance/api", () => apiMocks);

const SOURCE = {
  id: 9,
  kind: "claim",
  external_ref: null,
  title: "台账来源",
  current_fingerprint: "fp",
  metadata: {},
  latest_revision_no: 2,
  created_at: null,
  updated_at: null,
};

beforeEach(() => {
  apiMocks.listProvenanceSources.mockResolvedValue({ items: [SOURCE], total: 1 });
  apiMocks.listSourceRevisions.mockResolvedValue({
    source_id: 9,
    revisions: [{ id: 11, revision_no: 2, summary: "来源摘要", captured_at: null }],
  });
  apiMocks.createManualSource.mockResolvedValue({
    id: 12,
    kind: "manual",
    title: "手工来源",
    revision: { id: 99, revision_no: 1, summary: "手工来源", captured_at: null },
  });
  apiMocks.createSourceLink.mockResolvedValue({ link_id: 3 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderModal(overrides: Partial<React.ComponentProps<typeof SourceLinkModal>> = {}) {
  const onLinked = vi.fn();
  const onClose = vi.fn();
  render(
    <AntdApp>
      <SourceLinkModal
        open
        resumeId={5}
        target={{ object_id: "exp_1", path: "experience.0.company" }}
        onClose={onClose}
        onLinked={onLinked}
        {...overrides}
      />
    </AntdApp>,
  );
  return { onLinked, onClose };
}

describe("SourceLinkModal", () => {
  it("选择已有来源并按新契约提交 source_id + 目标块", async () => {
    const { onLinked, onClose } = renderModal();
    expect(await screen.findByText(pt("provenance.link.title"))).toBeTruthy();
    await waitFor(() => expect(apiMocks.listProvenanceSources).toHaveBeenCalledTimes(1));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: pt("provenance.link.source") }));
    fireEvent.click(screen.getByText(new RegExp(SOURCE.title)));
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.link.submit") }));
    await waitFor(() => expect(apiMocks.createSourceLink).toHaveBeenCalledTimes(1));
    expect(apiMocks.createSourceLink.mock.calls[0][0]).toEqual({
      resume_id: 5,
      source_id: 9,
      object_id: "exp_1",
      path: "experience.0.company",
    });
    expect(onLinked).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("没有可复用来源时可只填标题新建（旧请求形态：kind=manual、不带新字段）", async () => {
    apiMocks.listProvenanceSources.mockResolvedValue({ items: [], total: 0 });
    renderModal();
    expect(await screen.findByText(pt("provenance.link.noSources"))).toBeTruthy();
    fireEvent.change(screen.getByLabelText(pt("provenance.link.sourceTitle")), {
      target: { value: "手工来源" },
    });
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.link.mode.new") }));
    await waitFor(() =>
      expect(apiMocks.createManualSource).toHaveBeenCalledWith({
        title: "手工来源",
        kind: "manual",
        external_ref: null,
        payload: null,
      }),
    );
  });

  it("新建来源可填类型/外部引用/原文摘要，提交时一起打包（P5-1）", async () => {
    apiMocks.listProvenanceSources.mockResolvedValue({ items: [], total: 0 });
    apiMocks.createManualSource.mockResolvedValue({
      id: 13,
      kind: "material",
      external_ref: "material:doc-1",
      title: "资料箱原文",
      revision: { id: 98, revision_no: 1, summary: "资料箱原文", captured_at: null },
    });
    renderModal();
    await screen.findByText(pt("provenance.link.noSources"));
    fireEvent.mouseDown(screen.getByLabelText(pt("provenance.link.kind")));
    fireEvent.click(await screen.findByText(pt("provenance.source.kind.material")));
    fireEvent.change(screen.getByLabelText(pt("provenance.link.sourceTitle")), {
      target: { value: "资料箱原文" },
    });
    fireEvent.change(screen.getByLabelText(pt("provenance.link.externalRef")), {
      target: { value: " material:doc-1 " },
    });
    fireEvent.change(screen.getByLabelText(pt("provenance.link.payload")), {
      target: { value: "原始项目描述" },
    });
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.link.mode.new") }));
    await waitFor(() =>
      expect(apiMocks.createManualSource).toHaveBeenCalledWith({
        title: "资料箱原文",
        kind: "material",
        external_ref: "material:doc-1",
        payload: "原始项目描述",
      }),
    );
    void waitFor;
  });

  it("打开时预选指定来源（P5-2 重新关联），目标块仍需用户自己选", async () => {
    renderModal({ initialSourceId: 9 });
    // antd Select 的已选值渲染在 .ant-select-content（title 为完整标签），输入框的 aria-label 不带值。
    expect(
      await screen.findByTitle(SOURCE.title + " · " + pt("provenance.source.kind.claim")),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.link.submit") }));
    await waitFor(() => expect(apiMocks.createSourceLink).toHaveBeenCalledTimes(1));
    expect(apiMocks.createSourceLink.mock.calls[0][0]).toMatchObject({
      resume_id: 5,
      source_id: 9,
      path: "experience.0.company",
    });
  });

  it("没有目标块时提交禁用（不让空定位发出请求）", async () => {
    renderModal({ target: null });
    expect(await screen.findByText(pt("provenance.link.title"))).toBeTruthy();
    const submit = screen.getByRole("button", {
      name: pt("provenance.link.submit"),
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});
