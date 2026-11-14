// SPDX-License-Identifier: Apache-2.0
/**
 * 网申预览里的 AI 候选：未确认时展示置信度与证据，但**不能自动勾选**。
 *
 * 守的是「建议不等于决定」：自动勾选会让用户在一次点击里替所有低置信度候选背书。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { t } from "../../i18n";
import type { WebFormPreviewItem } from "../../types";
import WebFormPreviewTable from "./WebFormPreviewTable";

afterEach(cleanup);

it("shows confidence and evidence while an AI candidate remains unchecked", () => {
  const item: WebFormPreviewItem = {
    index: 0,
    field: "research_direction",
    field_label: "Research focus",
    value: "Distributed systems",
    control_label: "Topic of study",
    control_type: "text",
    status: "low_confidence",
    source: "ai",
    confidence: 0.69,
    evidence: "Topic of study",
    current_value: "",
    options: [],
    note: "",
  };
  render(
    <WebFormPreviewTable
      items={[item]}
      selected={new Set()}
      values={{}}
      onToggle={() => {}}
      onValueChange={() => {}}
    />,
  );
  expect(
    screen.getByText(
      t("webFormPage.preview.aiEvidence", { confidence: "69%", evidence: "Topic of study" }),
    ),
  ).toBeTruthy();
  expect(screen.getByRole("checkbox")).not.toBeChecked();
});
