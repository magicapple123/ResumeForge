// SPDX-License-Identifier: Apache-2.0
/**
 * 详情「P0 四项」动作条（T28）：收藏 / 备注 / 重命名 / 导出原件。
 *
 * 这里只钉**组件自己的决定**——写哪个接口、传什么值、什么时候拦住不写。列表是否跳行
 * 由后端的"收藏不刷新 `updated_at`"决定（`tests/test_external_resume_p0_api.py` 有两条
 * 用例，含排序位置），前端不该也不能在这里替它保证。
 *
 * 四件事：
 *
 * 1. 收藏只调 `setExternalResumeFavorite(id, !favorite)`，且把服务端回来的详情回传——
 *    本地改字段会让列表那一份仍是旧值；
 * 2. 备注：没有备注时**不渲染**备注行（空行等于噪音）；保存时把草稿原样交给服务端
 *    （首尾空白由服务端统一裁，前端不各写一份规则）；
 * 3. 重命名：空名与超长在弹窗里就拦住，一次请求都不发；
 * 4. 导出原件：链接带 `download=true`，看历史版本时带的是那一版的 `revision_id`。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalResumeDetail } from "../../api/externalResumes";
import { t } from "../../i18n";
import { ExternalResumeDetailActions } from "./ExternalResumeDetailActions";

const api = vi.hoisted(() => ({
  setExternalResumeFavorite: vi.fn(),
  setExternalResumeNote: vi.fn(),
  updateExternalResume: vi.fn(),
  // 不声明形参：真实签名在 api/externalResumes，这里只关心"按钮指向了 file 端点"。
  externalResumeFileUrl: vi.fn(() => "/api/file-stub"),
}));
vi.mock("../../api/externalResumes", () => api);

function record(overrides: Partial<ExternalResumeDetail> = {}): ExternalResumeDetail {
  return {
    id: 7,
    file_id: 70,
    name: "external-a.txt",
    mime: "text/plain",
    text_chars: 120,
    has_text: true,
    job_id: null,
    job_title: "",
    favorite: false,
    favorited_at: null,
    note: "",
    created_at: "2026-11-10T10:00:00",
    updated_at: "2026-11-10T10:00:00",
    warnings: [],
    text: "",
    ...overrides,
  };
}

function renderActions(overrides: Partial<ExternalResumeDetail> = {}, revisionId?: number) {
  const onRecordChange = vi.fn();
  const view = (item: ExternalResumeDetail) => (
    <AntdApp>
      <ExternalResumeDetailActions
        record={item}
        onRecordChange={onRecordChange}
        revisionId={revisionId}
      />
    </AntdApp>
  );
  const rendered = render(view(record(overrides)));
  return {
    onRecordChange,
    rerender: (item: ExternalResumeDetail) => rendered.rerender(view(item)),
  };
}

beforeEach(() => {
  api.setExternalResumeFavorite.mockReset();
  api.setExternalResumeNote.mockReset();
  api.updateExternalResume.mockReset();
  api.externalResumeFileUrl.mockClear();
});
afterEach(cleanup);

describe("ExternalResumeDetailActions · 收藏", () => {
  it("点「收藏」写服务端，并把回来的详情交给抽屉", async () => {
    const updated = record({ favorite: true, favorited_at: "2026-11-26T10:00:00" });
    api.setExternalResumeFavorite.mockResolvedValue(updated);
    const { onRecordChange } = renderActions();

    fireEvent.click(screen.getByTestId("external-favorite-toggle"));

    await waitFor(() => expect(api.setExternalResumeFavorite).toHaveBeenCalledWith(7, true));
    await waitFor(() => expect(onRecordChange).toHaveBeenCalledWith(updated));
  });

  it("已收藏时按钮是「取消收藏」，点它写 false", async () => {
    api.setExternalResumeFavorite.mockResolvedValue(record({ favorite: false }));
    renderActions({ favorite: true });

    fireEvent.click(screen.getByTestId("external-favorite-toggle"));

    await waitFor(() => expect(api.setExternalResumeFavorite).toHaveBeenCalledWith(7, false));
  });
});

describe("ExternalResumeDetailActions · 备注", () => {
  it("没有备注时整行不渲染（空备注不留空行）", () => {
    renderActions();
    expect(screen.queryByTestId("external-note-view")).toBeNull();
  });

  it("有备注时显示一行；弹窗里改完保存回传新详情", async () => {
    const updated = record({ note: "client-version" });
    api.setExternalResumeNote.mockResolvedValue(updated);
    const { onRecordChange } = renderActions({ note: "old-note" });

    expect(screen.getByTestId("external-note-view").textContent).toContain("old-note");

    fireEvent.click(screen.getByTestId("external-note-open"));
    fireEvent.change(screen.getByTestId("external-note-input"), {
      target: { value: "client-version" },
    });
    fireEvent.click(screen.getByTestId("external-note-save"));

    await waitFor(() =>
      expect(api.setExternalResumeNote).toHaveBeenCalledWith(7, "client-version"),
    );
    await waitFor(() => expect(onRecordChange).toHaveBeenCalledWith(updated));
  });
});

describe("ExternalResumeDetailActions · 重命名", () => {
  const openRename = () => fireEvent.click(screen.getByTestId("external-rename-open"));

  it("空名在弹窗里就被拦住，不发请求", () => {
    renderActions();
    openRename();

    fireEvent.change(screen.getByTestId("external-rename-input"), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("external-rename-save"));

    expect(screen.getByTestId("external-rename-error").textContent).toBe(
      t("resumesPage.external.rename.empty"),
    );
    expect(api.updateExternalResume).not.toHaveBeenCalled();
  });

  it("超长名同样拦在本地", () => {
    renderActions();
    openRename();

    fireEvent.change(screen.getByTestId("external-rename-input"), {
      target: { value: "a".repeat(257) },
    });
    fireEvent.click(screen.getByTestId("external-rename-save"));

    expect(screen.getByTestId("external-rename-error").textContent).toBe(
      t("resumesPage.external.rename.tooLong", { max: 256 }),
    );
    expect(api.updateExternalResume).not.toHaveBeenCalled();
  });

  it("合法名字去掉首尾空白后提交，成功回传新详情", async () => {
    const updated = record({ name: "renamed.txt" });
    api.updateExternalResume.mockResolvedValue(updated);
    const { onRecordChange } = renderActions();
    openRename();

    fireEvent.change(screen.getByTestId("external-rename-input"), {
      target: { value: "  renamed.txt  " },
    });
    fireEvent.click(screen.getByTestId("external-rename-save"));

    await waitFor(() =>
      expect(api.updateExternalResume).toHaveBeenCalledWith(7, { name: "renamed.txt" }),
    );
    await waitFor(() => expect(onRecordChange).toHaveBeenCalledWith(updated));
  });
});

describe("ExternalResumeDetailActions · 导出原件", () => {
  it("导出链接带 download=true（后端据此换 attachment + 原始文件名）", () => {
    renderActions();

    fireEvent.click(screen.getByTestId("external-export-original"));

    expect(api.externalResumeFileUrl).toHaveBeenCalledWith(7, undefined, true);
  });

  it("看历史版本时导的是那一版", () => {
    renderActions({}, 42);

    fireEvent.click(screen.getByTestId("external-export-original"));

    expect(api.externalResumeFileUrl).toHaveBeenCalledWith(7, 42, true);
  });
});
