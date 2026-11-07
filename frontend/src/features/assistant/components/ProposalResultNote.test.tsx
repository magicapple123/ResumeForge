// SPDX-License-Identifier: Apache-2.0
/** ProposalResultNote (T01-A): renders the terminal status line of a write proposal. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import type { AssistantProposalResult } from "../../../types";
import ProposalResultNote from "./ProposalResultNote";

const TARGET = "demo reminder";
const SUMMARY = "created one reminder";

function result(overrides: Partial<AssistantProposalResult> = {}): AssistantProposalResult {
  return {
    proposal_id: "p1",
    tool_name: "create_reminder",
    status: "executed",
    target: TARGET,
    summary: SUMMARY,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("ProposalResultNote", () => {
  it("shows status, target and result summary for an executed proposal", () => {
    render(<ProposalResultNote result={result()} />);
    expect(screen.getByText(t("assistantUi.proposalResult.status.executed"))).toBeTruthy();
    expect(screen.getByText(new RegExp(TARGET))).toBeTruthy();
    expect(screen.getByText(SUMMARY)).toBeTruthy();
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe(
      t("assistantUi.proposalResult.aria", { target: TARGET }),
    );
  });

  it("renders a failed proposal as failed, never as executed", () => {
    render(<ProposalResultNote result={result({ status: "failed", summary: "" })} />);
    expect(screen.getByText(t("assistantUi.proposalResult.status.failed"))).toBeTruthy();
    expect(screen.queryByText(t("assistantUi.proposalResult.status.executed"))).toBeNull();
  });

  it("renders expired proposals (the restart path) as expired", () => {
    render(<ProposalResultNote result={result({ status: "expired", summary: "" })} />);
    expect(screen.getByText(t("assistantUi.proposalResult.status.expired"))).toBeTruthy();
  });

  it("renders unknown results without implying the write failed", () => {
    render(<ProposalResultNote result={result({ status: "unknown", summary: "" })} />);
    expect(screen.getByText(t("assistantUi.proposalResult.status.unknown"))).toBeTruthy();
    expect(screen.queryByText(t("assistantUi.proposalResult.status.failed"))).toBeNull();
  });
});
