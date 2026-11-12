// SPDX-License-Identifier: Apache-2.0
/** A5 / #29a：场景变体的候选生成区（生成 → 看差异 → 采纳；接口层 mock，组件真实渲染）。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../api/client";
import { t } from "../../../i18n";
import ScenarioVariantSection from "./ScenarioVariantSection";

const api = vi.hoisted(() => ({
  previewScenarioVariant: vi.fn(),
  adoptScenarioVariant: vi.fn(),
}));

vi.mock("./versionsApi", () => ({
  previewScenarioVariant: api.previewScenarioVariant,
  adoptScenarioVariant: api.adoptScenarioVariant,
}));

const SNAPSHOT = {
  schema_version: 1,
  scenario_origin: "saved",
  scenario_id: 12,
  preset_key: null,
  scenario_revision: 3,
  catalog_version: "1",
  display_name: "Career switch",
  resolved_dimensions: {},
  approved_guidance: [],
  disclosure: { include_employment_status: false },
  context_sha256: "c".repeat(64),
};

const VARIANT = {
  id: 9,
  resume_id: 7,
  name: "Career switch variant",
  job_id: null,
  job_title: "",
  company: "",
  content_sha256: "a".repeat(64),
  base_version_id: null,
  last_synced_version_id: null,
  synced_at: null,
  context_snapshot: SNAPSHOT,
  created_at: "2026-10-25T10:00:00",
  updated_at: "2026-10-25T10:00:00",
};

const DIFF = {
  base_id: 9,
  against_id: 0,
  base_title: "Current variant",
  against_title: "Scenario candidate",
  lines: [{ type: "added", text: "+ new summary", tokens: [] }],
  stats: { added: 1, removed: 0, unchanged: 0 },
};

const PREVIEW = {
  variant: VARIANT,
  candidate_content: { summary: "new summary" },
  base_content_sha256: "a".repeat(64),
  candidate_content_sha256: "b".repeat(64),
  context_snapshot: SNAPSHOT,
  context_sha256: "c".repeat(64),
  content_diff: DIFF,
};

function renderSection(variants = [VARIANT], onChanged = vi.fn()) {
  render(
    <AntdApp>
      <ScenarioVariantSection resumeId={7} variants={variants} onChanged={onChanged} />
    </AntdApp>,
  );
  return onChanged;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("场景变体候选区", () => {
  it("#29a 没有场景变体时整块不渲染（创建入口已合并到 VariantCreatePanel）", () => {
    renderSection([]);
    expect(screen.queryByText(t("versions.variants.scenario.title"))).toBeNull();
    expect(
      screen.queryByRole("button", { name: t("careerScenarios.variant.generate") }),
    ).toBeNull();
  });

  it("生成候选只预览不落库，采纳时回传双哈希与场景引用", async () => {
    api.previewScenarioVariant.mockResolvedValue(PREVIEW);
    api.adoptScenarioVariant.mockResolvedValue({ ...VARIANT, content: { summary: "new summary" } });
    const onChanged = renderSection();

    fireEvent.click(
      await screen.findByRole("button", { name: t("careerScenarios.variant.generate") }),
    );
    await waitFor(() => {
      expect(api.previewScenarioVariant).toHaveBeenCalledWith(
        7,
        9,
        {
          career_context: { scenario_id: 12, expected_revision: 3 },
          instructions: "",
        },
        // T04-d：生成候选可被「停止」掐断，末尾参数是 AbortSignal。
        expect.anything(),
      );
    });
    await screen.findByText(t("careerScenarios.variant.diffTitle"));

    fireEvent.click(screen.getByRole("button", { name: t("careerScenarios.variant.adopt") }));
    await waitFor(() => {
      expect(api.adoptScenarioVariant).toHaveBeenCalledWith(7, 9, {
        content: { summary: "new summary" },
        expected_content_sha256: "a".repeat(64),
        expected_context_sha256: "c".repeat(64),
        career_context: { scenario_id: 12, expected_revision: 3 },
      });
    });
    await waitFor(() => {
      expect(screen.queryByText(t("careerScenarios.variant.diffTitle"))).toBeNull();
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("变体在别处被改过时显示明确冲突文案，不自动覆盖", async () => {
    api.previewScenarioVariant.mockRejectedValue(
      new ApiError("conflict", 409, { businessCode: "variant_content_conflict" }),
    );
    renderSection();
    fireEvent.click(
      await screen.findByRole("button", { name: t("careerScenarios.variant.generate") }),
    );
    await screen.findByText(t("careerScenarios.variant.conflictVariant"));
    expect(api.adoptScenarioVariant).not.toHaveBeenCalled();
  });
});
