// SPDX-License-Identifier: Apache-2.0
/**
 * 检查更新失败的归因（第 11 条）：九类映射 + 原文兜底。
 *
 * 每条用例都断言**原文仍在字符串里**——这是防"归因把证据吃掉"的唯一办法：
 * 一句「网络异常」看起来像原因，实际上把状态码和主机名一起盖掉了，用户反馈问题时
 * 什么也贴不出来。
 *
 * 文案本体不在这里断言：归因只负责选 key，中文/英文在 `i18n/messages/*.update.ts`。
 * 所以下面的 `translator` 是一个记录 key 的替身，同时也证明"这个函数不依赖 React"。
 */
import { describe, expect, it } from "vitest";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import {
  FAILURE_DETAIL_KEY,
  FAILURE_REASON_KEYS,
  attributeUpdateFailure,
  describeUpdateFailure,
} from "./updateErrorText";

/** 记录被选了哪个 key，并把 key 与参数原样拼进结果（便于断言"原文没被吞掉"）。 */
function recorder() {
  const keys: string[] = [];
  const translate = (key: MessageKey, params?: Record<string, string | number>) => {
    keys.push(key);
    return params?.detail ? `${key}[${params.detail}]` : key;
  };
  return { keys, translate };
}

describe("归因映射", () => {
  // 每条都是主进程真实会带出来的原文形态（见 desktop/lib/update-failure-text.js 与
  // desktop/updater.js）：403 的三类必须靠 x-ratelimit-remaining 分开。
  const cases: { name: string; detail: string; reason: keyof typeof FAILURE_REASON_KEYS }[] = [
    {
      name: "403 + 额度为 0 = 匿名额度用完",
      detail:
        "releases/latest returned 403 (x-ratelimit-remaining: 0, x-ratelimit-reset: 1795448821)",
      reason: "quota",
    },
    {
      name: "403 但额度还在 = 网络里有人拦了",
      detail: "releases/latest returned 403 (x-ratelimit-remaining: 57)",
      reason: "blocked",
    },
    { name: "429 = 请求过于频繁", detail: "releases/latest returned 429", reason: "rate" },
    {
      name: "404 = 仓库或 Release 不存在",
      detail: "releases/latest returned 404",
      reason: "notFound",
    },
    {
      name: "超时",
      detail: "TimeoutError: The operation was aborted due to timeout",
      reason: "timeout",
    },
    {
      name: "DNS",
      detail: "Error: getaddrinfo ENOTFOUND api.github.com",
      reason: "dns",
    },
    {
      name: "连接被拒绝 / 重置",
      detail: "Error: read ECONNRESET",
      reason: "refused",
    },
    {
      name: "证书",
      detail: "Error: unable to verify the first certificate (CERT_HAS_EXPIRED)",
      reason: "cert",
    },
    {
      name: "响应不是 JSON（拦截页）",
      detail: "SyntaxError: Unexpected token '<', \"<!DOCTYPE\"... is not valid JSON",
      reason: "json",
    },
    {
      name: "上游版本号不是标准 semver",
      detail: "Error: release version is not an exact stable semver",
      reason: "semver",
    },
  ];

  for (const item of cases) {
    it(`${item.name}：选 ${FAILURE_REASON_KEYS[item.reason]} 且原文留在字符串里`, () => {
      const { keys, translate } = recorder();
      const text = describeUpdateFailure(item.detail, translate);
      expect(keys[0]).toBe(FAILURE_REASON_KEYS[item.reason]);
      expect(keys[1]).toBe(FAILURE_DETAIL_KEY);
      expect(text).toContain(item.detail);
      expect(text).toContain(FAILURE_REASON_KEYS[item.reason]);
    });
  }

  it("两条路都失败的原文里，主路径的 403 优先（额度为 0 时按额度说）", () => {
    const detail =
      "releases/latest returned 403 (x-ratelimit-remaining: 0); fallback probe failed: " +
      "releases/latest redirect returned 403";
    expect(attributeUpdateFailure(detail).reason).toBe("quota");
    // 两条状态码都还在字符串里
    expect(describeUpdateFailure(detail, t)).toContain("returned 403");
  });

  it("归类不出来时原样显示原文，不编「网络异常」", () => {
    const { keys, translate } = recorder();
    const detail = "download stalled: no bytes for 45000 ms";
    expect(attributeUpdateFailure(detail).reason).toBeNull();
    expect(describeUpdateFailure(detail, translate)).toBe(detail);
    expect(keys).toEqual([]);
  });

  it("原文为空时返回空串（调用方据此不渲染空描述）", () => {
    expect(attributeUpdateFailure("").reason).toBeNull();
    expect(describeUpdateFailure("", t)).toBe("");
    expect(describeUpdateFailure("   ", t)).toBe("");
  });

  it("两个语言包里 10 条归因与括注 key 都齐（否则中文界面会退回 key 原文）", () => {
    for (const key of [...Object.values(FAILURE_REASON_KEYS), FAILURE_DETAIL_KEY]) {
      expect(t(key)).not.toBe(key);
    }
    // 括注必须带 `{detail}` 占位，否则原文进不去
    expect(t(FAILURE_DETAIL_KEY, { detail: "x" })).toContain("x");
  });
});
