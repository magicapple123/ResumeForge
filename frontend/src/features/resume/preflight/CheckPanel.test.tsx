// SPDX-License-Identifier: Apache-2.0
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { makeIssue, makePreflightOut } from "../../../test/preflightFixtures";
import CheckPanel from "./CheckPanel";

function renderPanel(props: Partial<Parameters<typeof CheckPanel>[0]> = {}) {
  const base: Parameters<typeof CheckPanel>[0] = {
    status: "ready",
    result: makePreflightOut(),
    error: "",
    stale: false,
    running: false,
    onRun: vi.fn(),
    onCancel: vi.fn(),
  };
  const merged = { ...base, ...props };
  return {
    ...render(
      <AntdApp>
        <CheckPanel {...merged} />
      </AntdApp>,
    ),
    props: merged,
  };
}

afterEach(() => cleanup());

describe("统一检查面板（W11）", () => {
  it("三层分组 + 三级严重度 + 计数", () => {
    renderPanel({
      result: makePreflightOut({
        issues: [
          makeIssue({ layer: "content", severity: "blocker", detail: "content-issue" }),
          makeIssue({ layer: "layout", severity: "verify", detail: "layout-issue" }),
          makeIssue({ layer: "product", severity: "suggestion", detail: "product-issue" }),
        ],
      }),
    });
    for (const layerKey of [
      "preflight.layer.content",
      "preflight.layer.layout",
      "preflight.layer.product",
    ] as const) {
      expect(
        screen.getByText(t("preflight.layer.groupLabel", { layer: t(layerKey), count: 1 })),
      ).toBeInTheDocument();
    }
    expect(screen.getByText(t("preflight.severity.blocker"))).toBeInTheDocument();
    expect(screen.getByText(t("preflight.severity.verify"))).toBeInTheDocument();
    expect(screen.getByText(t("preflight.severity.suggestion"))).toBeInTheDocument();
  });

  it("「只看必须解决」过滤掉 verify/suggestion", () => {
    renderPanel({
      result: makePreflightOut({
        issues: [
          makeIssue({ severity: "blocker", detail: "keep-blocker" }),
          makeIssue({ severity: "verify", detail: "drop-verify" }),
        ],
      }),
    });
    fireEvent.click(screen.getByRole("switch", { name: t("preflight.filter.blockers") }));
    expect(screen.getByText("keep-blocker")).toBeInTheDocument();
    expect(screen.queryByText("drop-verify")).toBeNull();
  });

  it("修复入口调用宿主分派函数，并标记待复检", () => {
    const onFix = vi.fn();
    const fix = {
      action: "add_page" as const,
      payload: { issue_id: "issue-1" },
      label_key: "preflight.fix.add_page",
    };
    renderPanel({
      onFix,
      result: makePreflightOut({
        issues: [makeIssue({ id: "issue-1", fix, detail: "need-page" })],
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: t("preflight.fix.add_page") }));
    expect(onFix).toHaveBeenCalledWith(fix);
    expect(screen.getByText(t("preflight.issue.pendingRecheck"))).toBeInTheDocument();
  });

  it("没有修复入口时不摆按钮，给手动处理说明", () => {
    renderPanel({
      onFix: vi.fn(),
      result: makePreflightOut({ issues: [makeIssue({ fix: null, detail: "manual-row" })] }),
    });
    expect(screen.getByText(t("preflight.issue.noFix"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("preflight.fix.fallback") })).toBeNull();
  });

  it("过时结果有提示；空清单显示通过文案", () => {
    renderPanel({ stale: true, result: makePreflightOut() });
    expect(screen.getByText(t("preflight.status.stale"))).toBeInTheDocument();
    expect(screen.getByText(t("preflight.empty.title"))).toBeInTheDocument();
  });

  it("首次失败给错误态与重试入口；运行中可取消", () => {
    const onRun = vi.fn();
    const onCancel = vi.fn();
    renderPanel({ status: "error", result: null, error: "boom", onRun, onCancel });
    expect(screen.getByText("boom")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("preflight.error.retry") }));
    expect(onRun).toHaveBeenCalledTimes(1);
    cleanup();
    renderPanel({ status: "loading", result: null, running: true, onRun, onCancel });
    fireEvent.click(screen.getByRole("button", { name: t("preflight.action.cancel") }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  /** 回归（2026-10-29 用户反馈）：同一张卡片上出现两个「开始检查」。 */
  it("空态只有顶部那一颗「开始检查」", () => {
    renderPanel({ status: "idle", result: null });
    expect(screen.getByText(t("preflight.status.idle"))).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: t("preflight.action.run") })).toHaveLength(1);
  });

  /**
   * 回归：结果缺字段（老版本后端 / 只跑了部分层）时不能整页崩。
   * 旧实现直接读 `result.issues.length` → `Cannot read properties of undefined (reading 'length')`。
   */
  it("issues 缺失时按空清单处理，不抛错", () => {
    const broken = {
      ...makePreflightOut(),
      issues: undefined,
      snapshot: undefined,
    } as unknown as Parameters<typeof CheckPanel>[0]["result"];
    expect(() => renderPanel({ result: broken })).not.toThrow();
    expect(screen.getByText(t("preflight.empty.title"))).toBeInTheDocument();
  });
});
