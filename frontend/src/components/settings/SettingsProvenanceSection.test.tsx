// SPDX-License-Identifier: Apache-2.0
/** 设置页「外发与用量」：按钮触发、真实请求、正文只留 state（不落盘）。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pt } from "../../features/resume-provenance/i18n";
import SettingsProvenanceSection from "./SettingsProvenanceSection";

const apiMocks = vi.hoisted(() => ({
  fetchUsageSummary: vi.fn(),
  fetchUsagePricing: vi.fn(),
  fetchUsagePricingRecords: vi.fn(),
  saveUsagePricing: vi.fn(),
  renameUsagePricingRecord: vi.fn(),
  activateUsagePricingRecord: vi.fn(),
  deleteUsagePricingRecord: vi.fn(),
  previewOutbound: vi.fn(),
}));
vi.mock("../../features/resume-provenance/api", () => apiMocks);

const USAGE = {
  dataset_id: "demo",
  records: 2,
  since: null,
  tasks: [],
  models: [],
  totals: {
    key: "total",
    calls: 2,
    retries: 0,
    prompt_tokens: 120,
    completion_tokens: 80,
    total_tokens: 200,
    duration_ms: 1500,
    unknown_token_calls: 0,
  },
  unknown_token_records: 0,
  cost: { estimated: false, currency: "USD", amount: null, reason: "not_configured" },
};

beforeEach(() => {
  apiMocks.fetchUsageSummary.mockResolvedValue(USAGE);
  apiMocks.fetchUsagePricing.mockResolvedValue({
    configured: true,
    input_cache_hit_per_million: 0.5,
    input_cache_miss_per_million: 4,
    output_per_million: 8,
    currency: "USD",
    source: "record",
    record_id: 1,
    name: "官方价",
  });
  apiMocks.fetchUsagePricingRecords.mockResolvedValue({ items: [], count: 0 });
  apiMocks.saveUsagePricing.mockImplementation((payload: unknown) => Promise.resolve(payload));
  apiMocks.previewOutbound.mockResolvedValue({
    target_service: "本地 Ollama",
    material_categories: ["简历正文"],
    attachment_types: [],
    excluded_fields: [],
    fetch_pages: false,
    body_preview: "一段简历正文",
    body_chars: 6,
    body_truncated: false,
    body_sha256: "sha",
    secret_leak_detected: false,
    persistence: "memory_only",
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("SettingsProvenanceSection", () => {
  it("用量按钮触发真实请求并渲染汇总", async () => {
    render(
      <AntdApp>
        <SettingsProvenanceSection targetService="本地 Ollama" />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole("button", { name: pt("settings.provenance.loadUsage") }));
    await waitFor(() => expect(apiMocks.fetchUsageSummary).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(pt("provenance.usage.title"))).toBeTruthy();
  });

  it("单价：三档 + 名称，保存后调用 PUT 并刷新记录", async () => {
    render(
      <AntdApp>
        <SettingsProvenanceSection targetService="本地 Ollama" />
      </AntdApp>,
    );
    await waitFor(() => expect(apiMocks.fetchUsagePricingRecords).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(pt("settings.provenance.pricing.hit")), {
      target: { value: "0.5" },
    });
    fireEvent.change(screen.getByLabelText(pt("settings.provenance.pricing.miss")), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText(pt("settings.provenance.pricing.output")), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText(pt("settings.provenance.pricing.nameLabel")), {
      target: { value: "官方价" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(pt("settings.provenance.pricing.save")) }),
    );

    await waitFor(() => expect(apiMocks.saveUsagePricing).toHaveBeenCalledTimes(1));
    // 单位是每百万 token，三档分别下发；名称跟着一起存。
    expect(apiMocks.saveUsagePricing.mock.calls[0][0]).toMatchObject({
      name: "官方价",
      input_cache_hit_per_million: 0.5,
      input_cache_miss_per_million: 4,
      output_per_million: 8,
      currency: "USD",
    });
  });

  it("外发预览用真实接口，带上目标服务与正文；正文不写任何存储", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(
      <AntdApp>
        <SettingsProvenanceSection targetService="本地 Ollama" />
      </AntdApp>,
    );
    fireEvent.change(screen.getByLabelText(pt("settings.provenance.previewBody")), {
      target: { value: "Resume body text" },
    });
    fireEvent.click(screen.getByRole("button", { name: pt("settings.provenance.preview") }));
    await waitFor(() => expect(apiMocks.previewOutbound).toHaveBeenCalledTimes(1));
    expect(apiMocks.previewOutbound.mock.calls[0][0]).toMatchObject({
      target_service: "本地 Ollama",
      body: "Resume body text",
    });
    expect((await screen.findAllByText(pt("provenance.outbound.title"))).length).toBeGreaterThan(0);
    expect(setItem).not.toHaveBeenCalled();
  });
});
