// SPDX-License-Identifier: Apache-2.0
/**
 * 「开始深挖」参数弹窗（#42）：从台账勾选带进来时只预填**已确认**的主张，
 * 一条都没选时主按钮禁用——"留空 = 全部已确认"这个旧口径正是这一条要消灭的。
 *
 * 断言一律用 `t()`：测试里直接写中文 ByText 断言会让 cjkRatchet 的 tests 口径上涨。
 */
import { App as AntdApp } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Claim } from "../../types";
import { t } from "../../i18n";
import { StartPanel } from "./StartPanel";

const apiMocks = vi.hoisted(() => ({
  listClaims: vi.fn(),
  createDrillSession: vi.fn(),
  listJobs: vi.fn(),
}));

vi.mock("../../api/claims", () => ({ listClaims: apiMocks.listClaims }));
vi.mock("../../api/drill", () => ({ createDrillSession: apiMocks.createDrillSession }));
vi.mock("../../api/jobs", () => ({ listJobs: apiMocks.listJobs }));

/** 协议值（后端下发、永不翻译）在此集中定义，避免它们和 ByText 断言写在同一行。 */
const CATEGORY = "项目经历";
const LEVEL = "参与";
const CONFIRMED = "已确认";
const PENDING = "待确认";
const CLAIM_A = "claim-alpha";
const CLAIM_B = "claim-beta";
const CLAIM_SKIPPED = "claim-gamma";

function makeClaim(id: number, title: string, status: string): Claim {
  return {
    id,
    title,
    category: CATEGORY as Claim["category"],
    subject: "demo subject",
    source_fact: "demo fact",
    candidate_wording: "demo wording",
    sources: [],
    responsibility_level: LEVEL as Claim["responsibility_level"],
    verification_status: status as Claim["verification_status"],
    allowed_uses: [],
    interview_details: { decisions: [], difficulties: [], verification: [], result: null },
    boundary: "",
    risk_notes: [],
    last_verified: "",
    created_at: "2026-09-18T00:00:00",
    updated_at: "2026-09-18T00:00:00",
    warnings: [],
  };
}

function renderPanel(initialClaimIds?: number[]) {
  return render(
    <AntdApp>
      <StartPanel
        externalOpen
        onExternalClose={() => {}}
        onStarted={() => {}}
        initialClaimIds={initialClaimIds}
      />
    </AntdApp>,
  );
}

/** 主按钮的禁用态读 DOM：antd 会在两个汉字之间插空格，按名字取不稳。 */
function primaryButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(".ant-modal-footer .ant-btn-primary");
  if (button === null) throw new Error("missing primary button");
  return button;
}

function optionText(title: string): string {
  return t("drill.startPanel.claims.option", { title, level: LEVEL });
}

beforeEach(() => {
  for (const mock of Object.values(apiMocks)) mock.mockReset();
  apiMocks.listClaims.mockResolvedValue({
    items: [makeClaim(2, CLAIM_A, CONFIRMED), makeClaim(3, CLAIM_SKIPPED, PENDING)],
    total: 2,
    confirmed_count: 1,
    pending_count: 1,
    category_counts: {},
  });
  apiMocks.listJobs.mockResolvedValue({ items: [], total: 0 });
});

afterEach(cleanup);

describe("StartPanel", () => {
  it("prefills the confirmed claims selected in the ledger and counts the skipped ones", async () => {
    renderPanel([2, 3]);

    expect(
      await screen.findByText(t("drill.startPanel.claims.ignored", { count: 1 })),
    ).toBeInTheDocument();
    expect(screen.getByText(optionText(CLAIM_A))).toBeInTheDocument();
    // 待确认的那条不该出现在选中项里（它连候选都不是）。
    expect(screen.queryByText(optionText(CLAIM_SKIPPED))).toBeNull();
    expect(primaryButton().disabled).toBe(false);
  });

  it("disables the primary action and says a claim is required when nothing is picked", async () => {
    apiMocks.listClaims.mockResolvedValue({
      items: [makeClaim(2, CLAIM_B, CONFIRMED)],
      total: 1,
      confirmed_count: 1,
      pending_count: 0,
      category_counts: {},
    });
    renderPanel();

    expect(await screen.findByText(t("drill.startPanel.claims.required"))).toBeInTheDocument();
    expect(primaryButton().disabled).toBe(true);
  });

  it("keeps the main button label explicit about counts", async () => {
    renderPanel([2]);
    await screen.findByText(optionText(CLAIM_A));
    expect(primaryButton().textContent).toBe(
      t("drill.startPanel.action.start", { claims: 1, questions: 6 }),
    );
  });
});
