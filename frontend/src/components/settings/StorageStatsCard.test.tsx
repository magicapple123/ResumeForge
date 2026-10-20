// SPDX-License-Identifier: Apache-2.0
/** StorageStatsCard（RF-25 / R19）：分项体积排序展示、错误态、按类别清理。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CleanupPlan, StorageStats } from "../../api/storage";

const mocks = vi.hoisted(() => ({
  getStorageStats: vi.fn(),
  previewCleanup: vi.fn(),
  runCleanup: vi.fn(),
}));

vi.mock("../../api/storage", () => ({
  getStorageStats: (...args: unknown[]) => mocks.getStorageStats(...args),
  previewCleanup: (...args: unknown[]) => mocks.previewCleanup(...args),
  runCleanup: (...args: unknown[]) => mocks.runCleanup(...args),
}));

import StorageStatsCard from "./StorageStatsCard";

const STATS: StorageStats = {
  data_dir: "D:/rf/backend/data",
  total_bytes: 300 * 1024 * 1024,
  total_file_count: 1234,
  items: [
    {
      key: "database",
      label: "数据库（含 WAL 边车）",
      size_bytes: 200 * 1024 * 1024,
      file_count: 3,
    },
    {
      key: "browser_profile",
      label: "投递浏览器用户目录",
      size_bytes: 80 * 1024 * 1024,
      file_count: 1000,
    },
    { key: "captures", label: "站点采集样例", size_bytes: 0, file_count: 0 },
  ],
};

const PLAN: CleanupPlan = {
  older_than_days: 30,
  totals: { files: 2, bytes: 12 * 1024 },
  candidates: [
    {
      category: "backups",
      label: "手动与迁移备份",
      path: "backups/b5.db",
      size: 4 * 1024,
      modified: "2026-08-01T10:00:00+08:00",
    },
    {
      category: "auto-backups",
      label: "自动备份",
      path: "auto-backups/main/snap.db",
      size: 8 * 1024,
      modified: "2026-08-02T10:00:00+08:00",
    },
  ],
  skipped: [
    {
      category: "backups",
      label: "手动与迁移备份",
      path: "backups/b1.db",
      reason: "最近 3 份备份",
      size: 4 * 1024,
    },
    {
      category: "backups",
      label: "手动与迁移备份",
      path: "backups/b2.db",
      reason: "最近 3 份备份",
      size: 4 * 1024,
    },
    {
      category: "backups",
      label: "手动与迁移备份",
      path: "backups/b3.db",
      reason: "最近 3 份备份",
      size: 4 * 1024,
    },
  ],
  by_category: {
    backups: { label: "手动与迁移备份", files: 1, bytes: 4 * 1024 },
    "backup-trash": { label: "备份回收目录", files: 0, bytes: 0 },
    "auto-backups": { label: "自动备份", files: 1, bytes: 8 * 1024 },
    logs: { label: "运行日志", files: 0, bytes: 0 },
    "old-logs": { label: "旧日志", files: 0, bytes: 0 },
  },
  categories: [
    { key: "backups", label: "手动与迁移备份" },
    { key: "backup-trash", label: "备份回收目录" },
    { key: "auto-backups", label: "自动备份" },
    { key: "logs", label: "运行日志" },
    { key: "old-logs", label: "旧日志" },
  ],
};

function renderCard() {
  return render(
    <AntdApp>
      <StorageStatsCard />
    </AntdApp>,
  );
}

/** 打开清理弹窗（先是预览，再等弹窗把固定提示渲染出来）。 */
async function openCleanupModal() {
  fireEvent.click(screen.getByRole("button", { name: /清理旧文件/ }));
  await screen.findByText(/最近 3 份备份不会出现在清单里/);
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getStorageStats.mockResolvedValue(STATS);
  mocks.previewCleanup.mockResolvedValue(PLAN);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("StorageStatsCard", () => {
  it("按体积倒序展示分项，0 体积的分项不出现", async () => {
    renderCard();
    await waitFor(() => {
      expect(screen.getByText("数据库（含 WAL 边车）")).toBeTruthy();
    });
    expect(screen.getByText("200.0 MB")).toBeTruthy();
    expect(screen.getByText("投递浏览器用户目录")).toBeTruthy();
    // 0 体积的目录不上榜。
    expect(screen.queryByText("站点采集样例")).toBeNull();
    // 汇总口径在标题行。
    expect(screen.getByText(/300\.0 MB/)).toBeTruthy();
  });

  it("接口失败：显示错误而不是空白", async () => {
    mocks.getStorageStats.mockRejectedValue(new Error("读取存储占用失败"));
    renderCard();
    await waitFor(() => {
      expect(screen.getByText("读取存储占用失败")).toBeTruthy();
    });
  });

  it("清理弹窗按类别分组（名称 / 文件数 / 体积），并固定提示最近 3 份备份", async () => {
    renderCard();
    await waitFor(() => expect(mocks.getStorageStats).toHaveBeenCalled());
    await openCleanupModal();

    // 五个类别都在，且各自带本类别的文件数与体积。
    expect(screen.getByText("手动与迁移备份")).toBeTruthy();
    expect(screen.getByText("1 个文件 · 4 KB")).toBeTruthy();
    expect(screen.getByText("1 个文件 · 8 KB")).toBeTruthy();
    // 三个空类别都是 0 个文件 / 0 B。
    expect(screen.getAllByText("0 个文件 · 0 B")).toHaveLength(3);
    // 固定提示：保留策略在后端，界面必须说清楚否则用户会以为最新那份也被清了。
    expect(screen.getByText(/最近 3 份备份不会出现在清单里/)).toBeTruthy();
    // 候选清单里只有可清理的那两个，被保留的三份不在清单里。
    expect(screen.getByText(/backups\/b5\.db/)).toBeTruthy();
    expect(screen.queryByText(/backups\/b1\.db/)).toBeNull();
  });

  it("取消勾选某类后按剩余类别重新预览（预览 = 执行）", async () => {
    renderCard();
    await waitFor(() => expect(mocks.getStorageStats).toHaveBeenCalled());
    await openCleanupModal();

    fireEvent.click(screen.getByRole("checkbox", { name: /自动备份/ }));

    await waitFor(() =>
      expect(mocks.previewCleanup).toHaveBeenLastCalledWith(30, [
        "backups",
        "backup-trash",
        "logs",
        "old-logs",
      ]),
    );
  });

  it("执行后展示 moved / freed_bytes / skipped 并刷新统计", async () => {
    mocks.runCleanup.mockResolvedValue({
      moved: 2,
      freed_bytes: 12 * 1024,
      failed: [],
      trash_dir: ".cleanup-trash/20261019-160000",
      skipped: PLAN.skipped,
      by_category: PLAN.by_category,
      older_than_days: 30,
    });
    renderCard();
    await waitFor(() => expect(mocks.getStorageStats).toHaveBeenCalledTimes(1));
    await openCleanupModal();

    fireEvent.click(screen.getByRole("button", { name: "移走 2 个文件" }));

    await waitFor(() =>
      expect(mocks.runCleanup).toHaveBeenCalledWith(
        30,
        PLAN.categories.map((c) => c.key),
      ),
    );
    // antd 的确认弹窗把标题同时渲染在弹窗头与内容区，按"至少出现一次"断言。
    expect((await screen.findAllByText("已移走 2 个文件")).length).toBeGreaterThan(0);
    expect(screen.getByText(/释放 12 KB/)).toBeTruthy();
    expect(screen.getByText(/本次保留 3 份/)).toBeTruthy();
    // 统计要刷新：不刷新会让用户看到的占用停在清理前。
    await waitFor(() => expect(mocks.getStorageStats).toHaveBeenCalledTimes(2));
  });
});
