// SPDX-License-Identifier: Apache-2.0
/** 表达资产页签（v2）：props/插入回调/409 重开提示。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { at } from "../../../features/resume-assets/i18n";
import { makeResumeDocument } from "../../../test/documentHarness";
import PhraseLibraryPanelV2 from "./PhraseLibraryPanelV2";

const lib = vi.hoisted(() => ({ usePhraseLibrary: vi.fn() }));
vi.mock("../../../features/resume-assets/usePhraseLibrary", () => lib);
vi.mock("../../../api/trash", () => ({ restoreTrashItem: vi.fn() }));

const PHRASE = {
  id: 11,
  text: "主导了网关重构",
  kind: "achievement",
  language: "zh-CN",
  job_tags: [],
  source_claim_id: null,
  source_resume_id: null,
  source_object_id: null,
  quality_note: "",
  usage_count: 2,
  last_used_at: null,
  created_at: null,
};

function setup(
  insert = vi.fn().mockResolvedValue({ resume: { content: makeResumeDocument(), revision: 4 } }),
  onSelectPath?: (path: string) => void,
) {
  lib.usePhraseLibrary.mockReturnValue({
    phrases: [PHRASE],
    loading: false,
    error: null,
    hasMore: false,
    reload: vi.fn(),
    loadMore: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    collect: vi.fn(),
    insert,
  });
  const onInsertDocument = vi.fn();
  render(
    <AntdApp>
      <PhraseLibraryPanelV2
        resumeId={7}
        document={makeResumeDocument()}
        layout={null}
        revision={3}
        selectedPath="education.ob_edu000001.it_item00001"
        onInsertDocument={onInsertDocument}
        onSelectPath={onSelectPath}
      />
    </AntdApp>,
  );
  return { insert, onInsertDocument };
}

function confirmInsert() {
  fireEvent.click(
    screen.getByRole("button", { name: at("assets.action.insertAria", { index: 1 }) }),
  );
  fireEvent.click(screen.getByRole("button", { name: at("assets.insert.confirm") }));
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("PhraseLibraryPanelV2", () => {
  it("插入走服务端并回交 v2 document + revision", async () => {
    const { insert, onInsertDocument } = setup();
    confirmInsert();
    await waitFor(() =>
      expect(insert).toHaveBeenCalledWith(11, {
        resume_id: 7,
        section: "education",
        entry_id: "ob_edu000001",
        expected_revision: 3,
      }),
    );
    await waitFor(() => expect(onInsertDocument).toHaveBeenCalledTimes(1));
    expect(onInsertDocument.mock.calls[0][1]).toBe(4);
  });

  it("插入成功后自动选中新 item（U6）", async () => {
    const onSelectPath = vi.fn();
    setup(
      vi.fn().mockResolvedValue({
        resume: { content: makeResumeDocument(), revision: 4 },
        inserted_point_id: "it_new000001",
      }),
      onSelectPath,
    );
    confirmInsert();
    await waitFor(() =>
      expect(onSelectPath).toHaveBeenCalledWith("education.ob_edu000001.it_new000001"),
    );
  });

  it("409 提示重新打开，不替换本地文档", async () => {
    const { insert, onInsertDocument } = setup(vi.fn().mockRejectedValue({ status: 409 }));
    confirmInsert();
    await waitFor(() => expect(insert).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(at("assets.insert.conflict"))).toBeTruthy());
    expect(onInsertDocument).not.toHaveBeenCalled();
  });

  it("没有选中位置时禁用插入并说明原因", () => {
    lib.usePhraseLibrary.mockReturnValue({
      phrases: [PHRASE],
      loading: false,
      error: null,
      hasMore: false,
      reload: vi.fn(),
      loadMore: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      collect: vi.fn(),
      insert: vi.fn(),
    });
    render(
      <AntdApp>
        <PhraseLibraryPanelV2
          resumeId={7}
          document={makeResumeDocument()}
          layout={null}
          revision={3}
          onInsertDocument={vi.fn()}
        />
      </AntdApp>,
    );
    expect(
      screen.getByRole("button", { name: at("assets.action.insertAria", { index: 1 }) }),
    ).toBeDisabled();
    expect(screen.getByText(at("assets.insert.noTarget"))).toBeTruthy();
    expect(t("assets.panel.title")).toBeTruthy();
  });
});
