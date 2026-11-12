// SPDX-License-Identifier: Apache-2.0
/**
 * 预设归一化/校验/请求翻译测试（契约 §6.3–§6.5）。
 */
import { describe, expect, it } from "vitest";
import {
  isSamePresetConfig,
  normalizePresetConfig,
  pickDefaultPreset,
  toBundleRequest,
  validatePresetConfig,
} from "./presets";
import { defaultPresetConfig, type ExportPresetConfig } from "./types";

describe("normalizePresetConfig", () => {
  it("缺字段用默认值、未知格式丢弃、格式去重并保序", () => {
    const normalized = normalizePresetConfig({
      formats: ["pdf", "pdf", "docx", "weird"],
      naming: "{name}",
      redact: true,
      include_photo: false,
    });
    expect(normalized.formats).toEqual(["pdf", "docx"]);
    expect(normalized.naming).toBe("{name}");
    expect(normalized.redact).toBe(true);
    expect(normalized.include_photo).toBe(false);
    expect(normalized.archive_original).toBe(false);
  });

  it("非对象/空格式退回默认配置", () => {
    expect(normalizePresetConfig(null)).toEqual(defaultPresetConfig());
    expect(normalizePresetConfig({ formats: [] }).formats).toEqual(["pdf"]);
  });
});

describe("validatePresetConfig", () => {
  it("至少一个格式；未知 token 拒绝保存并逐个指出", () => {
    const empty: ExportPresetConfig = { ...defaultPresetConfig(), formats: [] };
    expect(validatePresetConfig(empty)).toEqual({ ok: false, issues: [{ code: "no-formats" }] });

    const badNaming: ExportPresetConfig = { ...defaultPresetConfig(), naming: "{name}-{foo}" };
    expect(validatePresetConfig(badNaming)).toEqual({
      ok: false,
      issues: [{ code: "bad-naming", token: "foo" }],
    });
  });

  it("水印超长拒绝；合法配置通过", () => {
    const tooLong: ExportPresetConfig = { ...defaultPresetConfig(), watermark: "x".repeat(65) };
    expect(validatePresetConfig(tooLong)).toEqual({
      ok: false,
      issues: [{ code: "watermark-too-long" }],
    });
    expect(validatePresetConfig(defaultPresetConfig())).toEqual({ ok: true });
  });
});

describe("toBundleRequest / 默认预设", () => {
  it("配置 → 请求：水印 trim、revision/strict 可选透传", () => {
    const config: ExportPresetConfig = {
      formats: ["pdf", "md"],
      naming: "{name}",
      watermark: " 机密 ",
      redact: true,
      include_photo: false,
      archive_original: true,
    };
    expect(toBundleRequest(config, { revision: 7, strictRevision: true })).toEqual({
      formats: ["pdf", "md"],
      watermark: "机密",
      redact: true,
      include_photo: false,
      archive_original: true,
      resume_revision: 7,
      strict_revision: true,
    });
    expect(toBundleRequest(config)).not.toHaveProperty("resume_revision");
  });

  it("默认预设优先选 is_default，否则第一项，空列表 null", () => {
    expect(pickDefaultPreset([{ is_default: false }, { is_default: true }])).toEqual({
      is_default: true,
    });
    expect(pickDefaultPreset([{ is_default: false }])).toEqual({ is_default: false });
    expect(pickDefaultPreset([])).toBeNull();
  });

  it("配置等价比较忽略字段顺序/原始形状", () => {
    const base = defaultPresetConfig();
    expect(isSamePresetConfig(base, { ...base })).toBe(true);
    expect(isSamePresetConfig(base, { ...base, redact: true })).toBe(false);
  });
});
