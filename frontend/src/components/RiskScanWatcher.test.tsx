// SPDX-License-Identifier: Apache-2.0
/**
 * 风险扫描全局提醒：面板没开着时才弹通知（扫描中带「取消」、完成报条数、失败报错）。
 *
 * 这一条**必须用真实 AntD**（照 taskNotify.modal.test.tsx 的做法）：通知卡片的字段名在
 * antd 6 里由 `message` 改成了 `title`、`btn` 改成 `actions`，用假宿主记录参数的话，传错
 * 键名也能"通过"，而真机上只是一张空白卡片。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRiskScanState,
  markRiskPanelAttached,
  resetRiskScanStore,
  startRiskScan,
} from "../features/resume/riskScanStore";
import RiskScanWatcher from "./RiskScanWatcher";

const apiMocks = vi.hoisted(() => ({ scanResumeRisks: vi.fn() }));

vi.mock("../api/resumeRisk", () => apiMocks);

const RESULT = {
  resume_id: 7,
  points: [
    {
      category: "compliance",
      severity: "high",
      text: "保密协议",
      location: "正文",
      suggestion: "投递前请确认",
      claim_id: null,
      follow_up: [],
    },
    {
      category: "exaggeration",
      severity: "medium",
      text: "性能提升 300%",
      location: "工作经历",
      suggestion: "换成可核对的数字",
      claim_id: null,
      follow_up: [],
    },
  ],
  summary: { compliance: 1, exaggeration: 1 },
  remote_enhancement_available: false,
  llm_used: false,
  notes: [],
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderWatcher() {
  return render(
    <AntdApp>
      <RiskScanWatcher />
    </AntdApp>,
  );
}

/** 通知标题的选择器（antd 6 的卡片把标题渲染在 .ant-notification-notice-title）。 */
function noticeTitle(): string | null {
  return document.querySelector(".ant-notification-notice-title")?.textContent ?? null;
}

beforeEach(() => {
  resetRiskScanStore();
  apiMocks.scanResumeRisks.mockReset();
});

afterEach(() => {
  cleanup();
  resetRiskScanStore();
  document.body.innerHTML = "";
});

describe("RiskScanWatcher", () => {
  it("扫描中且面板未附着时弹常驻通知，并带「取消」按钮", async () => {
    const pending = deferred<typeof RESULT>();
    apiMocks.scanResumeRisks.mockReturnValue(pending.promise);
    renderWatcher();

    startRiskScan(7, { enhance: false });

    await waitFor(() => expect(noticeTitle()).toBe("风险扫描进行中"));
    expect(document.querySelector(".ant-notification-notice-description")?.textContent).toContain(
      "扫描会在后台继续",
    );

    fireEvent.click(screen.getByRole("button", { name: /取\s*消/ }));
    await waitFor(() => expect(getRiskScanState(7).status).toBe("idle"));
  });

  it("完成后在面板未附着时报「共 N 条风险点」", async () => {
    const pending = deferred<typeof RESULT>();
    apiMocks.scanResumeRisks.mockReturnValue(pending.promise);
    renderWatcher();

    startRiskScan(7, { enhance: false });
    await waitFor(() => expect(noticeTitle()).toBe("风险扫描进行中"));

    pending.resolve(RESULT);
    await waitFor(() => expect(noticeTitle()).toBe("风险扫描完成"));
    expect(document.querySelector(".ant-notification-notice-description")?.textContent).toContain(
      "共 2 条风险点",
    );
  });

  it("面板正开着时不弹任何通知（结果就地展示）", async () => {
    const detach = markRiskPanelAttached(7);
    const pending = deferred<typeof RESULT>();
    apiMocks.scanResumeRisks.mockReturnValue(pending.promise);
    renderWatcher();

    startRiskScan(7, { enhance: false });
    // 给通知一次出场机会：still 不该出现任何卡片。
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(noticeTitle()).toBeNull();

    pending.resolve(RESULT);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(noticeTitle()).toBeNull();
    detach();
  });

  it("面板关掉之后，进行中的扫描才弹通知", async () => {
    const detach = markRiskPanelAttached(7);
    const pending = deferred<typeof RESULT>();
    apiMocks.scanResumeRisks.mockReturnValue(pending.promise);
    renderWatcher();

    startRiskScan(7, { enhance: false });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(noticeTitle()).toBeNull();

    detach();
    await waitFor(() => expect(noticeTitle()).toBe("风险扫描进行中"));
  });

  it("失败且面板未附着时报错", async () => {
    apiMocks.scanResumeRisks.mockRejectedValue(new Error("模型服务不可用"));
    renderWatcher();

    startRiskScan(7, { enhance: true });

    await waitFor(() => expect(noticeTitle()).toBe("风险扫描失败"));
    expect(document.querySelector(".ant-notification-notice-description")?.textContent).toContain(
      "模型服务不可用",
    );
  });
});
