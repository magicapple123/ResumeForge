// SPDX-License-Identifier: Apache-2.0
/**
 * T23 的纯函数守卫：失败反馈必须「点名 Key + 点名字段」。
 *
 * 这里不渲染组件，只钉住三件事：
 * 1. FastAPI 422 的 `detail[].loc` 被翻成界面字段名（不是把 `searxng_url` 这种协议值
 *    直接甩给用户）；
 * 2. 拿不到结构化字段时仍然带名称，而不是一句没有主语的「请求失败」；
 * 3. 未登记的字段回落协议值本身（不翻译、不吞信息）。
 */

import { describe, expect, it } from "vitest";
import { ApiError } from "../../api/client";
import { t } from "../../i18n";
import { failedFields, fieldLabel, namedFailure } from "./settingsFailure";

function validationError(detail: unknown): ApiError {
  return new ApiError(t("searchCard.saveFailed"), 422, { payload: { detail } });
}

describe("settingsFailure（T23）", () => {
  it("turns FastAPI loc into a field name and keeps the reason", () => {
    const err = validationError([{ loc: ["body", "searxng_url"], msg: "must start with http://" }]);

    expect(failedFields(err)).toEqual(["searxng_url"]);
    expect(fieldLabel("searxng_url")).toBe(t("settingsErrors.field.searxngUrl"));
    expect(namedFailure(t("searchCard.title"), err, "fallback")).toBe(
      t("settingsErrors.fieldFailure", {
        name: t("searchCard.title"),
        fields: t("settingsErrors.field.searxngUrl"),
        reason: t("searchCard.saveFailed"),
      }),
    );
  });

  it("joins multiple fields with the localized separator", () => {
    const err = validationError([
      { loc: ["body", "api_key"], msg: "invalid" },
      { loc: ["body", "base_url"], msg: "invalid" },
      { loc: ["body", "api_key"], msg: "duplicate" },
    ]);

    expect(failedFields(err)).toEqual(["api_key", "base_url"]);
    expect(namedFailure("DeepSeek", err, "fallback")).toBe(
      t("settingsErrors.fieldFailure", {
        name: "DeepSeek",
        fields: [t("settingsErrors.field.apiKey"), t("settingsErrors.field.baseUrl")].join(
          t("settingsErrors.fieldSeparator"),
        ),
        reason: t("searchCard.saveFailed"),
      }),
    );
  });

  it("falls back to the bare protocol value for unknown fields", () => {
    const err = validationError([{ loc: ["body", "future_field"], msg: "bad" }]);

    expect(namedFailure("X", err, "fallback")).toContain("future_field");
    // 搜索 Key 的字段名带来源前缀；不映射就会把 `deepseek_api_key` 这种协议值甩给用户。
    expect(fieldLabel("deepseek_api_key")).toBe(t("settingsErrors.field.deepseekApiKey"));
  });

  it("still names the target when there is no structured field", () => {
    expect(namedFailure("代理认证口令", new Error("boom"), "fallback")).toBe(
      t("settingsErrors.namedFailure", { name: "代理认证口令", reason: "boom" }),
    );
    // 非 Error 的异常用调用方的兜底句子，不能渲染成空字符串。
    expect(namedFailure("代理认证口令", "nope", "fallback")).toBe(
      t("settingsErrors.namedFailure", { name: "代理认证口令", reason: "fallback" }),
    );
  });
});
