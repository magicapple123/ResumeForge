// SPDX-License-Identifier: Apache-2.0
/**
 * 交付单契约测试（T09）：**三份 fixture 只有 state 不同**，必须渲染三种徽标；
 * 三态优先级由后端给，前端不重算——用"自相矛盾"的 fixture 证明这一点：
 * state=ready 但疑点>0、有人工步骤、页数超上限，仍然只能显示「可验收」；
 * state=waiting_human 但疑点为 0、人工步骤为空，仍然只能显示「卡在人手上」。
 *
 * 另有一条源码断言：组件里不得出现对 state 的比较（只有"协议值 → 展示名"映射表）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
// @ts-expect-error 同上。
import { dirname, join } from "node:path";
// @ts-expect-error 同上。
import { fileURLToPath } from "node:url";
import type { DeliveryReceipt as DeliveryReceiptData } from "../../../api/deliveryReceipt";
import { t } from "../../../i18n";
import DeliveryReceipt from "./DeliveryReceipt";

const apiMocks = vi.hoisted(() => ({
  getDeliveryReceipt: vi.fn(),
  ackDeliveryReceipt: vi.fn(),
}));

vi.mock("../../../api/deliveryReceipt", () => ({
  getDeliveryReceipt: apiMocks.getDeliveryReceipt,
  ackDeliveryReceipt: apiMocks.ackDeliveryReceipt,
}));

/** 三份 fixture 的共同部分：除 state 外完全相同（仅 state 不同才证明徽标由 state 决定）。 */
const BASE: DeliveryReceiptData = {
  record_id: 7,
  state: "ready",
  state_reasons: [],
  delivery: {
    track_id: 12,
    resume_title: "Backend resume",
    company: "Example Corp",
    job_title: "Backend Engineer",
    pages: 1,
    page_limit: 2,
    export_format: "pdf",
    request_params: { template: "classic" },
    content_sha256: "a".repeat(64),
    artifact_sha256: "b".repeat(64),
    created_at: "2026-11-09T08:00:00",
    resume_changed_since_delivery: false,
  },
  fill: {
    matched: true,
    unknown: false,
    url: "https://example.com/apply",
    filled_count: 12,
    total_count: 12,
    failed_count: 0,
  },
  doubts: { count: 0 },
  human_steps: [],
  followup: { reminder_id: 34, due_at: "2026-11-16T09:00:00" },
  receipt_acked_at: null,
};

function fixture(
  state: DeliveryReceiptData["state"],
  overrides: Partial<DeliveryReceiptData> = {},
) {
  return { ...BASE, state, ...overrides };
}

function renderReceipt() {
  render(
    <AntdApp>
      <DeliveryReceipt recordId={7} />
    </AntdApp>,
  );
}

async function renderWith(data: DeliveryReceiptData) {
  apiMocks.getDeliveryReceipt.mockResolvedValue(data);
  renderReceipt();
  return screen.findByTestId("delivery-receipt-7");
}

afterEach(() => {
  cleanup();
  apiMocks.getDeliveryReceipt.mockReset();
  apiMocks.ackDeliveryReceipt.mockReset();
});

describe("交付单三态徽标", () => {
  it("三份 fixture 仅 state 不同 → 三种徽标", async () => {
    await renderWith(fixture("waiting_human"));
    expect(screen.getByTestId("delivery-receipt-state").textContent).toBe(
      t("deliveryReceipt.state.waiting_human"),
    );
    cleanup();

    await renderWith(fixture("has_doubts"));
    expect(screen.getByTestId("delivery-receipt-state").textContent).toBe(
      t("deliveryReceipt.state.has_doubts"),
    );
    cleanup();

    await renderWith(fixture("ready"));
    expect(screen.getByTestId("delivery-receipt-state").textContent).toBe(
      t("deliveryReceipt.state.ready"),
    );
  });

  it("state=ready 时，即使疑点 >0、有人工步骤、页数超上限，也仍只显示可验收", async () => {
    await renderWith(
      fixture("ready", {
        doubts: { count: 5 },
        human_steps: ["captcha_required", "confirm_in_browser"],
        state_reasons: [],
      }),
    );
    expect(screen.getByTestId("delivery-receipt-state").textContent).toBe(
      t("deliveryReceipt.state.ready"),
    );
    expect(screen.queryByText(t("deliveryReceipt.state.waiting_human"))).toBeNull();
    expect(screen.queryByText(t("deliveryReceipt.state.has_doubts"))).toBeNull();
    // 疑点与人工步骤仍然如实展示（只是不参与三态）。
    expect(screen.getByText(t("deliveryReceipt.doubts.count", { count: 5 }))).toBeTruthy();
    expect(screen.getByText(t("deliveryReceipt.reason.captcha_required"))).toBeTruthy();
  });

  it("state=waiting_human 时，疑点为 0、人工步骤为空也仍是卡在人手上", async () => {
    await renderWith(
      fixture("waiting_human", { doubts: { count: 0 }, human_steps: [], state_reasons: [] }),
    );
    expect(screen.getByTestId("delivery-receipt-state").textContent).toBe(
      t("deliveryReceipt.state.waiting_human"),
    );
    expect(screen.queryByText(t("deliveryReceipt.state.ready"))).toBeNull();
  });

  it("state_reasons 的稳定码翻成展示名；未登记码显示原码", async () => {
    await renderWith(
      fixture("waiting_human", {
        state_reasons: ["captcha_required", "brand_new_reason"],
      }),
    );
    expect(screen.getByText(t("deliveryReceipt.reason.captcha_required"))).toBeTruthy();
    expect(screen.getByText("brand_new_reason")).toBeTruthy();
  });

  it("未知 state 不崩：显示未识别状态并带原码", async () => {
    await renderWith({
      ...BASE,
      state: "mystery" as DeliveryReceiptData["state"],
    });
    expect(screen.getByText(t("deliveryReceipt.stateUnknown"))).toBeTruthy();
    expect(screen.getByText("mystery")).toBeTruthy();
  });
});

describe("交付单内容与验收", () => {
  it("没有投递快照时如实说明（历史记录），徽标仍在", async () => {
    await renderWith(fixture("waiting_human", { delivery: null, followup: null }));
    expect(screen.getByText(t("deliveryReceipt.empty.snapshot"))).toBeTruthy();
    expect(screen.getByTestId("delivery-receipt-state")).toBeTruthy();
    expect(screen.getByText(t("deliveryReceipt.followup.none"))).toBeTruthy();
  });

  it("apply 路径快照没有产物信息时显示未记录，不当缺件、不改三态", async () => {
    await renderWith(
      fixture("waiting_human", {
        state_reasons: ["artifact_missing"],
        delivery: {
          ...BASE.delivery!,
          pages: null,
          page_limit: null,
          export_format: null,
          artifact_sha256: null,
        },
      }),
    );
    expect(screen.getAllByText(t("deliveryReceipt.field.notRecorded")).length).toBeGreaterThan(0);
    expect(screen.getByText(t("deliveryReceipt.reason.artifact_missing"))).toBeTruthy();
    expect(screen.getByTestId("delivery-receipt-state").textContent).toBe(
      t("deliveryReceipt.state.waiting_human"),
    );
  });

  it("指纹不同只标展示，不影响三态", async () => {
    await renderWith(
      fixture("ready", {
        delivery: { ...BASE.delivery!, resume_changed_since_delivery: true },
      }),
    );
    expect(screen.getByText(t("deliveryReceipt.field.resumeChanged"))).toBeTruthy();
    expect(screen.getByTestId("delivery-receipt-state").textContent).toBe(
      t("deliveryReceipt.state.ready"),
    );
  });

  it("验收调用 ack 端点并显示已验收；已验收的记录不再提供按钮", async () => {
    apiMocks.ackDeliveryReceipt.mockResolvedValue({
      receipt_acked_at: "2026-11-10T09:00:00",
      acked: true,
    });
    await renderWith(fixture("ready"));
    fireEvent.click(screen.getByTestId("delivery-receipt-ack"));
    await screen.findByTestId("delivery-receipt-acked");
    expect(apiMocks.ackDeliveryReceipt).toHaveBeenCalledWith(7);
    expect(screen.queryByTestId("delivery-receipt-ack")).toBeNull();
    cleanup();

    await renderWith(fixture("ready", { receipt_acked_at: "2026-11-10T09:00:00" }));
    expect(screen.getByTestId("delivery-receipt-acked")).toBeTruthy();
    expect(screen.queryByTestId("delivery-receipt-ack")).toBeNull();
  });

  it("ack 失败时保留按钮可重试", async () => {
    apiMocks.ackDeliveryReceipt.mockRejectedValue(new Error("ack failed"));
    await renderWith(fixture("ready"));
    fireEvent.click(screen.getByTestId("delivery-receipt-ack"));
    await screen.findByText("ack failed");
    expect(screen.getByTestId("delivery-receipt-ack")).toBeTruthy();
  });
});

describe("tsx 内不做聚合与阈值计算", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "DeliveryReceipt.tsx"),
    "utf8",
  );

  it("组件不比较 state（只有协议值 → 展示名的映射表）", () => {
    expect(source).not.toMatch(/state\s*===/);
    expect(source).not.toMatch(/state\s*!==/);
  });

  it("组件不按疑点数 / 页数重新判定三态，也不做聚合", () => {
    expect(source).not.toMatch(/doubts\.count\s*[><]/);
    expect(source).not.toMatch(/page_limit\s*[<>]/);
    // 人工步骤的 length 只用于"没有人工步骤"这句空态，不参与三态；聚合/数学运算一律不许有。
    expect(source).not.toMatch(/\.reduce\(/);
    expect(source).not.toMatch(/Math\./);
  });
});
