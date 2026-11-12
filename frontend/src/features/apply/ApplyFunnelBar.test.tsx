// SPDX-License-Identifier: Apache-2.0
/**
 * #14F 页头漏斗条的单测：四个数字 + 点击下钻。
 *
 * 判据里最容易错的两处：
 * 1. 四个数字必须来自 `/apply/summary`，不是前端自己数（口径在后端，前端重算就会漂）；
 * 2. 接口读不到时**整条不渲染**——它是增强信息，不该在页头挂一行报错。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getApplySummary: vi.fn(),
}));

vi.mock("../../api/applyExtras", () => ({
  getApplySummary: apiMocks.getApplySummary,
}));

import { t } from "../../i18n";
import ApplyFunnelBar, { FUNNEL_DAYS } from "./ApplyFunnelBar";

function renderBar(onDrill = vi.fn()) {
  const view = render(
    <AntdApp>
      <ApplyFunnelBar onDrill={onDrill} />
    </AntdApp>,
  );
  return { ...view, onDrill };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getApplySummary.mockResolvedValue({
    applied: 12,
    succeeded: 7,
    failed: 3,
    interviewing: 2,
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ApplyFunnelBar 四个数字", () => {
  it("按后端给的四个值渲染，窗口是 7 天", async () => {
    renderBar();

    expect(await screen.findByText(t("applyUi.funnel.applied"))).toBeInTheDocument();
    expect(screen.getByText(t("applyUi.funnel.succeeded"))).toBeInTheDocument();
    expect(screen.getByText(t("applyUi.funnel.failed"))).toBeInTheDocument();
    expect(screen.getByText(t("applyUi.funnel.interviewing"))).toBeInTheDocument();
    // 数字本身也要如实显示（不是从别处算出来的）。
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(t("applyUi.funnel.hint", { days: FUNNEL_DAYS }))).toBeInTheDocument();
    expect(apiMocks.getApplySummary).toHaveBeenCalledWith(FUNNEL_DAYS);
  });

  it("点四个数字分别带上对应的下钻维度", async () => {
    const { onDrill } = renderBar();

    const drills = [
      [t("applyUi.funnel.applied"), "applied"],
      [t("applyUi.funnel.succeeded"), "succeeded"],
      [t("applyUi.funnel.failed"), "failed"],
      [t("applyUi.funnel.interviewing"), "interviewing"],
    ] as const;

    for (const [label, expected] of drills) {
      const button = await screen.findByRole("button", { name: new RegExp(label) });
      fireEvent.click(button);
      expect(onDrill).toHaveBeenLastCalledWith(expected);
    }
    expect(onDrill).toHaveBeenCalledTimes(4);
  });

  it("接口读不到时整条不渲染（不在页头挂一行错误）", async () => {
    apiMocks.getApplySummary.mockRejectedValue(new Error("summary 挂了"));

    const { container } = renderBar();

    // 等一轮微任务，确认不是"还没渲染"造成的假阴性。
    await Promise.resolve();
    expect(container.querySelector(".apply-funnel-bar")).toBeNull();
    expect(screen.queryByText(t("applyUi.funnel.applied"))).not.toBeInTheDocument();
  });
});
