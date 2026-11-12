// SPDX-License-Identifier: Apache-2.0
/** 横向对比结果：名次、理由、短板与降级说明。 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n";
import type { JobComparisonResult, JobMatchBatchItem } from "../../types";
import JobComparisonResultView from "./JobComparisonResult";

afterEach(cleanup);

const ITEMS: JobMatchBatchItem[] = [
  {
    job_id: 1,
    job_title: "Backend Engineer",
    company: "Acme",
    status: "completed",
    rank: 1,
    reference_score: null,
    result: null,
    model: "",
    analysis_source: "local",
    error: "",
  },
  {
    job_id: 2,
    job_title: "Product Assistant",
    company: "Beta",
    status: "completed",
    rank: 2,
    reference_score: null,
    result: null,
    model: "",
    analysis_source: "local",
    error: "",
  },
];

const COMPARISON: JobComparisonResult = {
  summary: "The backend role at Acme fits you best",
  items: [
    {
      job_id: 1,
      rank: 1,
      verdict: "best",
      headline: "All hard requirements met",
      reasons: ["Three hard requirements matched", "Only one bonus item missing"],
      concerns: ["Team management experience is not in your profile"],
    },
    {
      job_id: 2,
      rank: 2,
      verdict: "fair",
      headline: "Different direction",
      reasons: ["One core ability is a real gap"],
      concerns: [],
    },
  ],
  notes: ["Ranking is relative to this batch"],
  error: "",
  model: "demo-model",
};

describe("JobComparisonResult", () => {
  it("renders rank, reasons and concerns, and keeps the disclaimer", () => {
    render(<JobComparisonResultView comparison={COMPARISON} items={ITEMS} />);

    expect(screen.getByText(COMPARISON.summary)).toBeInTheDocument();
    expect(screen.getByText(t("jobMatchBatch.comparison.rank", { rank: 1 }))).toBeInTheDocument();
    expect(screen.getByText(t("jobMatchBatch.comparison.rank", { rank: 2 }))).toBeInTheDocument();
    expect(screen.getByText(t("jobMatchBatch.comparison.verdict.best"))).toBeInTheDocument();
    expect(screen.getByText("Three hard requirements matched")).toBeInTheDocument();
    expect(
      screen.getByText(/Team management experience is not in your profile/),
    ).toBeInTheDocument();
    expect(screen.getByText(t("jobMatchBatch.comparison.disclaimer"))).toBeInTheDocument();
    expect(screen.getByText("Ranking is relative to this batch")).toBeInTheDocument();
  });

  it("does not invent a ranking when the comparison failed", () => {
    render(
      <JobComparisonResultView
        comparison={{ ...COMPARISON, items: [], summary: "", error: "Comparison timed out" }}
        items={ITEMS}
      />,
    );

    expect(screen.getByText("Comparison timed out")).toBeInTheDocument();
    expect(screen.queryByText(t("jobMatchBatch.comparison.rank", { rank: 1 }))).toBeNull();
  });
});
