// SPDX-License-Identifier: Apache-2.0
/** 双语版本容器（W16-FE）：真实 API 对照、候选 blocked、采纳、术语软删 + 撤销。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bt } from "../../../features/resume-bilingual/i18n";
import { t } from "../../../i18n";
import BilingualWorkspace from "./BilingualWorkspace";

const apiMocks = vi.hoisted(() => ({
  listVariants: vi.fn(),
  getVariant: vi.fn(),
  translateVariant: vi.fn(),
  adoptTranslation: vi.fn(),
  listGlossaryTerms: vi.fn(),
  createGlossaryTerm: vi.fn(),
  updateGlossaryTerm: vi.fn(),
  deleteGlossaryTerm: vi.fn(),
}));
const trashMocks = vi.hoisted(() => ({ restoreTrashItem: vi.fn() }));
vi.mock("../../../features/resume-bilingual/api", () => apiMocks);
vi.mock("../../../api/trash", () => trashMocks);

const VARIANT = {
  id: 8,
  resume_id: 5,
  name: "英文版",
  language: "en-US",
  variant_group_id: 1,
  template: "classic",
  page_limit: 1,
  font_scale: "standard",
  created_at: "2026-10-01T00:00:00Z",
  content: {
    basic_info: { name: "Zhang San" },
    summary: "Built backend services.",
  },
};
const CURRENT = { basic_info: { name: "张三" }, summary: "负责后端服务开发。" };

beforeEach(() => {
  apiMocks.listVariants.mockResolvedValue({ items: [VARIANT] });
  apiMocks.getVariant.mockResolvedValue(VARIANT);
  apiMocks.listGlossaryTerms.mockResolvedValue({
    items: [
      {
        id: 1,
        source_term: "云商科技",
        target_term: "Cloud Commerce",
        language_from: "zh-CN",
        language_to: "en-US",
        category: "company",
        locked: true,
        note: "",
      },
    ],
  });
  apiMocks.translateVariant.mockResolvedValue({
    variant_id: 8,
    source_language: "zh-CN",
    target_language: "en-US",
    candidate: {
      basic_info: { name: "Zhang San" },
      summary: "Built and optimized backend services.",
    },
    glossary_hits: [],
    blocked_fields: ["basic_info.name"],
  });
  apiMocks.adoptTranslation.mockResolvedValue({
    variant: VARIANT,
    applied_paths: ["summary"],
    content_sha256: "sha",
  });
  apiMocks.deleteGlossaryTerm.mockResolvedValue(undefined);
  trashMocks.restoreTrashItem.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWorkspace() {
  render(
    <AntdApp>
      <BilingualWorkspace resumeId={5} currentContent={CURRENT} currentLanguage="zh-CN" />
    </AntdApp>,
  );
}

describe("BilingualWorkspace", () => {
  it("加载真实语言版本并显示字段对照（与当前简历语言不同的一份）", async () => {
    renderWorkspace();
    expect(await screen.findByText("Built backend services.")).toBeTruthy();
    expect(apiMocks.listVariants).toHaveBeenCalledWith(5);
    expect(apiMocks.getVariant).toHaveBeenCalledWith(5, 8);
  });

  it("生成候选后勾选采纳：事实锁字段被排除在 items 之外", async () => {
    renderWorkspace();
    await screen.findByText("Built backend services.");
    fireEvent.click(screen.getByRole("button", { name: bt("bilingual.workspace.translate") }));
    await waitFor(() => expect(apiMocks.translateVariant).toHaveBeenCalledTimes(1));
    await screen.findByText("Built and optimized backend services.");
    const all = screen.getByRole("checkbox", { name: bt("bilingual.candidate.hint") });
    fireEvent.click(all);
    fireEvent.click(
      screen.getByRole("button", {
        name: bt("bilingual.candidate.adoptSelected", { count: 1 }),
      }),
    );
    await waitFor(() => expect(apiMocks.adoptTranslation).toHaveBeenCalledTimes(1));
    const items = apiMocks.adoptTranslation.mock.calls[0][2] as { path: string }[];
    expect(items.map((item) => item.path)).toEqual(["summary"]);
  });

  it("术语表：软删 + Toast 撤销 → 调回收站恢复", async () => {
    renderWorkspace();
    await screen.findByText("Built backend services.");
    fireEvent.click(screen.getByText(bt("bilingual.workspace.tabGlossary")));
    await screen.findByText("Cloud Commerce");
    fireEvent.click(screen.getByRole("button", { name: bt("bilingual.glossary.delete") }));
    await waitFor(() => expect(apiMocks.deleteGlossaryTerm).toHaveBeenCalledWith(1));
    const undo = await screen.findByRole("button", { name: t("toast.undo.label") });
    fireEvent.click(undo);
    await waitFor(() =>
      expect(trashMocks.restoreTrashItem).toHaveBeenCalledWith("glossary_term", 1),
    );
  });
});
