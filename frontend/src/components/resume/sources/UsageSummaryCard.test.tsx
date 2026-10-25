// SPDX-License-Identifier: Apache-2.0
/** R04 用量卡：结束原因与费用估算（未知 token 不给 0、未配置单价不估算）。 */
import { App as AntdApp } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { pt } from "../../../features/resume-provenance/i18n";
import type { UsageSummaryOut } from "../../../features/resume-provenance/types";
import UsageSummaryCard from "./UsageSummaryCard";

function summary(overrides: Partial<UsageSummaryOut> = {}): UsageSummaryOut {
  const bucket = {
    key: "total",
    calls: 3,
    retries: 0,
    prompt_tokens: 300,
    completion_tokens: 200,
    total_tokens: 500,
    duration_ms: 1200,
    unknown_token_calls: 0,
  };
  return {
    dataset_id: "demo",
    records: 3,
    since: null,
    tasks: [{ ...bucket, key: "resume_revise" }],
    models: [{ ...bucket, key: "deepseek" }],
    totals: bucket,
    unknown_token_records: 0,
    cost: { estimated: false, currency: "USD", amount: null, reason: "not_configured" },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

function renderCard(value: UsageSummaryOut) {
  render(
    <AntdApp>
      <UsageSummaryCard summary={value} />
    </AntdApp>,
  );
}

describe("UsageSummaryCard", () => {
  it("结束原因计数按 finish_reason 展示，未知值原样显示", () => {
    renderCard(
      summary({
        totals: { ...summary().totals, finish_reasons: { stop: 2, mystery: 1 } },
      }),
    );
    expect(screen.getByText(pt("provenance.usage.finishReasons"))).toBeTruthy();
    expect(screen.getByText(pt("provenance.usage.finishReason.stop"))).toBeTruthy();
    expect(screen.getByText("mystery")).toBeTruthy();
  });

  it("未配置单价：不给出金额（不拿 0 冒充）", () => {
    renderCard(summary());
    expect(screen.getByText(pt("provenance.usage.costUnavailable"))).toBeTruthy();
  });

  it("配置单价后：显示估算金额与说明", () => {
    renderCard(summary({ cost: { estimated: true, currency: "USD", amount: 0.42, reason: "" } }));
    expect(screen.getByText(/0\.42/)).toBeTruthy();
    expect(screen.getByText(pt("provenance.usage.costEstimated"))).toBeTruthy();
  });
});
