// SPDX-License-Identifier: Apache-2.0
/** ManualBackupsCard（RF-25）：快照清单、逐份确认的可恢复删除与 .trash 提示。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManualBackups } from "../../api/storage";

const apiMocks = vi.hoisted(() => ({
  listManualBackups: vi.fn(),
  trashManualBackup: vi.fn(),
}));

vi.mock("../../api/storage", () => apiMocks);

import ManualBackupsCard from "./ManualBackupsCard";

const LISTED: ManualBackups = {
  directory: "D:/rf/backend/data/backups",
  items: [
    {
      name: "resume_forge-20261001-000000.db",
      size_bytes: 5 * 1024 * 1024,
      modified_at: 1_760_000_000,
    },
    { name: "resume_forge-20260901-000000.db", size_bytes: 1024, modified_at: 1_750_000_000 },
  ],
  trashed_count: 2,
};

function renderCard() {
  return render(
    <AntdApp>
      <ManualBackupsCard />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.listManualBackups.mockReset().mockResolvedValue(LISTED);
  apiMocks.trashManualBackup.mockReset().mockResolvedValue({ name: "x", trash_path: "y" });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ManualBackupsCard", () => {
  it("列出快照、体积与时间，并提示 .trash 里还有几份", async () => {
    renderCard();
    expect(await screen.findByText("resume_forge-20261001-000000.db")).toBeTruthy();
    expect(screen.getByText("resume_forge-20260901-000000.db")).toBeTruthy();
    expect(screen.getByText(/5.0 MB/)).toBeTruthy();
    expect(screen.getByText(/\.trash\/ 里还有 2 份/)).toBeTruthy();
  });

  it("快照超过 5 份：默认只展示 5 份，点「显示全部」展开其余", async () => {
    const items = Array.from({ length: 7 }, (_, index) => ({
      name: `resume_forge-2026100${index}-000000.db`,
      size_bytes: 1024,
      modified_at: 1_760_000_000 + index,
    }));
    apiMocks.listManualBackups.mockResolvedValue({ ...LISTED, items, trashed_count: 0 });
    renderCard();
    expect(await screen.findByText("resume_forge-20261000-000000.db")).toBeTruthy();
    // 第 6、7 份默认折叠；「显示全部」点击后可见，并可收起。
    expect(screen.queryByText("resume_forge-20261005-000000.db")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "显示全部 7 条" }));
    expect(await screen.findByText("resume_forge-20261005-000000.db")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "收起列表" }));
    expect(screen.queryByText("resume_forge-20261005-000000.db")).toBeNull();
  });

  it("快照不超过 5 份：不出现折叠按钮", async () => {
    renderCard();
    expect(await screen.findByText("resume_forge-20261001-000000.db")).toBeTruthy();
    expect(screen.queryByText(/显示全部/)).toBeNull();
  });

  it("空列表：说明没有自动清理，不提供批量删除", async () => {
    apiMocks.listManualBackups.mockResolvedValue({ ...LISTED, items: [], trashed_count: 0 });
    renderCard();
    expect(await screen.findByText(/暂无手动备份快照/)).toBeTruthy();
    expect(screen.queryByText("全部删除")).toBeNull();
  });

  it("移除走确认弹窗，确认后调用可恢复删除并刷新列表", async () => {
    renderCard();
    // 「移除」已收进每行「···」菜单（用户反馈不裸露）：先开菜单再点「移除」。
    fireEvent.click(
      await screen.findByRole("button", {
        name: "备份 resume_forge-20261001-000000.db 的更多操作",
      }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: /移除/ }));

    // 确认弹窗展示影响：体积、快照时间与去向（标题在 dialog 结构里会出现多处）。
    expect(
      (await screen.findAllByText(/移除备份「resume_forge-20261001-000000.db」？/)).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/5\.0 MB/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/这份备份约占/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/backups\/\.trash\//).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "移到 .trash" }));
    await waitFor(() => {
      expect(apiMocks.trashManualBackup).toHaveBeenCalledWith("resume_forge-20261001-000000.db");
    });
    await waitFor(() => {
      expect(apiMocks.listManualBackups).toHaveBeenCalledTimes(2);
    });
  });

  it("接口失败：显示错误消息而不是空白", async () => {
    apiMocks.listManualBackups.mockRejectedValue(new Error("读取手动备份失败"));
    renderCard();
    await waitFor(() => {
      expect(screen.getByText("读取手动备份失败")).toBeTruthy();
    });
  });
});
