// SPDX-License-Identifier: Apache-2.0
/**
 * #15D 编辑器内联推荐（`ResumeFitHint`）：15D 的主 UX 就在这里。
 *
 * 两条判据：
 * - `gain > 0`：把「关键词覆盖 40% → 75%」和「换用」都渲染出来，且点击「换用」回调收到的
 *   是 `recommended_resume_id`（只断言"按钮存在"等于没测）；
 * - `gain <= 0`（含 `current_coverage = null` 的后端兜底形态）：返回 `null`，一个字都不渲染
 *   —— 界面上不该出现"点了只会变差"的建议。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ApplyResumeFitList } from "../../../types";

const apiMocks = vi.hoisted(() => ({
  getResumeFit: vi.fn(),
  listResumes: vi.fn(),
}));

vi.mock("../../../api/applyInsights", () => ({
  getResumeFit: apiMocks.getResumeFit,
}));

vi.mock("../../../api/resumes", () => ({
  listResumes: apiMocks.listResumes,
}));

import ResumeFitHint from "./ResumeFitHint";

const RECOMMENDED_ID = 5;
const QUEUE_ID = 7;

/** 有提升的一条建议：当前 40% / 推荐 75%。 */
const WITH_GAIN: ApplyResumeFitList = {
  items: [
    {
      queue_id: QUEUE_ID,
      job_id: 11,
      current_resume_id: 3,
      current_coverage: 40,
      recommended_resume_id: RECOMMENDED_ID,
      recommended_coverage: 75,
      gain: 35,
      reason: "more keyword hits",
    },
  ],
};

/**
 * 匹配按钮文案时容忍 antd 给"两个汉字"插的空格（渲染成「换 用」）。
 *
 * 不能把文案写死进测试（i18n 棘轮：测试里的中文断言行也只许降不许升），所以在
 * `t()` 取到文案之后逐字插 `\s*`，中英文都适用。
 */
function flexible(label: string): RegExp {
  const escaped = label.split("").map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(escaped.join("\\s*"));
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getResumeFit.mockResolvedValue(WITH_GAIN);
  apiMocks.listResumes.mockResolvedValue({
    items: [{ id: RECOMMENDED_ID, title: "Backend edition" }],
    total: 1,
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeFitHint", () => {
  it("shows coverage 40% -> 75% and hands the recommended Resume id to the callback", async () => {
    const onApply = vi.fn();
    render(<ResumeFitHint queueId={QUEUE_ID} onApply={onApply} />);

    // 文案里三个要素都要在：简历名、当前覆盖、换后覆盖。
    const expected = t("applyQueue.insights.fit.recommendInline", {
      title: "Backend edition",
      from: 40,
      to: 75,
    });
    expect(await screen.findByText(expected)).toBeInTheDocument();
    // 建议是按**队列条目 id** 取的（不是岗位 id）。
    expect(apiMocks.getResumeFit).toHaveBeenCalledWith([QUEUE_ID]);

    fireEvent.click(
      screen.getByRole("button", { name: flexible(t("applyQueue.insights.fit.swap")) }),
    );

    // 关键断言：回传的是推荐简历 id，编辑器据此写进表单。
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(RECOMMENDED_ID);
  });

  it("renders nothing when there is no gain (including a null current coverage)", async () => {
    // 两种"没有收益"的形态：覆盖已经最高（40 → 40），以及后端在无当前简历时的兜底
    // （current_coverage = null / recommended = 0 / gain = 0）。两者都必须是"一个字都不显示"。
    const fixtures = [
      {
        queue_id: QUEUE_ID,
        job_id: 11,
        current_resume_id: 3,
        current_coverage: 40,
        recommended_resume_id: RECOMMENDED_ID,
        recommended_coverage: 40,
        gain: 0,
        reason: "",
      },
      {
        queue_id: QUEUE_ID,
        job_id: 11,
        current_resume_id: null,
        current_coverage: null,
        recommended_resume_id: RECOMMENDED_ID,
        recommended_coverage: 0,
        gain: 0,
        reason: "",
      },
    ];

    for (const fit of fixtures) {
      apiMocks.getResumeFit.mockResolvedValue({ items: [fit] });
      apiMocks.getResumeFit.mockClear();
      const { container, unmount } = render(<ResumeFitHint queueId={QUEUE_ID} onApply={vi.fn()} />);

      // 等建议真的回来，再断言"回来之后依然什么都不显示"——否则只是"还没加载完"。
      await waitFor(() => expect(apiMocks.getResumeFit).toHaveBeenCalledTimes(1));
      // 用宏任务冲刷（状态提交发生在微任务里，必定早于它），确保断言看的是"数据已就位"的那次渲染。
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      // 简历名也不该漏出来（半个"推荐简历：…"比不显示更糟）。
      expect(screen.queryByText(/Backend edition/)).not.toBeInTheDocument();
      unmount();
      cleanup();
    }
  });
});
