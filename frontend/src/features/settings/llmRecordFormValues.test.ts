// SPDX-License-Identifier: Apache-2.0
/**
 * 记录表单值 ↔ 完整 LLMConfig 的往返（T01 的核心回归）。
 *
 * 修的是什么：`context_window_tokens` 此前**不在表单链路上**——`RecordFormValues` 没有
 * 这个字段，`configFromRecord` 也没拷。于是 ① 新建时填的窗口保存即丢；② 编辑任何记录
 * 再保存，`LLMConfig` 整份替换语义会把缺失字段填回默认值 0（= 窗口被清零）。
 *
 * 这里钉的是**纯函数往返**，不需要渲染弹窗：表单值进 → 落库配置出。反证用例
 * （新建填 200000 那条）在没有 `mergedConfigFromForm` 的显式读取时必然变红——那是唯一
 * 一处能把表单值搬进配置的地方。
 */
import { describe, expect, it } from "vitest";
import type { LLMConfigRecord } from "../../types";
import { clampContextWindow, formatContextWindow } from "./llm/contextWindowPresets";
import { configFromRecord } from "./SettingsConfig";
import { type RecordFormValues, createDefaults, mergedConfigFromForm } from "./llmRecordFormValues";

/** 一条完整记录：只覆盖用例关心的字段，其余取与后端默认一致的值。 */
function record(overrides: Partial<LLMConfigRecord> = {}): LLMConfigRecord {
  return {
    id: "p_test",
    name: "测试记录",
    provider: "custom",
    base_url: "https://api.example.com/v1",
    api_key: "********:profile:p_test",
    model: "gpt-4.1",
    temperature: 0.1,
    timeout_seconds: 120,
    max_tokens: 0,
    context_window_tokens: 0,
    api_style: "openai",
    top_p: null,
    frequency_penalty: null,
    presence_penalty: null,
    seed: null,
    top_k: null,
    repetition_penalty: null,
    stop: [],
    thinking_budget: null,
    thinking_enabled: false,
    thinking_effort: "",
    thinking_style: "auto",
    extra_body: {},
    models: [],
    is_active: false,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

/**
 * 弹窗打开时表单里会有什么：`openRecordEdit` 的 `{...createDefaults(), ...configFromRecord()}`
 * 加"密钥留空"。用例走这条真实预填链路，而不是自己拼一份理想表单值——后者会漏掉
 * "预填时字段被丢掉"这类问题。
 */
function formValuesLikeOpenEdit(existing: LLMConfigRecord): RecordFormValues {
  return {
    ...createDefaults(),
    ...(configFromRecord(existing) as unknown as RecordFormValues),
    name: existing.name,
    api_key: "",
  };
}

describe("记录表单的上下文窗口往返（T01）", () => {
  it("新增表单**不预填**窗口：留空 = 跟随型号参考值", () => {
    expect(createDefaults().context_window_tokens).toBeNull();
  });

  it("① 新建填 200000 → 保存配置里就是 200000", () => {
    const values: RecordFormValues = {
      ...createDefaults(),
      base_url: "https://a.example/v1",
      model: "gpt-4.1",
      context_window_tokens: 200_000,
    };
    const config = mergedConfigFromForm(values, null);
    expect(config.context_window_tokens).toBe(200_000);
    // 反证点：把 `mergedConfigFromForm` 里那一行读取删掉，这里会变成 0。
  });

  it("② 编辑只改 temperature → 窗口不被清零", () => {
    const existing = record({ context_window_tokens: 200_000 });
    const values = { ...formValuesLikeOpenEdit(existing), temperature: 0.7 };
    const config = mergedConfigFromForm(values, existing);
    expect(config.temperature).toBe(0.7);
    expect(config.context_window_tokens).toBe(200_000);
  });

  it("编辑时把窗口从 0 改成 1M → 落库 1000000（表单值说了算）", () => {
    const existing = record({ context_window_tokens: 0 });
    const values = { ...formValuesLikeOpenEdit(existing), context_window_tokens: 1_000_000 };
    expect(mergedConfigFromForm(values, existing).context_window_tokens).toBe(1_000_000);
  });

  it("编辑时清空窗口 → 0（跟随参考值），不是「保留旧值」", () => {
    const existing = record({ context_window_tokens: 200_000 });
    const values = { ...formValuesLikeOpenEdit(existing), context_window_tokens: null };
    expect(mergedConfigFromForm(values, existing).context_window_tokens).toBe(0);
  });

  it("新建留空 → 0（后端语义：未知，按型号参考值解析）", () => {
    expect(mergedConfigFromForm(createDefaults(), null).context_window_tokens).toBe(0);
  });

  it("超上限的值夹到 2,000,000（后端 le 上限，超了会 422）", () => {
    const values = { ...createDefaults(), context_window_tokens: 3_000_000 };
    expect(mergedConfigFromForm(values, null).context_window_tokens).toBe(2_000_000);
    expect(clampContextWindow(3_000_000)).toBe(2_000_000);
    expect(clampContextWindow(-5)).toBe(0);
    expect(clampContextWindow(null)).toBe(0);
    expect(clampContextWindow(undefined)).toBe(0);
  });

  it("configFromRecord 原样带上窗口（缺失时按 0）", () => {
    expect(configFromRecord(record({ context_window_tokens: 64_000 })).context_window_tokens).toBe(
      64_000,
    );
    expect(
      configFromRecord(record({ context_window_tokens: undefined })).context_window_tokens,
    ).toBe(0);
  });

  it("显示格式：预设档位不写成七位数字，参考表里的精确值按 M/K 缩写", () => {
    expect(formatContextWindow(1_000_000)).toBe("1M");
    expect(formatContextWindow(200_000)).toBe("200K");
    expect(formatContextWindow(128_000)).toBe("128K");
    expect(formatContextWindow(1_047_576)).toBe("1.05M");
    expect(formatContextWindow(32_000)).toBe("32K");
  });
});
