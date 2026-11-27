// SPDX-License-Identifier: Apache-2.0
/**
 * 「历史版本」页签（T12）：倒序列出、当前版本不给预览/恢复、恢复要二次确认、
 * 每行给出「比上一版 ±N 字」。
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
  getExternalResumeRevisionText: vi.fn(),
  // 第三个参数与真实实现同名同义（T28 的 `download`）：mock 少一个参数就会把
  // `&download=true` 悄悄吞掉，看不出调用点漏没漏。
  externalResumeFileUrl: (id: number, revisionId?: number, download = false) => {
    const base = `/api/external-resumes/${id}/file`;
    const params = new URLSearchParams();
    if (revisionId != null) params.set("revision_id", String(revisionId));
    if (download) params.set("download", "true");
    const query = params.toString();
    return query ? `${base}?${query}` : base;
  },
}));
vi.mock("../../../api/externalResumes", () => apiMocks);

// 版本预览是 pdf.js 画的；jsdom 里起不来，这里只要它别炸（像素由截图守）。
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 600 * scale,
          height: 800 * scale,
        }),
        render: () => ({ promise: Promise.resolve() }),
        cleanup: () => undefined,
      }),
    }),
    destroy: () => Promise.resolve(),
  }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "pdf-worker-url" }));

const RECORD: ExternalResumeDetail = {
  id: 7,
  file_id: 22,
  name: "外部简历.pdf",
  mime: "application/pdf",
  text_chars: 40,
  has_text: true,
  job_id: null,
  job_title: "",
  created_at: "2026-11-10T11:00:00",
  updated_at: "2026-11-10T11:00:00",
  warnings: [],
  text: "新版正文",
};

const RESTORED_RESUME: ExternalResumeDetail = {
  ...RECORD,
  file_id: 23,
  updated_at: "2026-11-10T11:20:00",
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

function renderTab(onRestored = vi.fn(), onViewVersion?: (id: number) => void) {
  render(
    <ExternalResumeRevisions
      resumeId={7}
      record={RECORD}
      onRestored={onRestored}
      onViewVersion={
        onViewVersion === undefined ? undefined : (revision) => onViewVersion(revision.id)
      }
    />,
  );
  return { onRestored };
}

beforeEach(() => {
  apiMocks.listExternalResumeRevisions.mockReset().mockResolvedValue(REVISIONS);
  // 历史版本表里没有正文：对比时要按需再取一次（这里给"两行旧文"）。
  apiMocks.getExternalResumeRevisionText.mockReset().mockResolvedValue({
    revision_id: 21,
    // 两行用数组拼：正文的换行是**内容**，写成转义串在源码里反而看不出有几个换行。
    text: ["旧标题", "第二行"].join(String.fromCharCode(10)),
    text_chars: 12,
    has_text: true,
  });
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
  it("每条版本都写清时间 / 字数 / 有无文字 / 来源，当前版本不给预览与恢复", async () => {
    renderTab();

    expect(await screen.findByTestId("external-revision-30")).toBeInTheDocument();
    const current = screen.getByTestId("external-revision-30");
    expect(current).toHaveTextContent(t("externalEdit.revisions.current"));
    expect(current).toHaveTextContent(t("externalEdit.revisions.source.edit"));
    // R9-6：当前版本就在「原件」页签里，版本行的「预览」对它禁用。
    expect(screen.getByTestId("external-preview-30")).toBeDisabled();
    expect(screen.getByTestId("external-restore-30")).toBeDisabled();

    const noText = screen.getByTestId("external-revision-11");
    expect(noText).toHaveTextContent(t("externalEdit.revisions.noText"));
    expect(noText).toHaveTextContent(t("externalEdit.revisions.source.restore"));
    expect(screen.getByTestId("external-restore-21")).toBeEnabled();
    expect(screen.getByTestId("external-preview-21")).toBeEnabled();
  });

  it("「比上一版 ±N 字」：时间倒序与下一条比，最老的一版写「首版」", async () => {
    renderTab();

    expect(await screen.findByTestId("external-revision-30")).toHaveTextContent(
      t("externalEdit.revisions.diff", { delta: "+28" }),
    );
    expect(screen.getByTestId("external-revision-21")).toHaveTextContent(
      t("externalEdit.revisions.diff", { delta: "+12" }),
    );
    expect(screen.getByTestId("external-revision-11")).toHaveTextContent(
      t("externalEdit.revisions.first"),
    );
  });

  it("「预览」在行下展开那一版的原件，不请求恢复", async () => {
    renderTab();

    fireEvent.click(await screen.findByTestId("external-preview-21"));
    expect(await screen.findByTestId("external-preview-pane-21")).toBeInTheDocument();
    expect(apiMocks.restoreExternalResumeRevision).not.toHaveBeenCalled();
    // 再点一次收起来（不是开一堆）。
    fireEvent.click(screen.getByTestId("external-preview-21"));
    await waitFor(() => {
      expect(screen.queryByTestId("external-preview-pane-21")).toBeNull();
    });
  });

  it("恢复要先确认；确认后才调接口、交回恢复后的详情，并重新拉一次列表", async () => {
    const { onRestored } = renderTab();

    fireEvent.click(await screen.findByTestId("external-restore-21"));
    // 点一下不算数：先出确认框，并说明"会新增一条版本，历史不消失"。
    expect(await screen.findByText(t("externalEdit.revisions.confirmBody"))).toBeInTheDocument();
    expect(apiMocks.restoreExternalResumeRevision).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: t("externalEdit.revisions.confirmOk") }));
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

  it("refreshKey 变化（编辑后又存了一版）会重新拉列表", async () => {
    const { rerender } = render(
      <ExternalResumeRevisions resumeId={7} record={RECORD} refreshKey={22} onRestored={vi.fn()} />,
    );
    await screen.findByTestId("external-revision-30");
    expect(apiMocks.listExternalResumeRevisions).toHaveBeenCalledTimes(1);

    rerender(
      <ExternalResumeRevisions resumeId={7} record={RECORD} refreshKey={23} onRestored={vi.fn()} />,
    );
    await waitFor(() => {
      expect(apiMocks.listExternalResumeRevisions).toHaveBeenCalledTimes(2);
    });
  });

  it("「对比」并排给出原版与当前版本的逐行差异，右侧固定是当前版本", async () => {
    renderTab();

    fireEvent.click(await screen.findByTestId("external-compare-21"));
    // 正文要按需再取一次：列表里本来不带正文。
    expect(await screen.findByTestId("external-diff-21")).toBeInTheDocument();
    expect(apiMocks.getExternalResumeRevisionText).toHaveBeenCalledWith(7, 21);
    // 旧的一版有两行、当前版本的行完全不同 → 2 删 1 增。
    expect(screen.getAllByTestId("external-diff-removed")).toHaveLength(2);
    expect(screen.getAllByTestId("external-diff-added")).toHaveLength(1);
    const pane = screen.getByTestId("external-compare-pane-21");
    expect(pane).toHaveTextContent(t("externalEdit.compare.removed", { count: 2 }));
    expect(pane).toHaveTextContent(t("externalEdit.compare.added", { count: 1 }));
    // 右列的表头写清"这是当前版本"，否则读的人不知道哪边是恢复后的样子。
    expect(pane).toHaveTextContent(t("externalEdit.compare.right"));
    // 对比是只读的：不该顺手恢复。
    expect(apiMocks.restoreExternalResumeRevision).not.toHaveBeenCalled();
  });

  it("「预览」把选中的版本通知外层（原件与文本才能一起切到这一版）", async () => {
    const onViewVersion = vi.fn();
    renderTab(vi.fn(), onViewVersion);

    fireEvent.click(await screen.findByTestId("external-preview-21"));
    expect(onViewVersion).toHaveBeenCalledWith(21);
  });

  it("只有当前这一版时给出空态，而不是一张空表", async () => {
    apiMocks.listExternalResumeRevisions.mockResolvedValue({ resume_id: 7, items: [], total: 0 });

    renderTab();
    expect(await screen.findByTestId("external-revisions-empty")).toHaveTextContent(
      t("externalEdit.revisions.empty"),
    );
  });
});
