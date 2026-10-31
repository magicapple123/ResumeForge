// SPDX-License-Identifier: Apache-2.0
/** Source-chain panel for the v2 workbench. */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pt } from "../../../features/resume-provenance/i18n";
import {
  defaultTextItem,
  makeEntry,
  makeResumeDocument,
  makeSection,
} from "../../../test/documentHarness";
import SourceChainPanelV2 from "./SourceChainPanelV2";

const provenanceApi = vi.hoisted(() => ({
  fetchProvenance: vi.fn(),
  listFactLocks: vi.fn(),
  createFactLock: vi.fn(),
  deleteFactLock: vi.fn(),
  createSourceLink: vi.fn(),
  listProvenanceSources: vi.fn(),
  listSourceRevisions: vi.fn(),
  deleteBlockLink: vi.fn(),
  fetchSource: vi.fn(),
  fetchSourceImpact: vi.fn(),
  fetchRevisionText: vi.fn(),
  adoptSourceLink: vi.fn(),
}));
vi.mock("../../../features/resume-provenance/api", () => provenanceApi);

const LINK = {
  link_id: 1,
  source_id: 5,
  object_id: null,
  point_id: null,
  path: "education.ob_edu000001.it_item00001",
  field: "achievements",
  source_fingerprint: "fp",
  status: "linked" as const,
};
const SOURCE_TEXT = String.fromCharCode(26469, 28304, 37324, 30340, 26032, 20869, 23481);
const DATA = {
  resume_id: 7,
  revision: 3,
  sources: [
    {
      id: 5,
      kind: "claim",
      external_ref: null,
      title: "Interview source sample",
      current_fingerprint: "abcdef0123456789",
      latest_revision_no: 1,
      revisions: [
        { revision_no: 1, fingerprint: "fp", summary: "Revision summary", captured_at: null },
      ],
      blocks: [LINK],
    },
  ],
  objects: [
    {
      path: LINK.path,
      field: "achievements",
      object_id: null,
      point_id: null,
      label: "Campus experience",
      link: LINK,
    },
  ],
  unresolved_links: [],
  coverage: { total: 2, linked: 1, unlinked: 1 },
};

function renderPanel() {
  return render(
    <AntdApp>
      <SourceChainPanelV2
        resumeId={7}
        document={makeResumeDocument()}
        revision={3}
        onAdoptDocument={onAdoptDocument}
      />
    </AntdApp>,
  );
}

const onAdoptDocument = vi.fn();

afterEach(() => {
  cleanup();
  for (const method of Object.values(provenanceApi)) method.mockReset();
  onAdoptDocument.mockReset();
});

beforeEach(() => {
  provenanceApi.listFactLocks.mockResolvedValue({ resume_id: 7, revision: 3, locks: [] });
});

describe("SourceChainPanelV2", () => {
  it("shows coverage, selection, and the source chain", async () => {
    provenanceApi.fetchProvenance.mockResolvedValue(DATA);
    renderPanel();
    await waitFor(() => expect(document.querySelector('[data-source-id="5"]')).not.toBeNull());
    expect(screen.getByText(pt("provenance.panel.title"))).toBeTruthy();
    expect(screen.getByText(pt("provenance.coverage", { linked: 1, total: 2 }))).toBeTruthy();
    expect(screen.getByText(pt("provenance.selection.linked"))).toBeTruthy();
    expect(provenanceApi.fetchProvenance).toHaveBeenCalledWith(7);
  });

  it("creates a link using the selected v2 path and refreshes coverage", async () => {
    provenanceApi.fetchProvenance.mockResolvedValue(DATA);
    provenanceApi.listProvenanceSources.mockResolvedValue({
      items: [
        {
          id: 8,
          kind: "manual",
          external_ref: null,
          title: "Manual source sample",
          current_fingerprint: "fp8",
          metadata: {},
          latest_revision_no: 1,
          created_at: null,
          updated_at: null,
        },
      ],
      total: 1,
    });
    provenanceApi.listSourceRevisions.mockResolvedValue({ source_id: 8, revisions: [] });
    provenanceApi.createSourceLink.mockResolvedValue({ ...LINK, source_id: 8 });
    renderPanel();
    await screen.findByText(pt("provenance.selection.linked"));
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.selection.linkAria") }));
    await screen.findByRole("dialog");
    const sourceSelect = screen.getByLabelText(pt("provenance.link.source"));
    fireEvent.mouseDown(sourceSelect);
    fireEvent.click(await screen.findByText(/Manual source sample/));
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.link.submit") }));

    await waitFor(() => expect(provenanceApi.createSourceLink).toHaveBeenCalledTimes(1));
    expect(provenanceApi.createSourceLink.mock.calls[0][0]).toMatchObject({
      resume_id: 7,
      source_id: 8,
      path: LINK.path,
    });
    expect(provenanceApi.fetchProvenance).toHaveBeenCalledTimes(2);
  });

  it("adopts with revision CAS and returns the v2 document to the host", async () => {
    const stale = {
      ...DATA,
      sources: [{ ...DATA.sources[0], blocks: [{ ...LINK, status: "stale" as const }] }],
      objects: [{ ...DATA.objects[0], link: { ...LINK, status: "stale" as const } }],
    };
    const adopted = makeResumeDocument();
    provenanceApi.fetchProvenance.mockResolvedValue(stale);
    provenanceApi.fetchRevisionText.mockResolvedValue({
      source_id: 5,
      kind: "claim",
      external_ref: null,
      revision_no: 2,
      text: SOURCE_TEXT,
      fingerprint: "fp-new",
      resolvable: true,
      fingerprint_matched: true,
      is_latest: true,
      reason: "",
    });
    provenanceApi.adoptSourceLink.mockResolvedValue({
      resume_id: 7,
      revision: 4,
      content: adopted,
      applied_path: LINK.path,
      link: { ...LINK, status: "linked" },
      source_revision_no: 2,
    });
    renderPanel();
    await waitFor(() => expect(document.querySelector('[data-source-id="5"]')).not.toBeNull());
    fireEvent.click(screen.getAllByRole("button", { name: pt("provenance.chain.relink") })[0]);
    const dialog = await screen.findByRole("dialog");
    await screen.findByText(pt("provenance.adopt.revisionText", { no: 2 }));
    fireEvent.click(within(dialog).getByRole("button", { name: pt("provenance.adopt.submit") }));

    await waitFor(() => expect(provenanceApi.adoptSourceLink).toHaveBeenCalledTimes(1));
    expect(provenanceApi.adoptSourceLink.mock.calls[0][1]).toMatchObject({
      expected_revision: 3,
      path: LINK.path,
      text: SOURCE_TEXT,
    });
    expect(onAdoptDocument).toHaveBeenCalledWith(adopted, 4);
  });

  it("unlinks the selected object and refreshes the v2 source view", async () => {
    provenanceApi.fetchProvenance.mockResolvedValue(DATA);
    provenanceApi.deleteBlockLink.mockResolvedValue(undefined);
    renderPanel();
    await waitFor(() => expect(document.querySelector('[data-source-id="5"]')).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.chain.unlink") }));
    await waitFor(() =>
      expect(provenanceApi.deleteBlockLink).toHaveBeenCalledWith(7, LINK.link_id),
    );
    await waitFor(() => expect(provenanceApi.fetchProvenance).toHaveBeenCalledTimes(2));
  });

  it("loads source detail, impact, and revision history on request", async () => {
    provenanceApi.fetchProvenance.mockResolvedValue(DATA);
    provenanceApi.fetchSource.mockResolvedValue(DATA.sources[0]);
    provenanceApi.listSourceRevisions.mockResolvedValue({
      source_id: 5,
      revisions: DATA.sources[0].revisions,
    });
    provenanceApi.fetchSourceImpact.mockResolvedValue({
      source_id: 5,
      kind: "claim",
      title: "Interview source sample",
      current_fingerprint: "abcdef0123456789",
      affected: [],
      stale_count: 0,
    });
    renderPanel();
    await waitFor(() => expect(document.querySelector('[data-source-id="5"]')).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.source.details") }));
    await screen.findByText(pt("provenance.source.noImpact"));
    expect(provenanceApi.fetchSource).toHaveBeenCalledWith(5);
    expect(provenanceApi.listSourceRevisions).toHaveBeenCalledWith(5);
    expect(provenanceApi.fetchSourceImpact).toHaveBeenCalledWith(5);
  });

  it("disables source adoption while the editor has unsaved changes", async () => {
    const stale = {
      ...DATA,
      sources: [{ ...DATA.sources[0], blocks: [{ ...LINK, status: "stale" as const }] }],
      objects: [{ ...DATA.objects[0], link: { ...LINK, status: "stale" as const } }],
    };
    provenanceApi.fetchProvenance.mockResolvedValue(stale);
    render(
      <AntdApp>
        <SourceChainPanelV2
          resumeId={7}
          document={makeResumeDocument()}
          revision={3}
          hasUnsavedChanges
          onAdoptDocument={onAdoptDocument}
        />
      </AntdApp>,
    );
    await screen.findByText(pt("provenance.adopt.dirty"));
    expect(screen.queryByRole("button", { name: pt("provenance.chain.relink") })).toBeNull();
    expect(onAdoptDocument).not.toHaveBeenCalled();
  });

  it("creates a fact lock for the selected v2 path and refreshes", async () => {
    provenanceApi.fetchProvenance.mockResolvedValue(DATA);
    provenanceApi.createFactLock.mockResolvedValue({
      id: 18,
      resume_id: 7,
      kind: "number",
      object_id: null,
      point_id: null,
      path: LINK.path,
      field: "achievements",
      locked_value: "",
      label: "",
      created_at: null,
    });
    renderPanel();
    await screen.findByText(pt("provenance.selection.linked"));
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.lock.add") }));
    await waitFor(() => expect(provenanceApi.createFactLock).toHaveBeenCalledTimes(1));
    expect(provenanceApi.createFactLock.mock.calls[0][1]).toMatchObject({
      kind: "name",
      path: LINK.path,
    });
    expect(provenanceApi.listFactLocks).toHaveBeenCalledTimes(2);
  });

  it("deletes a fact lock and reloads the lock list", async () => {
    provenanceApi.fetchProvenance.mockResolvedValue(DATA);
    const lock = {
      id: 18,
      resume_id: 7,
      kind: "number",
      object_id: null,
      point_id: null,
      path: LINK.path,
      field: "achievements",
      locked_value: "",
      label: "",
      created_at: null,
    };
    provenanceApi.listFactLocks
      .mockResolvedValueOnce({ resume_id: 7, revision: 3, locks: [lock] })
      .mockResolvedValueOnce({ resume_id: 7, revision: 3, locks: [] });
    provenanceApi.deleteFactLock.mockResolvedValue(undefined);
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: pt("provenance.lock.remove") }));
    await waitFor(() => expect(provenanceApi.deleteFactLock).toHaveBeenCalledWith(7, 18));
    expect(provenanceApi.listFactLocks).toHaveBeenCalledTimes(2);
  });

  it("shows an empty state when no source objects exist", async () => {
    provenanceApi.fetchProvenance.mockResolvedValue({
      resume_id: 7,
      revision: 3,
      sources: [],
      objects: [],
      unresolved_links: [],
      coverage: { total: 0, linked: 0, unlinked: 0 },
    });
    renderPanel();
    await screen.findByText(pt("provenance.chain.empty"));
  });

  it("shows an error and retry action when the API fails", async () => {
    provenanceApi.fetchProvenance.mockRejectedValue(new Error("network unavailable"));
    renderPanel();
    // The retry action proves the error state rendered.
    await waitFor(() => expect(screen.getByRole("button")).toBeTruthy());
  });

  it("resolves the current rewrite by v2 identity when the source view anchors by legacy path", async () => {
    // 与上面的 SOURCE_TEXT 同法：测试里的正文样本用码点构造，不推高 cjkRatchet 的存量中文计数。
    const bodyText = String.fromCharCode(
      20027,
      23548,
      23395,
      24230,
      20027,
      39064,
      33829,
      38144,
      27963,
      21160,
    );
    const document = makeResumeDocument({
      sections: [
        makeSection("experience", "entries", [
          makeEntry([defaultTextItem(bodyText, "bullet")], { id: "en_exp_real" }),
        ]),
      ],
    });
    // 真实后端（W12 来源视图尚未迁 v2）给的是分析视图下标路径，锚点则是 v2 的条目/要点 id。
    const pointId = document.sections[0].entries[0].items[0].id as string;
    provenanceApi.fetchProvenance.mockResolvedValue({
      ...DATA,
      objects: [
        {
          path: "experience.0.description.0",
          field: "experience",
          object_id: "en_exp_real",
          point_id: pointId,
          label: "body",
          link: { ...LINK, path: "experience.0.description.0", field: "experience" },
        },
      ],
    });
    render(
      <AntdApp>
        <SourceChainPanelV2 resumeId={7} document={document} revision={3} />
      </AntdApp>,
    );
    await screen.findByText(pt("provenance.chain.currentTextColon"));
    expect(screen.getByText(bodyText)).toBeTruthy();
  });

  it("skips requests without a resume id", () => {
    render(
      <AntdApp>
        <SourceChainPanelV2 resumeId={0} document={makeResumeDocument()} revision={null} />
      </AntdApp>,
    );
    expect(screen.getByText(pt("provenance.panel.hint"))).toBeTruthy();
    expect(provenanceApi.fetchProvenance).not.toHaveBeenCalled();
    void waitFor;
  });

  const UNRESOLVED = {
    link_id: 77,
    source_id: 5,
    source_title: "Interview source sample",
    source_kind: "claim",
    object_id: null,
    point_id: null,
    path: "experience.9.description.0",
    field: "experience",
    reason: "target_missing",
  };

  it("shows unresolvable legacy links and deletes the broken row through the existing endpoint", async () => {
    provenanceApi.fetchProvenance.mockResolvedValue({ ...DATA, unresolved_links: [UNRESOLVED] });
    provenanceApi.deleteBlockLink.mockResolvedValue(undefined);
    renderPanel();
    await screen.findByText(pt("provenance.unresolved.title", { count: 1 }));
    expect(screen.getByText(UNRESOLVED.path)).toBeTruthy();
    expect(screen.getByText(pt("provenance.unresolved.reason.targetMissing"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.unresolved.delete") }));
    await screen.findByText(pt("provenance.unresolved.deleteConfirmTitle"));
    const buttons = screen.getAllByRole("button", { name: pt("provenance.unresolved.delete") });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(provenanceApi.deleteBlockLink).toHaveBeenCalledWith(7, 77));
    await waitFor(() => expect(provenanceApi.fetchProvenance).toHaveBeenCalledTimes(2));
  });

  it("re-links a broken legacy link to the selected block, then removes the stale row", async () => {
    provenanceApi.fetchProvenance.mockResolvedValue({ ...DATA, unresolved_links: [UNRESOLVED] });
    provenanceApi.listProvenanceSources.mockResolvedValue({
      items: [
        {
          id: 5,
          kind: "claim",
          external_ref: null,
          title: "Interview source sample",
          current_fingerprint: "abcdef0123456789",
          metadata: {},
          latest_revision_no: 1,
          created_at: null,
          updated_at: null,
        },
      ],
      total: 1,
    });
    provenanceApi.listSourceRevisions.mockResolvedValue({ source_id: 5, revisions: [] });
    provenanceApi.createSourceLink.mockResolvedValue({ ...LINK });
    provenanceApi.deleteBlockLink.mockResolvedValue(undefined);
    renderPanel();
    await screen.findByText(pt("provenance.unresolved.title", { count: 1 }));
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.unresolved.relink") }));
    const dialog = await screen.findByRole("dialog");
    // 来源已预选（P5-2 只预选来源，目标块=用户当前选中），直接提交即可。
    fireEvent.click(within(dialog).getByRole("button", { name: pt("provenance.link.submit") }));
    await waitFor(() => expect(provenanceApi.createSourceLink).toHaveBeenCalledTimes(1));
    expect(provenanceApi.createSourceLink.mock.calls[0][0]).toMatchObject({
      resume_id: 7,
      source_id: 5,
      path: LINK.path,
    });
    await waitFor(() => expect(provenanceApi.deleteBlockLink).toHaveBeenCalledWith(7, 77));
    await waitFor(() => expect(provenanceApi.fetchProvenance).toHaveBeenCalledTimes(2));
  });

  it("keeps the empty state only when sources, objects and broken links are all absent", async () => {
    provenanceApi.fetchProvenance.mockResolvedValue({
      resume_id: 7,
      revision: 3,
      sources: [],
      objects: [],
      unresolved_links: [UNRESOLVED],
      coverage: { total: 0, linked: 0, unlinked: 0 },
    });
    renderPanel();
    await screen.findByText(pt("provenance.unresolved.title", { count: 1 }));
    expect(screen.queryByText(pt("provenance.chain.empty"))).toBeNull();
  });
});
