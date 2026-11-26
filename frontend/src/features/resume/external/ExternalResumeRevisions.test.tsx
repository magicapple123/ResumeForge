// SPDX-License-Identifier: Apache-2.0
/**
 * 「历史版本」页签：倒序列出、当前版本不给恢复、恢复后再写一版并刷新列表。
 *
 * 恢复的语义是"以那版的内容再存一版"，所以断言里只有两件事：调用参数对、
 * 外层拿到了恢复后的详情 —— **不**断言"被恢复的那条变成当前"（历史不改写）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalResumeDetail } from "../../../api/externalResumes";
import { t } from "../../../i18n";
import { ExternalResumeRevisions } from "./ExternalResumeRevisions";

const apiMocks = vi.hoisted(() => ({
  listExternalResumeRevisions: vi.fn(),
  restoreExternalResumeRevision: vi.fn(),
}));
vi.mock("../../../api/externalResumes", () => apiMocks);

const RESTORED_RESUME: ExternalResumeDetail = {
  id: 7,
  file_id: 21,
  name: "外部简历.pdf",
  mime: "application/pdf",
  text_chars: 12,
  has_text: true,
  job_id: null,
  job_title: "",
  created_at: "2026-11-10T10:00:00",
  updated_at: "2026-11-10T11:20:00",
  warnings: [],
  text: "旧标题",
};

const REVISIONS = {
  resume_id: 7,
  total: 3,
  items: [
    {
      id: 30,
      file_id: 22,
      text_chars: 40,
      has_text: true,
      source: "edit",
      created_at: "2026-11-10T11:00:00",
      current: true,
    },
    {
      id: 21,
      file_id: 21,
      text_chars: 12,
      has_text: true,
      source: "upload",
      created_at: "2026-11-10T10:00:00",
      current: false,
    },
    {
      id: 11,
      file_id: 20,
      text_chars: 0,
      has_text: false,
      source: "restore",
      created_at: "2026-11-09T09:00:00",
      current: false,
    },
  ],
};

beforeEach(() => {
  apiMocks.listExternalResumeRevisions.mockReset().mockResolvedValue(REVISIONS);
  apiMocks.restoreExternalResumeRevision.mockReset().mockResolvedValue({
    resume: RESTORED_RESUME,
    revision: { ...REVISIONS.items[1], id: 31, source: "restore", current: true },
    warnings: [],
  });
});

afterEach(() => {
  cleanup();
});

describe("ExternalResumeRevisions", () => {
  it("每条版本都写清时间 / 字数 / 有无文字 / 来源，当前版本不给「恢复」", async () => {
    render(<ExternalResumeRevisions resumeId={7} onRestored={vi.fn()} />);

    expect(await screen.findByTestId("external-revision-30")).toBeInTheDocument();
    const current = screen.getByTestId("external-revision-30");
    expect(current).toHaveTextContent(t("externalEdit.revisions.current"));
    expect(current).toHaveTextContent(t("externalEdit.revisions.source.edit"));
    expect(screen.getByTestId("external-restore-30")).toBeDisabled();

    const noText = screen.getByTestId("external-revision-11");
    expect(noText).toHaveTextContent(t("externalEdit.revisions.noText"));
    expect(noText).toHaveTextContent(t("externalEdit.revisions.source.restore"));
    expect(screen.getByTestId("external-restore-21")).toBeEnabled();
  });

  it("恢复：调对版本、交回恢复后的详情，并重新拉一次列表", async () => {
    const onRestored = vi.fn();
    render(<ExternalResumeRevisions resumeId={7} onRestored={onRestored} />);

    fireEvent.click(await screen.findByTestId("external-restore-21"));

    await waitFor(() => {
      expect(apiMocks.restoreExternalResumeRevision).toHaveBeenCalledWith(7, 21);
    });
    expect(onRestored).toHaveBeenCalledWith(RESTORED_RESUME);
    expect(await screen.findByTestId("external-restored")).toHaveTextContent(
      t("externalEdit.revisions.restored"),
    );
    await waitFor(() => {
      expect(apiMocks.listExternalResumeRevisions).toHaveBeenCalledTimes(2);
    });
  });

  it("只有当前这一版时给出空态，而不是一张空表", async () => {
    apiMocks.listExternalResumeRevisions.mockResolvedValue({ resume_id: 7, items: [], total: 0 });

    render(<ExternalResumeRevisions resumeId={7} onRestored={vi.fn()} />);
    expect(await screen.findByTestId("external-revisions-empty")).toHaveTextContent(
      t("externalEdit.revisions.empty"),
    );
  });
});
