// SPDX-License-Identifier: Apache-2.0
/**
 * #15E 边际收益停止线的三态。
 *
 * 三态的差别是**要不要打扰用户**，所以断言的重点是"渲染了什么"而不是"有没有返回"：
 * - `ok`：整条不渲染（常驻提醒是噪声）；
 * - `insufficient`：只有一行灰字「样本不足（N 条投递）」，**不出现任何百分比**；
 * - `past`：黄条 + 两个可点的动作（跟进待回音 / 改简历），且落点分别是 /tracker 与 /resumes。
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ApplyStoppingPoint } from "../../../types";

const apiMocks = vi.hoisted(() => ({
  getStoppingPoint: vi.fn(),
}));

vi.mock("../../../api/applyInsights", () => ({
  getStoppingPoint: apiMocks.getStoppingPoint,
}));

import ApplyStoppingPointTip from "./ApplyStoppingPointTip";

const PAST: ApplyStoppingPoint = {
  status: "past",
  applied: 24,
  interviews: 2,
  baseline_rate: 0.12,
  recent_rate: 0.03,
  weeks: [
    { start: "2026-10-05", applied: 6, interviews: 0 },
    { start: "2026-10-12", applied: 6, interviews: 0 },
    { start: "2026-10-19", applied: 6, interviews: 1 },
    { start: "2026-10-26", applied: 6, interviews: 1 },
  ],
  message: "backend message",
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getStoppingPoint.mockResolvedValue({ ...PAST, status: "ok" });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderTip() {
  return render(
    <MemoryRouter>
      <ApplyStoppingPointTip />
    </MemoryRouter>,
  );
}

describe("ApplyStoppingPointTip", () => {
  it("renders nothing before the turning point", async () => {
    const { container } = renderTip();

    // 等数据真的回来（`ok`），再断言"回来之后依然什么都不显示"——否则只是"还没加载完"。
    await waitFor(() => expect(apiMocks.getStoppingPoint).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a warning with both next actions once past the turning point", async () => {
    apiMocks.getStoppingPoint.mockResolvedValue(PAST);

    renderTip();

    expect(
      await screen.findByText(
        t("applyQueue.insights.stopping.past", {
          weeks: 4,
          recent: "3",
          baseline: "12",
          applied: 24,
        }),
      ),
    ).toBeInTheDocument();

    const followup = screen.getByRole("link", {
      name: t("applyQueue.insights.stopping.followup"),
    });
    const improve = screen.getByRole("link", { name: t("applyQueue.insights.stopping.improve") });
    expect(followup).toHaveAttribute("href", "/tracker");
    expect(improve).toHaveAttribute("href", "/resumes");
  });

  it("says only 'not enough samples (3 applications)' below ten applications", async () => {
    apiMocks.getStoppingPoint.mockResolvedValue({
      ...PAST,
      status: "insufficient",
      applied: 3,
      baseline_rate: null,
      recent_rate: null,
      weeks: [],
    });

    const { container } = renderTip();

    expect(
      await screen.findByText(t("applyQueue.insights.stopping.insufficient", { applied: 3 })),
    ).toBeInTheDocument();
    // 样本不足时不给比率，也就没有可点的动作。
    expect(container.textContent).not.toMatch(/%/);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("stays invisible when the endpoint fails", async () => {
    apiMocks.getStoppingPoint.mockRejectedValue(new Error("boom"));

    const { container } = renderTip();

    await waitFor(() => expect(apiMocks.getStoppingPoint).toHaveBeenCalledTimes(1));
    // 失败也被吞掉：记录页顶部不该多出一块红。
    await act(async () => {
      await Promise.resolve();
    });
    expect(container).toBeEmptyDOMElement();
  });
});
