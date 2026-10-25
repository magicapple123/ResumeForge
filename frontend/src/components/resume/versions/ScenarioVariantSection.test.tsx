// SPDX-License-Identifier: Apache-2.0
/** A5：场景变体面板（创建 → 生成候选 → 看差异 → 采纳；接口层 mock，组件真实渲染）。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../api/client";
import { t } from "../../../i18n";
import ScenarioVariantSection from "./ScenarioVariantSection";

const api = vi.hoisted(() => ({
  fetchCareerScenarioCatalog: vi.fn(),
  listCareerScenarios: vi.fn(),
  createScenarioVariant: vi.fn(),
  previewScenarioVariant: vi.fn(),
  adoptScenarioVariant: vi.fn(),
}));

vi.mock("../../../features/career-scenarios/api", () => ({
  fetchCareerScenarioCatalog: api.fetchCareerScenarioCatalog,
  listCareerScenarios: api.listCareerScenarios,
}));

vi.mock("../../../features/resume-versions/versionsApi", () => ({
  createScenarioVariant: api.createScenarioVariant,
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
  display_name: "跨行转岗",
  resolved_dimensions: {},
  approved_guidance: [],
  disclosure: { include_employment_status: false },
  context_sha256: "c".repeat(64),
};

const VARIANT = {
  id: 9,
  resume_id: 7,
  name: "跨行转岗版",
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
  base_title: "当前变体",
  against_title: "场景候选",
  lines: [{ type: "added", text: "+ 新总结", tokens: [] }],
  stats: { added: 1, removed: 0, unchanged: 0 },
};

const PREVIEW = {
  variant: VARIANT,
  candidate_content: { summary: "新总结" },
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
  api.fetchCareerScenarioCatalog.mockResolvedValue({
    catalog_version: "1",
    schema_version: 1,
    limits: {},
    presets: [
      { key: "cross_industry", name: "跨行转岗", config: {}, suggested_sections: [], guidance: [] },
    ],
  });
  api.listCareerScenarios.mockResolvedValue({ items: [], total: 0 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("场景变体面板", () => {
  it("没有变体时提示空态，名称与场景未填全时创建按钮禁用", async () => {
    renderSection([]);
    await screen.findByText(t("careerScenarios.variant.empty"));
    const create = screen.getByRole("button", { name: t("careerScenarios.variant.create") });
    expect((create as HTMLButtonElement).disabled).toBe(true);
  });

  it("选快捷场景 + 起名后派生变体，并通知宿主刷新", async () => {
    const onChanged = renderSection([]);
    await waitFor(() => expect(document.querySelectorAll("input").length).toBeGreaterThan(1));
    const nameInput = document.querySelector<HTMLInputElement>("input[placeholder]");
    if (!nameInput) throw new Error("缺少变体名称输入框");
    fireEvent.change(nameInput, { target: { value: "跨行版" } });
    fireEvent.mouseDown(screen.getByRole("combobox"));
    // i18n-ok: 断言固定的快捷场景演示名
    fireEvent.click(await screen.findByText("跨行转岗"));
    api.createScenarioVariant.mockResolvedValue(VARIANT);
    fireEvent.click(screen.getByRole("button", { name: t("careerScenarios.variant.create") }));
    await waitFor(() => {
      expect(api.createScenarioVariant).toHaveBeenCalledWith(7, {
        name: "跨行版",
        career_context: { preset_key: "cross_industry", catalog_version: "1" },
      });
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("生成候选只预览不落库，采纳时回传双哈希与场景引用", async () => {
    api.previewScenarioVariant.mockResolvedValue(PREVIEW);
    api.adoptScenarioVariant.mockResolvedValue({ ...VARIANT, content: { summary: "新总结" } });
    const onChanged = renderSection();

    fireEvent.click(
      await screen.findByRole("button", { name: t("careerScenarios.variant.generate") }),
    );
    await waitFor(() => {
      expect(api.previewScenarioVariant).toHaveBeenCalledWith(7, 9, {
        career_context: { scenario_id: 12, expected_revision: 3 },
        instructions: "",
      });
    });
    await screen.findByText(t("careerScenarios.variant.diffTitle"));

    fireEvent.click(screen.getByRole("button", { name: t("careerScenarios.variant.adopt") }));
    await waitFor(() => {
      expect(api.adoptScenarioVariant).toHaveBeenCalledWith(7, 9, {
        content: { summary: "新总结" },
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
