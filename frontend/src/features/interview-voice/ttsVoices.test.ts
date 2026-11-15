// SPDX-License-Identifier: Apache-2.0
/**
 * 合成服务档位的纯逻辑（T10）：两档音色、旧值回落、离线回退表。
 *
 * 重点在**"已存音色不得失效"**这条产品承诺：
 * - 选回百炼档时 4 个旧音色照旧可用；
 * - 落到 DeepSeek 档时回落到 stella，并且**明确标记发生了回落**（界面据此提示）；
 * - 空值不算回落（用户还没选过，不该被通知"你的音色被改了"）。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TTS_PROVIDER,
  fallbackNotice,
  normalizeTtsProvider,
  providerAvailable,
  providerVoicesOf,
  resolveTtsVoice,
  type TtsStatusPayload,
} from "./ttsVoices";

const SERVER_STATUS: TtsStatusPayload = {
  available: true,
  default_voice: "Cherry",
  voices: [],
  default_provider: "dashscope",
  providers: [
    {
      id: "dashscope",
      model: "qwen3-tts-flash",
      default_voice: "Cherry",
      available: true,
      voices: [
        { id: "Cherry", label: "Cherry · 芊悦（女声，亲和）" },
        { id: "Serena", label: "Serena · 苏瑶（女声，沉稳）" },
        { id: "Ethan", label: "Ethan · 晨煦（男声，明亮）" },
        { id: "Chelsie", label: "Chelsie · 千雪（女声，轻柔）" },
      ],
    },
    {
      id: "deepseek",
      model: "deepseek-tts",
      default_voice: "stella",
      available: false,
      voices: [
        { id: "stella", label: "Stella · 丝黛拉（女声）" },
        { id: "tide", label: "Tide · 潮汐（男声）" },
      ],
    },
  ],
};

describe("providerVoicesOf", () => {
  it("优先用后端下发的清单（服务端是音色的唯一真相）", () => {
    const deepseek = providerVoicesOf(SERVER_STATUS, "deepseek");
    expect(deepseek.defaultVoice).toBe("stella");
    expect(deepseek.voices.map((voice) => voice.id)).toEqual(["stella", "tide"]);
  });

  it("拿不到 status 时退回内建表，下拉不会变成空的", () => {
    const dashscope = providerVoicesOf(null, "dashscope");
    expect(dashscope.voices.map((voice) => voice.id)).toEqual([
      "Cherry",
      "Serena",
      "Ethan",
      "Chelsie",
    ]);
    const deepseek = providerVoicesOf(undefined, "deepseek");
    expect(deepseek.voices.map((voice) => voice.id)).toEqual(["stella", "tide"]);
  });
});

describe("resolveTtsVoice", () => {
  it("档内旧音色原样保留（旧值不失效）", () => {
    expect(resolveTtsVoice(SERVER_STATUS, "dashscope", "Chelsie")).toEqual({
      voice: "Chelsie",
      fellBack: false,
      previous: "",
    });
    expect(resolveTtsVoice(SERVER_STATUS, "deepseek", "tide")).toEqual({
      voice: "tide",
      fellBack: false,
      previous: "",
    });
  });

  it("音色属于另一档时回落到该档默认音色，并标记回落", () => {
    expect(resolveTtsVoice(SERVER_STATUS, "deepseek", "Cherry")).toEqual({
      voice: "stella",
      fellBack: true,
      previous: "Cherry",
    });
    expect(resolveTtsVoice(SERVER_STATUS, "dashscope", "stella")).toEqual({
      voice: "Cherry",
      fellBack: true,
      previous: "stella",
    });
  });

  it("空值用默认音色但不算回落（用户还没选过）", () => {
    expect(resolveTtsVoice(SERVER_STATUS, "deepseek", "")).toEqual({
      voice: "stella",
      fellBack: false,
      previous: "",
    });
  });

  it("完全未知的音色（例如厂商下线了）同样回落并标记", () => {
    const resolved = resolveTtsVoice(SERVER_STATUS, "dashscope", "Retired-Voice");
    expect(resolved.voice).toBe("Cherry");
    expect(resolved.fellBack).toBe(true);
  });
});

describe("fallbackNotice", () => {
  it("回落时给一句带前后音色的说明；没回落时是空串", () => {
    const notice = fallbackNotice(resolveTtsVoice(SERVER_STATUS, "deepseek", "Cherry"));
    expect(notice).toContain("Cherry");
    expect(notice).toContain("stella");
    expect(fallbackNotice(resolveTtsVoice(SERVER_STATUS, "deepseek", "tide"))).toBe("");
  });
});

describe("provider helpers", () => {
  it("默认档仍是百炼（新档并列，不替换）", () => {
    expect(DEFAULT_TTS_PROVIDER).toBe("dashscope");
  });

  it("未知档位回落默认档", () => {
    expect(normalizeTtsProvider("openai-tts")).toBe("dashscope");
    expect(normalizeTtsProvider(undefined)).toBe("dashscope");
    expect(normalizeTtsProvider("deepseek")).toBe("deepseek");
  });

  it("逐档判断可用性（百炼有 Key 不等于 DeepSeek 有 Key）", () => {
    expect(providerAvailable(SERVER_STATUS, "dashscope")).toBe(true);
    expect(providerAvailable(SERVER_STATUS, "deepseek")).toBe(false);
    // 没有 status 时按"可用"处理：拿不到信息不该把入口锁死。
    expect(providerAvailable(null, "deepseek")).toBe(true);
  });
});
