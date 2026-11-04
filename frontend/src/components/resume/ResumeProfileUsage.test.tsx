// SPDX-License-Identifier: Apache-2.0
/** 简历详情「本次使用」追溯行（R-33）与"需重新生成"提示（R-36 相邻口径）。 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeProfileUsage as ResumeProfileUsageResponse } from "../../types";
import ResumeProfileUsage from "./ResumeProfileUsage";

const apiMocks = vi.hoisted(() => ({ getResumeProfileUsage: vi.fn() }));
vi.mock("../../api/resumes", () => apiMocks);

const SEPARATOR = t("profileGroups.summary.separator");

function makeResponse(overrides: Partial<ResumeProfileUsageResponse["profile_usage"]> = {}) {
  const snapshot = {
    group_name: "应届生",
    group_id: "group-1",
    participating: [
      { key: "basic_info", name: "基本信息" },
      { key: "educations", name: "教育经历" },
      { key: "projects", name: "项目经历" },
    ],
    section_order: ["basic_info", "educations", "projects"],
    definition_revision: 3,
    data_revision: 7,
    created_at: "2026-10-25T10:00:00",
    group_deleted: false,
    ...overrides,
  };
  return { profile_usage: snapshot, freshness: { changed: false, reasons: [] } };
}

const SUMMARY = t("profileGroups.summary.label", { name: "应届生", count: 3 });

function renderBlock() {
  return render(<ResumeProfileUsage recordId={8} />);
}

beforeEach(() => {
  apiMocks.getResumeProfileUsage.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeProfileUsage 本次使用（R-33）", () => {
  it("有快照：显示组名与参与大字段数量，hover 展开字段名", async () => {
    apiMocks.getResumeProfileUsage.mockResolvedValue(makeResponse());
    renderBlock();

    const summary = await screen.findByText(SUMMARY);
    // 键盘等价入口：聚焦也能展开字段名（Tooltip 不只有鼠标）。
    expect(summary).toHaveAttribute("tabindex", "0");

    fireEvent.mouseEnter(summary);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(["基本信息", "教育经历", "项目经历"].join(SEPARATOR));
    expect(apiMocks.getResumeProfileUsage).toHaveBeenCalledWith(8);
  });

  it("组已删除：仍显示快照里的组名，并标注「组已删除」", async () => {
    apiMocks.getResumeProfileUsage.mockResolvedValue(makeResponse({ group_deleted: true }));
    renderBlock();

    expect(await screen.findByText(SUMMARY)).toBeInTheDocument();
    const badge = await screen.findByText(t("resume.detail.group-usage.deleted"));
    fireEvent.mouseEnter(badge);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      t("resume.detail.group-usage.deleted-hint"),
    );
  });

  it("无快照（旧简历/手写简历）：整块不渲染，也不报错", async () => {
    apiMocks.getResumeProfileUsage.mockResolvedValue({
      profile_usage: null,
      freshness: { changed: false, reasons: [] },
    });
    renderBlock();

    await waitFor(() => expect(apiMocks.getResumeProfileUsage).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(SUMMARY)).toBeNull();
    expect(screen.queryByText(t("resume.detail.group-usage.deleted"))).toBeNull();
  });

  it("读取失败：静默降级，不显示任何辅助信息", async () => {
    apiMocks.getResumeProfileUsage.mockRejectedValue(new Error("network down"));
    renderBlock();

    await waitFor(() => expect(apiMocks.getResumeProfileUsage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(SUMMARY)).toBeNull());
  });
});

describe("ResumeProfileUsage 需重新生成提示（R-36 相邻口径）", () => {
  it("资料/组定义已变：压成一行警告，完整原文在 Tooltip 里", async () => {
    apiMocks.getResumeProfileUsage.mockResolvedValue({
      ...makeResponse(),
      freshness: { changed: true, reasons: ["content_changed"] },
    });
    renderBlock();

    // 2026-11 问题 8：正文不再占第二行，标题与一句「需重新生成」并成一行。
    const line = await screen.findByText(
      new RegExp(t("resume.detail.group-usage.stale-title")),
    );
    expect(line.textContent).toContain(t("resume.detail.group-usage.stale-action"));
    // 仍然是琥珀警告条（不能退化成纯文本）。
    expect(line.closest(".ant-alert")).not.toBeNull();
    // 原文一个字没丢：悬停（以及键盘聚焦，见下一条）都能看到。
    fireEvent.mouseEnter(line);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      t("resume.detail.group-usage.stale-body"),
    );
  });

  it("「资料已更新」的完整原文也能用键盘聚焦触发", async () => {
    apiMocks.getResumeProfileUsage.mockResolvedValue({
      ...makeResponse(),
      freshness: { changed: true, reasons: ["content_changed"] },
    });
    renderBlock();

    const line = await screen.findByText(
      new RegExp(t("resume.detail.group-usage.stale-title")),
    );
    // 原生 title 键盘用户拿不到，所以这一行必须可聚焦并走 Tooltip。
    // React 18 把 `onFocus` 接在 focusin 上，所以这里派发 focusin（fireEvent.focus 不冒泡）。
    expect(line).toHaveAttribute("tabindex", "0");
    fireEvent.focusIn(line);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      t("resume.detail.group-usage.stale-body"),
    );
  });

  it("没有变化：不显示提示", async () => {
    apiMocks.getResumeProfileUsage.mockResolvedValue(makeResponse());
    renderBlock();

    await screen.findByText(SUMMARY);
    expect(screen.queryByText(t("resume.detail.group-usage.stale-title"))).toBeNull();
  });
});
