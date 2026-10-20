// SPDX-License-Identifier: Apache-2.0
/** BackupStatusCard（RF-05）：保护状态、失败缺口与快照清单的展示。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackupStatus } from "../../types";

const getBackupStatus = vi.fn();
const saveAutoBackupInterval = vi.fn();

vi.mock("../../api/settings", () => ({
  getBackupStatus: (...args: unknown[]) => getBackupStatus(...args),
  saveAutoBackupInterval: (...args: unknown[]) => saveAutoBackupInterval(...args),
}));

import BackupStatusCard from "./BackupStatusCard";

function status(overrides: Partial<BackupStatus>): BackupStatus {
  return {
    dataset_id: "main",
    protected: true,
    last_success: 1_000_000,
    last_attempt: 1_000_000,
    consecutive_failures: 0,
    last_error: "",
    interval_days: 7,
    overdue: false,
    snapshot_count: 2,
    snapshots: [
      { name: "resume_forge-20261010-a.db", size_bytes: 1024, modified_at: 1_000_000 },
      { name: "resume_forge-20261003-b.db", size_bytes: 1024, modified_at: 900_000 },
    ],
    ...overrides,
  };
}

function renderCard() {
  return render(
    <AntdApp>
      <BackupStatusCard />
    </AntdApp>,
  );
}

beforeEach(() => {
  getBackupStatus.mockReset();
  saveAutoBackupInterval.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("BackupStatusCard", () => {
  it("受保护：显示标签、最近成功时间与快照清单", async () => {
    getBackupStatus.mockResolvedValue(status({}));
    renderCard();
    await waitFor(() => {
      expect(screen.getByText("受保护")).toBeTruthy();
    });
    expect(screen.getByText(/resume_forge-20261010-a\.db/)).toBeTruthy();
    expect(screen.getByText(/每/)).toBeTruthy();
    expect(screen.getByLabelText("自动备份间隔（天）")).toBeTruthy();
    // 「受保护」必须注明范围：仅数据库快照，不含附件（PR-15 审计项）。
    expect(screen.getByText(/仅数据库快照，不含附件文件/)).toBeTruthy();
  });

  it("修改间隔：调用保存接口并刷新状态", async () => {
    getBackupStatus.mockResolvedValue(status({}));
    saveAutoBackupInterval.mockResolvedValue({ interval_days: 30 });
    renderCard();
    const select = await screen.findByLabelText("自动备份间隔（天）");
    fireEvent.mouseDown(select);
    fireEvent.click(await screen.findByTitle("30 天"));
    await waitFor(() => {
      expect(saveAutoBackupInterval).toHaveBeenCalledWith(30);
    });
    await waitFor(() => {
      expect(screen.getByText(/下次调度检查时生效/)).toBeTruthy();
    });
    // 保存后刷新保护状态（间隔变了，overdue 口径也变了）。
    await waitFor(() => {
      expect(getBackupStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("连续失败：显示保护中断与失败原因，不伪装成已保护", async () => {
    getBackupStatus.mockResolvedValue(
      status({
        protected: false,
        consecutive_failures: 2,
        last_error: "备份失败",
        snapshot_count: 1,
        snapshots: [{ name: "resume_forge-old.db", size_bytes: 1, modified_at: 1 }],
      }),
    );
    renderCard();
    await waitFor(() => {
      expect(screen.getByText("保护中断")).toBeTruthy();
    });
    expect(screen.getByText(/连续 2 次备份失败/)).toBeTruthy();
    expect(screen.queryByText("受保护")).toBeNull();
  });

  it("从未成功备份：给出明确提示", async () => {
    getBackupStatus.mockResolvedValue(
      status({
        protected: false,
        last_success: null,
        snapshot_count: 0,
        snapshots: [],
      }),
    );
    renderCard();
    await waitFor(() => {
      expect(screen.getByText("尚无备份")).toBeTruthy();
    });
    expect(screen.getByText("还没有成功过的自动备份。")).toBeTruthy();
  });

  it("接口失败：显示错误而不是空白", async () => {
    getBackupStatus.mockRejectedValue(new Error("读取备份状态失败"));
    renderCard();
    await waitFor(() => {
      expect(screen.getByText("读取备份状态失败")).toBeTruthy();
    });
  });
});
