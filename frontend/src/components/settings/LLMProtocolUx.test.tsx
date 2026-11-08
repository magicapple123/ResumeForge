// SPDX-License-Identifier: Apache-2.0
/**
 * T09.1：厂商预设增补与「各服务商协议支持」矩阵的守卫。
 *
 * 两件事：① 预设数据与任务书 §4 T09.1 的修正/新增口径一致（模型名、域名、
 * supports_responses 声明）；② 矩阵是 22+1 行静态表，带核对日期与表尾说明。
 */
import { App as AntdApp, ConfigProvider } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LLM_PRESETS, presetAnthropicBaseUrl, presetResponsesBaseUrl } from "../../config";
import { t } from "../../i18n";
import LLMProtocolSupportMatrix from "./LLMProtocolSupportMatrix";
import { matchingPreset } from "./SettingsConfig";

afterEach(() => {
  cleanup();
});

const presetOf = (provider: string) => {
  const preset = LLM_PRESETS.find((item) => item.provider === provider);
  if (!preset) throw new Error("missing preset: " + provider);
  return preset;
};

describe("T09.1 厂商预设增补", () => {
  it("has 22 presets covering the 16 existing plus the 6 new vendors", () => {
    expect(LLM_PRESETS).toHaveLength(22);
    for (const provider of ["hunyuan", "qianfan", "spark", "stepfun", "together", "perplexity"]) {
      expect(LLM_PRESETS.some((preset) => preset.provider === provider)).toBe(true);
    }
  });

  it("never makes Responses the default protocol (D13/D14)", () => {
    for (const preset of LLM_PRESETS) {
      // 协议字段只允许 openai / anthropic：写 responses 等于新配置默认 Responses。
      expect(["openai", "anthropic"]).toContain(preset.api_style ?? "openai");
    }
  });

  it("fixes the six stale presets from the plan", () => {
    // MiniMax：新域名 + 新旗舰模型（旧 .chat 域名不再作为默认）。
    expect(presetOf("minimax").base_url).toBe("https://api.minimaxi.com/v1");
    expect(presetOf("minimax").model).toBe("MiniMax-M3.1-Flash");
    // Gemini / xAI：模型代际更新。
    expect(presetOf("gemini").model).toBe("gemini-3.8-flash");
    expect(presetOf("xai").model).toBe("grok-4.7");
    // 豆包：官方文档写法是连字符 + 日期（点号只是别名），已按文档改正。
    expect(presetOf("doubao").model).toBe("doubao-seed-2-1-pro-260915");
    // 星火：整体迁到新 MaaS 平台（旧的 spark-api-open 是上一代）。
    expect(presetOf("spark").base_url).toBe("https://maas-api.cn-huabei-1.xf-yun.com/v2");
    expect(presetOf("spark").model).toBe("spark-x2.6");
  });

  it("declares Responses support without rewriting default protocol", () => {
    // 明确不支持的三家：不声明 supports_responses。
    for (const provider of ["anthropic", "gemini", "siliconflow"]) {
      expect(presetOf(provider).supports_responses).toBeUndefined();
      expect(presetResponsesBaseUrl(presetOf(provider))).toBeNull();
    }
    // MiniMax / 千帆 / 星火 / 阶跃：官方已支持 POST /v1/responses（2026-11-08 核对）。
    for (const provider of ["minimax", "qianfan", "spark", "stepfun", "together"]) {
      expect(presetOf(provider).supports_responses).toBe(true);
    }
    // 追加 /responses 的服务商。
    expect(presetResponsesBaseUrl(presetOf("deepseek"))).toBe("https://api.deepseek.com/responses");
    expect(presetResponsesBaseUrl(presetOf("hunyuan"))).toBe(
      "https://tokenhub.tencentmaas.com/v1/responses",
    );
    // 智谱的地址与 chat 不同：换成 /api/v1（不是 paas/v4 后追加）。
    expect(presetOf("zhipu").responses_base_url).toBe("https://open.bigmodel.cn/api/v1");
    expect(presetResponsesBaseUrl(presetOf("zhipu"))).toBe("https://open.bigmodel.cn/api/v1");
  });

  it("declares where each Anthropic entry lives", () => {
    // 入口与 chat 不同址：必须显式给地址（provider 拼 {base_url}/messages）。
    expect(presetOf("deepseek").supports_anthropic).toBe(true);
    expect(presetAnthropicBaseUrl(presetOf("deepseek"))).toBe(
      "https://api.deepseek.com/anthropic/v1",
    );
    expect(presetAnthropicBaseUrl(presetOf("zhipu"))).toBe(
      "https://open.bigmodel.cn/api/anthropic/v1",
    );
    expect(presetAnthropicBaseUrl(presetOf("qianfan"))).toBe(
      "https://qianfan.baidubce.com/anthropic/v1",
    );
    // 同址的厂商不填专用地址：在 chat 地址后追加 /messages。
    expect(presetAnthropicBaseUrl(presetOf("siliconflow"))).toBe(
      "https://api.siliconflow.cn/v1/messages",
    );
    expect(presetAnthropicBaseUrl(presetOf("hunyuan"))).toBe(
      "https://tokenhub.tencentmaas.com/v1/messages",
    );
    // 没有 Anthropic 入口的一律返回 null（切协议时地址一个字都不动）。
    for (const provider of ["openai", "gemini", "xai", "groq", "mistral", "perplexity"]) {
      expect(presetOf(provider).supports_anthropic).toBeUndefined();
      expect(presetAnthropicBaseUrl(presetOf(provider))).toBeNull();
    }
    // chat 地址本身不受影响（Anthropic 地址是另一条，不覆盖默认值）。
    expect(presetOf("deepseek").base_url).toBe("https://api.deepseek.com");
  });

  it("matches a preset even when the record already uses a protocol-specific address", () => {
    // 切过协议的记录再打开时，机构名不能回落成「自定义」——否则没有改写目标，
    // 用户切不回 chat 地址（见 SettingsConfig.matchingPreset）。
    expect(
      matchingPreset({ provider: "deepseek", base_url: "https://api.deepseek.com/anthropic/v1" })
        ?.provider,
    ).toBe("deepseek");
    expect(
      matchingPreset({ provider: "zhipu", base_url: "https://open.bigmodel.cn/api/v1" })?.provider,
    ).toBe("zhipu");
    // provider 相同但三条地址都不等：仍然不命中（不放宽成"只看 provider"）。
    expect(
      matchingPreset({ provider: "deepseek", base_url: "https://api.deepseek.com/custom-route" }),
    ).toBeUndefined();
  });
});

describe("T09.1 各服务商协议支持矩阵", () => {
  function renderMatrix() {
    render(
      <AntdApp>
        <ConfigProvider>
          <LLMProtocolSupportMatrix />
        </ConfigProvider>
      </AntdApp>,
    );
  }

  it("expands into a 23-row static table with a verification date", () => {
    renderMatrix();

    fireEvent.click(screen.getByText(t("llmProtocol.matrix.toggle")));

    const rows = document.querySelectorAll("tbody tr.ant-table-row");
    expect(rows).toHaveLength(23);
    // 新增的 6 家 + Azure 单列都在表里（文案从语言包取，避免测试里新增中文字面量）。
    for (const key of [
      "llmProtocol.preset.hunyuan",
      "llmProtocol.preset.qianfan",
      "llmProtocol.preset.spark",
      "llmProtocol.preset.stepfun",
      "llmProtocol.preset.together",
      "llmProtocol.preset.perplexity",
      "llmProtocol.matrix.azure",
    ] as const) {
      expect(screen.getByText(t(key))).toBeInTheDocument();
    }
    // 表尾与列里都有核对日期。
    expect(screen.getAllByText(/2026-11-08/).length).toBeGreaterThan(0);
    expect(screen.getByText(t("llmProtocol.matrix.footnote"))).toBeInTheDocument();
  });
});
