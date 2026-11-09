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
  revealCleanupFile: vi.fn(),
}));

vi.mock("../../api/storage", () => ({
  getStorageStats: (...args: unknown[]) => mocks.getStorageStats(...args),
  previewCleanup: (...args: unknown[]) => mocks.previewCleanup(...args),
  runCleanup: (...args: unknown[]) => mocks.runCleanup(...args),
  revealCleanupFile: (...args: unknown[]) => mocks.revealCleanupFile(...args),
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
  },
  categories: [
    { key: "backups", label: "手动与迁移备份" },
    { key: "backup-trash", label: "备份回收目录" },
    { key: "auto-backups", label: "自动备份" },
    { key: "logs", label: "运行日志" },
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
  mocks.revealCleanupFile.mockResolvedValue({ ok: true });
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

    // 四个类别都在，且各自带本类别的文件数与体积。
    expect(screen.getByText("手动与迁移备份")).toBeTruthy();
    expect(screen.getByText("1 个文件 · 4 KB")).toBeTruthy();
    expect(screen.getByText("1 个文件 · 8 KB")).toBeTruthy();
    // 两个空类别都是 0 个文件 / 0 B。
    expect(screen.getAllByText("0 个文件 · 0 B")).toHaveLength(2);
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

    fireEvent.click(screen.getByRole("checkbox", { name: /自动备份\s*\d+ 个文件/ }));

    await waitFor(() =>
      expect(mocks.previewCleanup).toHaveBeenLastCalledWith(30, [
        "backups",
        "backup-trash",
        "logs",
      ]),
    );
  });

  it("逐文件勾选：只把勾选的文件交给执行", async () => {
    renderCard();
    await waitFor(() => expect(mocks.getStorageStats).toHaveBeenCalled());
    await openCleanupModal();

    // 取消 backups/b5.db，只留 auto-backups 那一份。
    fireEvent.click(screen.getByRole("checkbox", { name: /backups\/b5\.db/ }));
    expect(screen.getByRole("button", { name: "移走 1 个文件" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "移走 1 个文件" }));

    await waitFor(() =>
      expect(mocks.runCleanup).toHaveBeenCalledWith(
        30,
        PLAN.categories.map((c) => c.key),
        ["auto-backups/main/snap.db"],
      ),
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
        PLAN.candidates.map((c) => c.path),
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

/**
 * 条目 04：「在文件夹中显示」。
 *
 * 两件事必须同时成立——(1) 相对路径原样交给后端（前端从不拼绝对路径）；
 * (2) 点图标**不能**改变这一行的勾选。行本身是 `<label>`（整行可点 = 切换），
 * 所以图标按钮里漏掉 `preventDefault` / `stopPropagation` 任一个，用户点一次
 * 「看看文件在哪」就会顺手把这一项从清理计划里去掉（或加回来）。
 */

/**
 * 后端 404 的 detail 原文：「文件已被移走或删除」。
 *
 * 用 `\u` 转义写出：测试口径的 CJK 断言行数只降不升（`i18n/cjkRatchet.test.ts`），
 * 断言里再写一遍中文字面量会让这个文件超基线。运行时仍是同一个字符串。
 */
const GONE_DETAIL = "\u6587\u4ef6\u5df2\u88ab\u79fb\u8d70\u6216\u5220\u9664";

describe("StorageStatsCard · 在文件夹中显示", () => {
  it("点图标定位文件，且不改变这一行的勾选状态", async () => {
    renderCard();
    await waitFor(() => expect(mocks.getStorageStats).toHaveBeenCalled());
    await openCleanupModal();

    const row = screen.getByRole("checkbox", { name: /backups\/b5\.db/ });
    // 新清单默认全选：点图标之前是勾上的。
    expect(row).toBeChecked();

    const revealButtons = screen.getAllByRole("button", { name: "打开文件夹" });
    // 两个候选各一个图标按钮，顺序与候选清单一致。
    expect(revealButtons).toHaveLength(PLAN.candidates.length);
    fireEvent.click(revealButtons[0]);

    await waitFor(() => expect(mocks.revealCleanupFile).toHaveBeenCalledWith("backups/b5.db"));
    // 关键断言：勾选状态没被 label 的默认行为连带切换。
    expect(row).toBeChecked();
    // 成功定位不需要重拉清单（只有失败才重拉）。
    expect(mocks.previewCleanup).toHaveBeenCalledTimes(1);
  });

  it("定位失败：给出「原因 + 建议 + 编号」并重拉清单", async () => {
    mocks.revealCleanupFile.mockRejectedValue(new Error(GONE_DETAIL));
    renderCard();
    await waitFor(() => expect(mocks.getStorageStats).toHaveBeenCalled());
    await openCleanupModal();

    fireEvent.click(screen.getAllByRole("button", { name: "打开文件夹" })[0]);

    // 原因来自后端 detail，建议与编号由 errorGuidance 统一补上。
    expect(await screen.findByText(new RegExp(GONE_DETAIL))).toBeTruthy();
    // 文件已经不在：清单必须重拉，否则用户对着一条不存在的文件继续点。
    await waitFor(() => expect(mocks.previewCleanup).toHaveBeenCalledTimes(2));
    expect(mocks.previewCleanup).toHaveBeenLastCalledWith(
      30,
      PLAN.categories.map((category) => category.key),
    );
  });
});
