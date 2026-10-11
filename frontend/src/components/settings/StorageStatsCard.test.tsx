/** StorageStatsCard（RF-25）：分项体积排序展示与错误态。 */
import { App as AntdApp } from "antd";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageStats } from "../../api/storage";

const getStorageStats = vi.fn();

vi.mock("../../api/storage", () => ({
  getStorageStats: (...args: unknown[]) => getStorageStats(...args),
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

function renderCard() {
  return render(
    <AntdApp>
      <StorageStatsCard />
    </AntdApp>,
  );
}

beforeEach(() => {
  getStorageStats.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("StorageStatsCard", () => {
  it("按体积倒序展示分项，0 体积的分项不出现", async () => {
    getStorageStats.mockResolvedValue(STATS);
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
    getStorageStats.mockRejectedValue(new Error("读取存储占用失败"));
    renderCard();
    await waitFor(() => {
      expect(screen.getByText("读取存储占用失败")).toBeTruthy();
    });
  });
});
