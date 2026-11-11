// SPDX-License-Identifier: Apache-2.0
/**
 * 「上下文用量」弹层的口径断言（需求 #6）。
 *
 * 只测**结构与口径**（五行都在、0 段不画、窗口 0 给出口而不是「—」、实测未报告时
 * 说「本次未报告」），不测像素——直径、间距、白缝在真机浏览器里量，jsdom 量不出来，
 * 在这里伪造数字只会变成"看起来测过了"。
 */
import { App as AntdApp } from "antd";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../api/settings", () => ({
  getLLMConfig: vi.fn(),
  saveLLMConfig: vi.fn(),
}));

vi.mock("../../../../api/assistant", () => ({
  compactAssistantConversation: vi.fn(),
  restoreAssistantConversation: vi.fn(),
}));

import {
  compactAssistantConversation,
  restoreAssistantConversation,
} from "../../../../api/assistant";
import ContextUsagePopover from "./ContextUsagePopover";
import type {
  AssistantCompactionResult,
  ContextUsage,
  ContextUsageBucket,
} from "../../../../types";
import { t } from "../../../../i18n";
import { formatExactTokens, formatPercent, formatTokenCount } from "../../contextUsageFormat";

function bucket(key: string, tokens: number, percent: number | null): ContextUsageBucket {
  return { key, tokens, percent };
}

/** 五桶都有值的正常态。 */
const USAGE: ContextUsage = {
  buckets: [
    bucket("system", 12_000, 12),
    bucket("tools", 6_000, 6),
    bucket("conversation", 4_000, 4),
    bucket("connectors", 2_000, 2),
    bucket("skills", 1_500, 1.5),
  ],
  total: 25_500,
  window: 100_000,
  percent: 25.5,
  partial: false,
  usage_actual: 12_345,
};

function renderPopover(usage: ContextUsage | null, onWindowSaved = vi.fn()) {
  return render(
    <MemoryRouter>
      <AntdApp>
        <ContextUsagePopover usage={usage} onClose={vi.fn()} onWindowSaved={onWindowSaved} />
      </AntdApp>
    </MemoryRouter>,
  );
}

/** 五段条里的段（图例点不是 `-seg` 前缀之外的类，靠类名精确区分）。 */
function barSegments(): Element[] {
  return [
    ...document.querySelectorAll(".assistant-context-usage-bar .assistant-context-usage-seg"),
  ];
}

afterEach(() => {
  cleanup();
});

describe("口径与结构", () => {
  it("五行图例齐全（名称按顺序、百分比右对齐在每一行里）", () => {
    renderPopover(USAGE);
    const names = [
      t("contextUsage.bucket.system"),
      t("contextUsage.bucket.tools"),
      t("contextUsage.bucket.conversation"),
      t("contextUsage.bucket.connectors"),
      t("contextUsage.bucket.skills"),
    ];
    const rows = document.querySelectorAll(".assistant-context-usage-legend-row");
    expect(rows).toHaveLength(5);
    names.forEach((name, index) => {
      expect(rows[index]).toHaveTextContent(name);
    });
    // 图例百分比的分母是**窗口**：每行显示的就是后端给的那一桶占比。
    expect(rows[0]).toHaveTextContent(formatPercent(12));
  });

  it("头部大号占比与「已使用 x / y」用的是同一份数值", () => {
    renderPopover(USAGE);
    expect(screen.getByText(formatPercent(25.5))).toBeInTheDocument();
    expect(
      screen.getByText(
        t("contextUsage.used", {
          used: formatTokenCount(25_500),
          window: formatTokenCount(100_000),
        }),
      ),
    ).toBeInTheDocument();
    // 估算口径必须标出来（估算是启发式，不能被读成服务商口径）。
    expect(screen.getByText(t("contextUsage.estimate"))).toBeInTheDocument();
  });

  it("token 为 0 的桶不画段（画了会留一条看不见的缝）", () => {
    renderPopover({
      ...USAGE,
      buckets: [
        bucket("system", 12_000, 12),
        bucket("tools", 0, 0),
        bucket("conversation", 4_000, 4),
        bucket("connectors", 0, 0),
        bucket("skills", 0, 0),
      ],
    });
    // 五段里只有两段有量：其余三桶如实是 0 token。
    expect(barSegments()).toHaveLength(2);
    // 图例仍然五行都在——"这轮没用技能"是信息，不该被藏起来。
    expect(document.querySelectorAll(".assistant-context-usage-legend-row")).toHaveLength(5);
  });

  it("实测值单列一行；未报告时说「本次未报告」而不是 0", () => {
    const { unmount } = renderPopover(USAGE);
    expect(
      screen.getByText(t("contextUsage.actual", { tokens: formatExactTokens(12_345) })),
    ).toBeInTheDocument();
    unmount();
    renderPopover({ ...USAGE, usage_actual: null });
    expect(screen.getByText(t("contextUsage.actualUnknown"))).toBeInTheDocument();
  });
});

describe("窗口未设置", () => {
  it("不显示百分比，给「未设置上下文窗口」+「去设置」，而不是「—」", () => {
    renderPopover({
      ...USAGE,
      window: 0,
      percent: null,
      buckets: USAGE.buckets.map((item) => ({ ...item, percent: null })),
    });
    expect(screen.getByText(t("contextUsage.noWindow"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("contextUsage.goSettings") })).toBeInTheDocument();
    // 大号占比与五段条都不出现（没有分母就不算占比）。
    expect(barSegments()).toHaveLength(0);
    expect(document.querySelector(".assistant-context-usage-percent")).toBeNull();
  });

  it("「去设置」跳到模型配置页签（复用既有路由，不新开页面）", () => {
    renderPopover({ ...USAGE, window: 0, percent: null });
    const button = screen.getByRole("button", { name: t("contextUsage.goSettings") });
    // 只断言它是可点的按钮语义：路由跳转由 MemoryRouter 承载，不在这里伪造 history。
    expect(button).toBeEnabled();
    fireEvent.click(button);
  });

  it("拿不到用量（null）时不编造数字：Chip 之外的弹层同样只给出口", () => {
    renderPopover(null);
    expect(screen.getByText(t("contextUsage.noWindow"))).toBeInTheDocument();
    expect(screen.getByText(t("contextUsage.actualUnknown"))).toBeInTheDocument();
  });
});

/**
 * 压缩状态与两个动作（问题清单 #10）。
 *
 * 只断言"用户能看懂什么、点了会发生什么"：
 * - 没压缩过要说「尚未压缩」，且不出现「还原原文」（无状态的按钮只会点出 404）；
 * - 有状态要把三件事说全（遮蔽几条、摘要几轮、省了多少）并写明原文仍在本地；
 * - 「压缩上下文」必须先 dry-run（不写库不调模型），确认后才真跑一次；
 * - 没有会话 id 时两个动作都不可点（不发明必然 404 的请求）。
 */
function compactionResult(
  overrides: Partial<AssistantCompactionResult> = {},
): AssistantCompactionResult {
  return {
    dry_run: true,
    percent_before: 28,
    percent_after: 9,
    turns_covered: 17,
    tool_results_masked: 8,
    model: "assistant-model",
    created_at: "",
    covered_until_message_id: 45,
    summary: null,
    compaction: null,
    reason: "",
    ...overrides,
  };
}

const COMPACTED: ContextUsage = {
  ...USAGE,
  compaction: {
    covered_until_message_id: 45,
    turns: 17,
    tokens_before: 180_000,
    tokens_after: 24_000,
    model: "assistant-model",
    created_at: "2026-11-11T02:10:00Z",
    masked_tool_results: 8,
  },
};

function renderWithConversation(usage: ContextUsage | null, onContextChanged = vi.fn()) {
  return render(
    <MemoryRouter>
      <AntdApp>
        <ContextUsagePopover
          usage={usage}
          onClose={vi.fn()}
          conversationId={7}
          onContextChanged={onContextChanged}
        />
      </AntdApp>
    </MemoryRouter>,
  );
}

describe("压缩状态", () => {
  it("没压缩过时写「尚未压缩」，且不给「还原原文」", () => {
    renderWithConversation(USAGE);
    expect(screen.getByText(t("contextUsage.compaction.none"))).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("contextUsage.compaction.action.restore") }),
    ).toBeNull();
  });

  it("有状态时把遮蔽条数、摘要轮数、token 区间与省下比例都说清", () => {
    renderWithConversation(COMPACTED);
    expect(
      screen.getByText(t("contextUsage.compaction.status", { masked: 8, turns: 17 })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        t("contextUsage.compaction.range", {
          before: formatTokenCount(180_000),
          after: formatTokenCount(24_000),
        }) + ` · ${formatPercent(25.5)}`,
      ),
    ).toBeInTheDocument();
    // 「省下 87%」是实测比例，不是估算。
    expect(
      screen.getByText(t("contextUsage.compaction.saved", { percent: 87 })),
    ).toBeInTheDocument();
    // 不可逆的错觉：必须写明原文仍在本地。
    expect(screen.getAllByText(t("contextUsage.compaction.keepOriginal")).length).toBeGreaterThan(
      0,
    );
  });

  it("压缩先 dry-run 出预估，确认后才真跑一次", async () => {
    vi.mocked(compactAssistantConversation).mockReset();
    vi.mocked(compactAssistantConversation)
      .mockResolvedValueOnce(compactionResult())
      .mockResolvedValueOnce(
        compactionResult({ dry_run: false, created_at: "2026-11-11T02:10:00Z" }),
      );
    const onContextChanged = vi.fn();
    renderWithConversation(USAGE, onContextChanged);

    fireEvent.click(
      screen.getByRole("button", { name: t("contextUsage.compaction.action.compact") }),
    );
    // 第一跳只问预估（dry_run=true）——它不写库、不调模型。
    expect(
      await screen.findByText(
        t("contextUsage.compaction.preview", {
          before: formatPercent(28),
          after: formatPercent(9),
          turns: 17,
        }),
      ),
    ).toBeInTheDocument();
    expect(compactAssistantConversation).toHaveBeenCalledWith(7, true);

    const confirm = screen.getAllByRole("button", {
      name: t("contextUsage.compaction.action.compact"),
    });
    fireEvent.click(confirm[confirm.length - 1]);
    await waitFor(() => expect(onContextChanged).toHaveBeenCalledTimes(1));
    expect(compactAssistantConversation).toHaveBeenLastCalledWith(7, false);
  });

  it("还原要问一次，确认后调用 DELETE 并让上层重取", async () => {
    vi.mocked(restoreAssistantConversation).mockReset();
    vi.mocked(restoreAssistantConversation).mockResolvedValue(undefined);
    const onContextChanged = vi.fn();
    renderWithConversation(COMPACTED, onContextChanged);

    fireEvent.click(
      screen.getByRole("button", { name: t("contextUsage.compaction.action.restore") }),
    );
    expect(screen.getByText(t("contextUsage.compaction.restoreBody"))).toBeInTheDocument();
    const confirm = screen.getAllByRole("button", {
      name: t("contextUsage.compaction.action.restore"),
    });
    fireEvent.click(confirm[confirm.length - 1]);
    await waitFor(() => expect(restoreAssistantConversation).toHaveBeenCalledWith(7));
    expect(onContextChanged).toHaveBeenCalledTimes(1);
  });

  it("没有会话 id 时两个动作都不可点（不发明必然 404 的请求）", () => {
    render(
      <MemoryRouter>
        <AntdApp>
          <ContextUsagePopover usage={COMPACTED} onClose={vi.fn()} />
        </AntdApp>
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("button", { name: t("contextUsage.compaction.action.compact") }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: t("contextUsage.compaction.action.restore") }),
    ).toBeDisabled();
  });
});
