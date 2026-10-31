// SPDX-License-Identifier: Apache-2.0
/**
 * V2 双语版本工作区：字段对照（v2 item 路径）/ 生成翻译候选 / 逐项采纳回调宿主 / 只读模式。
 *
 * 组件内部自己发请求，测试只 mock `features/resume-bilingual/api` 与字段目录 hook；
 * 断言的重点是「交给宿主的文档与 revision」以及「采纳提交的是 v2 item 路径」。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bt } from "../../../features/resume-bilingual/i18n";
import { MOCK_PRIMARY } from "../../../test/bilingualMock";
import type { ResumeDocument } from "../../../types/resumeDocument";
import type { ResumeLayout } from "../../../types";
import BilingualWorkspaceV2 from "./BilingualWorkspaceV2";

const apiMocks = vi.hoisted(() => ({
  listVariants: vi.fn(),
  getVariant: vi.fn(),
  createLanguageVariant: vi.fn(),
  translateVariant: vi.fn(),
  adoptTranslation: vi.fn(),
  fetchVariantExportInput: vi.fn(),
  patchVariantLayout: vi.fn(),
  listGlossaryTerms: vi.fn(),
  createGlossaryTerm: vi.fn(),
  updateGlossaryTerm: vi.fn(),
  deleteGlossaryTerm: vi.fn(),
}));
vi.mock("../../../features/resume-bilingual/api", () => apiMocks);
const renderMocks = vi.hoisted(() => ({ renderResume: vi.fn() }));
vi.mock("../../../api/resumeLayout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/resumeLayout")>()),
  renderResume: renderMocks.renderResume,
}));
vi.mock("../../../features/profile-library/fieldPlacement", () => ({
  useFieldPlacementCatalog: () => ({ catalog: null, loading: false, error: false }),
}));

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  language: "zh-CN",
};

const VARIANT_BRIEF = {
  id: 12,
  resume_id: 5,
  name: "English version",
  language: "en-US" as const,
  variant_group_id: null,
  created_at: "2026-10-01T00:00:00Z",
};

function translatedDocument(): ResumeDocument {
  const next = structuredClone(MOCK_PRIMARY);
  next.language = "en-US";
  const summary = next.sections.find((section) => section.key === "summary");
  const text = summary?.entries[0]?.items.find((item) => item.kind === "text");
  if (text && text.kind === "text") text.text = "English summary.";
  const experience = next.sections.find((section) => section.key === "experience");
  const role = experience?.entries[0]?.items.find(
    (item) => item.kind === "field" && item.key === "role",
  );
  if (role && role.kind === "field") role.value = "Backend Engineer";
  return next;
}

function variantDetail(document: ResumeDocument) {
  return {
    ...VARIANT_BRIEF,
    content: document,
    render_context: { template: "classic" },
    layout: null,
  };
}

function exportInput() {
  return {
    resume_id: 5,
    variant_id: 12,
    name: VARIANT_BRIEF.name,
    language: VARIANT_BRIEF.language,
    content: MOCK_PRIMARY,
    layout: { template: "classic", page_limit: 1, font_scale: "standard" },
    layout_source: "snapshot",
    content_sha256: "sha",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.listVariants.mockResolvedValue({ items: [VARIANT_BRIEF] });
  // 真实流程：新建语言版本先复制当前正文，翻译候选才是译文。
  apiMocks.getVariant.mockResolvedValue(variantDetail(MOCK_PRIMARY));
  apiMocks.fetchVariantExportInput.mockResolvedValue(exportInput());
  renderMocks.renderResume.mockResolvedValue("<html><body>variant preview</body></html>");
  apiMocks.patchVariantLayout.mockResolvedValue(variantDetail(translatedDocument()));
  apiMocks.listGlossaryTerms.mockResolvedValue({ items: [] });
  apiMocks.translateVariant.mockResolvedValue({
    variant_id: 12,
    source_language: "zh-CN",
    target_language: "en-US",
    candidate: translatedDocument(),
    glossary_hits: [],
    blocked_fields: [],
  });
  apiMocks.adoptTranslation.mockImplementation(
    async (_resumeId: number, _variantId: number, items: { path: string; text: string }[]) => ({
      variant: variantDetail(translatedDocument()),
      applied_paths: items.map((item) => item.path),
      content_sha256: "sha",
    }),
  );
  apiMocks.createLanguageVariant.mockResolvedValue({
    ...VARIANT_BRIEF,
    id: 13,
    name: "Chinese version",
    language: "zh-CN",
  });
});

afterEach(() => qualityCleanup());

function qualityCleanup(): void {
  cleanup();
  document.body.innerHTML = "";
}

interface RenderOptions {
  document?: ResumeDocument;
  revision?: number | null;
  layout?: ResumeLayout;
}

function renderWorkspace(options: RenderOptions = {}) {
  const onAdoptDocument = vi.fn();
  const result = render(
    <AntdApp>
      <BilingualWorkspaceV2
        resumeId={5}
        document={options.document ?? MOCK_PRIMARY}
        layout={options.layout ?? LAYOUT}
        revision={options.revision === undefined ? 3 : options.revision}
        onAdoptDocument={onAdoptDocument}
      />
    </AntdApp>,
  );
  return { ...result, onAdoptDocument };
}

describe("BilingualWorkspaceV2", () => {
  it("loads a language variant and shows v2 item-level comparison", async () => {
    apiMocks.getVariant.mockResolvedValue(variantDetail(translatedDocument()));
    renderWorkspace();
    expect(await screen.findByText("English summary.")).toBeTruthy();
    expect(screen.getByText("Ten years on high concurrency trading systems.")).toBeTruthy();
    expect(apiMocks.listVariants).toHaveBeenCalledWith(5);
    expect(apiMocks.getVariant).toHaveBeenCalledWith(5, 12);
  });

  it("adopts a translation using v2 item paths and returns the saved document", async () => {
    const { onAdoptDocument } = renderWorkspace();
    await screen.findByText(bt("bilingual.workspace.tabCompare"));

    // Wait for selected variant details before translating.
    const translate = await screen.findByRole("button", {
      name: bt("bilingual.workspace.translate"),
    });
    await waitFor(() => expect(translate).not.toBeDisabled());
    fireEvent.click(translate);
    await waitFor(() =>
      expect(apiMocks.translateVariant).toHaveBeenCalledWith(5, 12, {
        target_language: "en-US",
      }),
    );

    // Select all candidates that can be adopted.
    const checkboxes = await screen.findAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(
      screen.getByRole("button", {
        name: bt("bilingual.candidate.adoptSelected", { count: 2 }),
      }),
    );
    await waitFor(() => expect(apiMocks.adoptTranslation).toHaveBeenCalledTimes(1));

    const items = apiMocks.adoptTranslation.mock.calls[0][2] as { path: string; text: string }[];
    expect(items.some((item) => item.path === "summary.mock_summary_01.mock_summary_text")).toBe(
      true,
    );
    await waitFor(() => expect(onAdoptDocument).toHaveBeenCalledTimes(1));
    const [document, revision] = onAdoptDocument.mock.calls[0] as [ResumeDocument, number];
    expect(revision).toBe(3);
    expect(document.language).toBe("en-US");
  });

  it("revision=null creates read-only mode and disables translation", async () => {
    renderWorkspace({ revision: null });
    await screen.findByText(bt("bilingual.v2.readOnly"));
    expect(
      screen.getByRole("button", { name: bt("bilingual.workspace.translate") }),
    ).toBeDisabled();
  });

  it("shows the read-only hint for custom sections", async () => {
    const custom = structuredClone(MOCK_PRIMARY);
    custom.sections.push({
      key: "custom:aaaaaaaa-1111-2222-3333-444444444444",
      title: "Side projects",
      kind: "entries",
      layout: { ...custom.sections[0].layout },
      entries: [
        {
          id: "custom_entry_01",
          hidden: false,
          lock_content: false,
          lock_layout: false,
          layout: { head: "split", columns: null, align: null, gap: null },
          items: [],
        },
      ],
    });
    renderWorkspace({ document: custom });
    expect(await screen.findByText(bt("bilingual.v2.customHint"))).toBeTruthy();
  });

  it("previews the variant read-only from export-input without changing the workbench document", async () => {
    apiMocks.getVariant.mockResolvedValue(variantDetail(translatedDocument()));
    const { onAdoptDocument } = renderWorkspace();
    const open = await screen.findByRole("button", { name: bt("bilingual.v2.openInWorkbench") });
    fireEvent.click(open);
    expect(await screen.findByTitle(bt("bilingual.preview.title"))).toBeTruthy();
    await waitFor(() => expect(apiMocks.fetchVariantExportInput).toHaveBeenCalledWith(5, 12));
    await waitFor(() => expect(renderMocks.renderResume).toHaveBeenCalledTimes(1));
    const [document, layout] = renderMocks.renderResume.mock.calls[0] as [
      ResumeDocument,
      ResumeLayout,
    ];
    expect(document).toEqual(MOCK_PRIMARY);
    expect(layout).toMatchObject({ template: "classic", page_limit: 1, font_scale: "standard" });
    expect(onAdoptDocument).not.toHaveBeenCalled();
  });
});
