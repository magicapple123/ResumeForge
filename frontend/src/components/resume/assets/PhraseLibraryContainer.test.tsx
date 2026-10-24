// SPDX-License-Identifier: Apache-2.0
/** 表达资产库容器（W17-FE）：真实 API 接线、插入新身份、收藏、软删 + 撤销。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { at } from "../../../features/resume-assets/i18n";
import type { ResumePhrase } from "../../../features/resume-assets/types";
import PhraseLibraryContainer from "./PhraseLibraryContainer";

const apiMocks = vi.hoisted(() => ({
  listPhrases: vi.fn(),
  createPhrase: vi.fn(),
  updatePhrase: vi.fn(),
  deletePhrase: vi.fn(),
  collectPhrase: vi.fn(),
  insertPhrase: vi.fn(),
}));
const trashMocks = vi.hoisted(() => ({ restoreTrashItem: vi.fn() }));
const clipboardMocks = vi.hoisted(() => ({ copyText: vi.fn() }));

vi.mock("../../../features/resume-assets/api", () => apiMocks);
vi.mock("../../../api/trash", () => trashMocks);
vi.mock("../../../utils/clipboard", () => clipboardMocks);

const PHRASE: ResumePhrase = {
  id: 7,
  text: "Cut p95 latency from 800ms to 210ms.",
  kind: "achievement",
  language: "en-US",
  job_tags: ["backend"],
  source_claim_id: null,
  source_resume_id: 3,
  source_object_id: "exp_1",
  quality_note: "",
  usage_count: 2,
  last_used_at: null,
  created_at: "2026-10-01T00:00:00Z",
};

beforeEach(() => {
  apiMocks.listPhrases.mockResolvedValue({ items: [PHRASE], next_cursor: null });
  apiMocks.deletePhrase.mockResolvedValue(undefined);
  apiMocks.collectPhrase.mockResolvedValue(PHRASE);
  apiMocks.insertPhrase.mockResolvedValue({
    resume: { id: 3 },
    phrase: { ...PHRASE, usage_count: 3 },
    inserted_object_id: "exp_new123",
    inserted_point_id: "pt_new123",
  });
  clipboardMocks.copyText.mockResolvedValue(true);
  trashMocks.restoreTrashItem.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderContainer(
  overrides: Partial<React.ComponentProps<typeof PhraseLibraryContainer>> = {},
) {
  const onInserted = vi.fn();
  const props: React.ComponentProps<typeof PhraseLibraryContainer> = {
    resumeId: 3,
    insertTarget: { section: "experience", entryId: "exp_1" },
    expectedRevision: 5,
    onInserted,
    ...overrides,
  };
  render(
    <AntdApp>
      <PhraseLibraryContainer {...props} />
    </AntdApp>,
  );
  return { onInserted };
}

describe("PhraseLibraryContainer", () => {
  it("加载真实列表并渲染资产", async () => {
    renderContainer();
    expect(await screen.findByText(PHRASE.text)).toBeTruthy();
    expect(apiMocks.listPhrases).toHaveBeenCalledWith({ limit: 100, cursor: null });
  });

  it("插入：带 resume_id/section/entry_id/expected_revision，成功后交回新对象", async () => {
    const { onInserted } = renderContainer();
    await screen.findByText(PHRASE.text);
    fireEvent.click(
      screen.getByRole("button", { name: at("assets.action.insertAria", { index: 1 }) }),
    );
    await waitFor(() => expect(apiMocks.insertPhrase).toHaveBeenCalledTimes(1));
    expect(apiMocks.insertPhrase.mock.calls[0][0]).toBe(PHRASE.id);
    expect(apiMocks.insertPhrase.mock.calls[0][1]).toMatchObject({
      resume_id: 3,
      section: "experience",
      entry_id: "exp_1",
      expected_revision: 5,
    });
    await waitFor(() => expect(onInserted).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(at("assets.insert.newObject", { id: "exp_new123" }), {
        exact: false,
      }),
    ).toBeTruthy();
  });

  it("删除：软删 + Toast 撤销 → 撤销调用回收站恢复", async () => {
    renderContainer();
    await screen.findByText(PHRASE.text);
    fireEvent.click(screen.getByRole("button", { name: at("assets.action.delete") }));
    await waitFor(() => expect(apiMocks.deletePhrase).toHaveBeenCalledWith(PHRASE.id));
    const undo = await screen.findByRole("button", { name: t("toast.undo.label") });
    fireEvent.click(undo);
    await waitFor(() =>
      expect(trashMocks.restoreTrashItem).toHaveBeenCalledWith("phrase", PHRASE.id),
    );
  });

  it("收藏：需要选中路径；有路径时回传 resume_id + path", async () => {
    renderContainer({ selectedPath: "experience.0.description.1" });
    await screen.findByText(PHRASE.text);
    fireEvent.click(screen.getByRole("button", { name: at("assets.action.collectAria") }));
    await waitFor(() =>
      expect(apiMocks.collectPhrase).toHaveBeenCalledWith(3, "experience.0.description.1"),
    );
  });

  it("没有选中路径时不显示收藏入口；没有简历上下文时插入禁用并说明", async () => {
    renderContainer({ resumeId: null, insertTarget: null });
    await screen.findByText(PHRASE.text);
    expect(screen.queryByRole("button", { name: at("assets.action.collectAria") })).toBeNull();
    expect(
      screen.getByRole("button", { name: at("assets.action.insertAria", { index: 1 }) }),
    ).toBeDisabled();
    expect(screen.getByText(at("assets.action.insertUnavailable"))).toBeTruthy();
  });

  it("宿主有未保存草稿（insertLocked）：插入禁用并给准确原因，收藏仍可用", async () => {
    renderContainer({ selectedPath: "experience.0.description.1", insertLocked: true });
    await screen.findByText(PHRASE.text);
    expect(
      screen.getByRole("button", { name: at("assets.action.insertAria", { index: 1 }) }),
    ).toBeDisabled();
    expect(screen.getByText(at("assets.insert.locked"))).toBeTruthy();
    // 只锁插入：收藏入口仍是可用动作。
    expect(screen.getByRole("button", { name: at("assets.action.collectAria") })).toBeEnabled();
  });

  it("复制：去掉加粗标记后写剪贴板", async () => {
    renderContainer();
    await screen.findByText(PHRASE.text);
    fireEvent.click(
      screen.getByRole("button", { name: at("assets.action.copyAria", { index: 1 }) }),
    );
    await waitFor(() => expect(clipboardMocks.copyText).toHaveBeenCalledWith(PHRASE.text));
  });
});
