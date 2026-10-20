// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位优化建议的全局提醒：弹窗没开着时才弹通知（生成中带「取消」、完成提示去看、失败报错）。
 *
 * 这一条**必须用真实 AntD**（照 RiskScanWatcher.test.tsx 的做法）：通知卡片的字段名在
 * antd 6 里是 `title` / `actions`，用假宿主记录参数的话传错键名也能"通过"，真机上却只是
 * 一张空白卡片。所以断言直接读 `.ant-notification-notice-*` 的真实 DOM。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSuggestionScanState,
  markSuggestionPanelAttached,
  resetSuggestionScan,
  startSuggestionScan,
} from "../features/resume/suggestionScanStore";
import type { ResumeSuggestions } from "../types";
import SuggestionScanWatcher from "./SuggestionScanWatcher";

const apiMocks = vi.hoisted(() => ({ generateResumeSuggestions: vi.fn() }));

// store 只从 api/resumes 取这一个函数。
vi.mock("../api/resumes", () => apiMocks);

function payload(): ResumeSuggestions {
  return {
    job_id: 3,
    job_title: "前端工程师",
    company: "示例公司",
    suggestions: [
      {
        priority: "high",
        section: "项目经历",
        issue: "缺少量化结果",
        suggestion: "补充可核对的数字",
        evidence: [],
      },
    ],
  };
}

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
      <SuggestionScanWatcher />
    </AntdApp>,
  );
}

/** 通知标题/描述的选择器（antd 6 把卡片内容渲染在这两个 class 上）。 */
function noticeTitle(): string | null {
  return document.querySelector(".ant-notification-notice-title")?.textContent ?? null;
}

function noticeDescription(): string | null {
  return document.querySelector(".ant-notification-notice-description")?.textContent ?? null;
}

/** 给通知一次出场机会（断言"没有弹"时必须先等一拍）。 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

beforeEach(() => {
  resetSuggestionScan();
  apiMocks.generateResumeSuggestions.mockReset();
});

afterEach(() => {
  cleanup();
  resetSuggestionScan();
  document.body.innerHTML = "";
});

describe("SuggestionScanWatcher", () => {
  it("生成中且弹窗未附着时弹常驻通知，带「取消」且点了回到 idle", async () => {
    const pending = deferred<ResumeSuggestions>();
    apiMocks.generateResumeSuggestions.mockReturnValue(pending.promise);
    renderWatcher();

    startSuggestionScan(7);

    await waitFor(() => expect(noticeTitle()).toBe("岗位优化建议生成中"));
    expect(noticeDescription()).toContain("后台继续");

    fireEvent.click(screen.getByRole("button", { name: /取\s*消/ }));
    await waitFor(() => expect(getSuggestionScanState(7).status).toBe("idle"));
  });

  it("弹窗正开着时不弹通知（生成中与完成都在弹窗里就地展示）", async () => {
    const detach = markSuggestionPanelAttached(7);
    const pending = deferred<ResumeSuggestions>();
    apiMocks.generateResumeSuggestions.mockReturnValue(pending.promise);
    renderWatcher();

    startSuggestionScan(7);
    await waitFor(() => expect(getSuggestionScanState(7).status).toBe("scanning"));
    await settle();
    expect(noticeTitle()).toBeNull();

    pending.resolve(payload());
    await waitFor(() => expect(getSuggestionScanState(7).status).toBe("done"));
    await settle();
    expect(noticeTitle()).toBeNull();

    detach();
  });

  it("弹窗关掉之后，进行中的生成才弹通知", async () => {
    const detach = markSuggestionPanelAttached(7);
    const pending = deferred<ResumeSuggestions>();
    apiMocks.generateResumeSuggestions.mockReturnValue(pending.promise);
    renderWatcher();

    startSuggestionScan(7);
    await waitFor(() => expect(getSuggestionScanState(7).status).toBe("scanning"));
    await settle();
    expect(noticeTitle()).toBeNull();

    detach();

    await waitFor(() => expect(noticeTitle()).toBe("岗位优化建议生成中"));
  });

  it("完成后在弹窗未附着时报「已生成」并指路", async () => {
    const pending = deferred<ResumeSuggestions>();
    apiMocks.generateResumeSuggestions.mockReturnValue(pending.promise);
    renderWatcher();

    startSuggestionScan(7);
    await waitFor(() => expect(noticeTitle()).toBe("岗位优化建议生成中"));

    pending.resolve(payload());
    await waitFor(() => expect(noticeTitle()).toBe("岗位优化建议已生成"));
    expect(noticeDescription()).toContain("岗位优化建议");
  });

  it("失败且弹窗未附着时报错，并把错误信息透传", async () => {
    apiMocks.generateResumeSuggestions.mockRejectedValue(new Error("模型服务不可用"));
    renderWatcher();

    startSuggestionScan(7);

    await waitFor(() => expect(noticeTitle()).toBe("岗位优化建议生成失败"));
    expect(noticeDescription()).toContain("模型服务不可用");
  });
});
