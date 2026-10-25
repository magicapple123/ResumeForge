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
    snapshot_state: "ok",
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

  it("coverage=database_only：说明自动备份不含附件与字体，并指向手动导出", async () => {
    // H3：范围必须说清楚，否则用户把「受保护」读成"所有东西都不会丢"。
    getBackupStatus.mockResolvedValue(status({ coverage: "database_only" }));
    renderCard();
    await waitFor(() => {
      expect(screen.getByText(/自动备份只覆盖数据库快照，不含附件与字体/)).toBeTruthy();
    });
    expect(screen.getByText(/导出数据集 \/ 导出全部数据集/)).toBeTruthy();
  });

  it("接口失败：显示错误而不是空白", async () => {
    getBackupStatus.mockRejectedValue(new Error("读取备份状态失败"));
    renderCard();
    await waitFor(() => {
      expect(screen.getByText("读取备份状态失败")).toBeTruthy();
    });
  });
});

/**
 * 快照目录的可判定状态（审计 F2/A02）。
 *
 * 这五态是本轮新增的状态模型：`protected` 不再是"有过成功"的同义词，目录读不了也
 * 不能再被当成"没有快照"。每条用例都断言「不显示受保护」——绿色标签是这里唯一
 * 不可退让的性质。
 */
describe("BackupStatusCard 快照状态", () => {
  it("目录读不了：显示「无法确认」并说明原因，不显示受保护", async () => {
    getBackupStatus.mockResolvedValue(
      status({
        protected: false,
        snapshot_state: "unreadable",
        snapshot_count: 0,
        snapshots: [],
      }),
    );
    renderCard();
    // i18n-ok: 本卡文案尚未迁 t()，与既有状态断言同批
    await waitFor(() => expect(screen.getByText("无法确认")).toBeTruthy());
    // i18n-ok: 同上
    expect(screen.getByText(/无法读取快照目录，请检查磁盘权限/)).toBeTruthy();
    // i18n-ok: 同上
    expect(screen.queryByText("受保护")).toBeNull();
  });

  it("快照缺失：有成功记录但没有快照文件时不显示受保护", async () => {
    getBackupStatus.mockResolvedValue(
      status({ protected: false, snapshot_state: "empty", snapshot_count: 0, snapshots: [] }),
    );
    renderCard();
    // i18n-ok: 同上
    await waitFor(() => expect(screen.getByText("快照缺失")).toBeTruthy());
    // i18n-ok: 同上
    expect(screen.getByText(/上次成功记录存在，但当前找不到快照文件/)).toBeTruthy();
    // i18n-ok: 同上
    expect(screen.queryByText("受保护")).toBeNull();
  });

  it("旧后端没有 snapshot_state：按快照份数推断，缺字段不崩", async () => {
    getBackupStatus.mockResolvedValue(
      status({
        protected: false,
        snapshot_state: undefined,
        snapshot_count: 0,
        snapshots: [],
      }),
    );
    renderCard();
    // i18n-ok: 同上
    await waitFor(() => expect(screen.getByText("快照缺失")).toBeTruthy());
  });

  it("已到期未备份：受保护但超过间隔，标签如实提示", async () => {
    getBackupStatus.mockResolvedValue(status({ overdue: true }));
    renderCard();
    // i18n-ok: 同上
    await waitFor(() => expect(screen.getByText("已到期未备份")).toBeTruthy());
    // i18n-ok: 同上
    expect(screen.queryByText("受保护")).toBeNull();
  });

  it("部署配置禁用自动备份：显示禁用态、说明由部署配置控制，间隔选择不可点", async () => {
    getBackupStatus.mockResolvedValue(
      status({
        protected: false,
        auto_backup_enabled: false,
        disabled: true,
        state: "disabled",
        snapshot_count: 0,
        snapshots: [],
      }),
    );
    renderCard();
    // i18n-ok: 本卡文案尚未迁 t()，与既有状态断言同批
    await waitFor(() => expect(screen.getByText("自动备份已禁用")).toBeTruthy());
    // 标签说明与禁用提示各出现一次（两个容器都写清了"由部署配置控制"）。
    // i18n-ok: 本卡文案尚未迁 t()，与既有状态断言同批
    expect(screen.getAllByText(/由部署配置控制/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("自动备份间隔（天）")).toBeDisabled();
    // i18n-ok: 同上
    expect(screen.queryByText("受保护")).toBeNull();
  });

  it("「无法确认」优先于「保护中断」：目录读不了时说不出到底发生了什么", async () => {
    getBackupStatus.mockResolvedValue(
      status({
        protected: false,
        snapshot_state: "unreadable",
        consecutive_failures: 1,
        last_error: "备份失败",
        snapshot_count: 0,
        snapshots: [],
      }),
    );
    renderCard();
    // i18n-ok: 同上
    await waitFor(() => expect(screen.getByText("无法确认")).toBeTruthy());
    // i18n-ok: 同上
    expect(screen.queryByText("保护中断")).toBeNull();
  });
});
