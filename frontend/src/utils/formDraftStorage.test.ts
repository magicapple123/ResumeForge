// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it } from "vitest";
import {
  DRAFT_MAX_BYTES,
  DRAFT_TTL_MS,
  clearDraft,
  draftStorageKey,
  readDraft,
  stripSensitive,
  writeDraft,
} from "./formDraftStorage";

const SCOPE = "claims.edit#12";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("key 规范", () => {
  it("带数据集作用域，缺省是 main", () => {
    expect(draftStorageKey(SCOPE)).toBe(`resumeforge.form-draft.v1:${SCOPE}@main`);
  });

  it("换数据集后 key 跟着变（A 数据集的草稿不会恢复到 B）", () => {
    window.localStorage.setItem("resumeforge:active-dataset", "work");
    expect(draftStorageKey(SCOPE)).toBe(`resumeforge.form-draft.v1:${SCOPE}@work`);
  });
});

describe("读写", () => {
  it("写进去能读出来，并带上 savedAt", () => {
    expect(writeDraft(SCOPE, { title: "x" }, 1000)).toBe("ok");
    expect(readDraft(SCOPE, 1000)).toEqual({ values: { title: "x" }, savedAt: 1000 });
  });

  it("超过 TTL 的草稿不恢复，并就地清掉", () => {
    writeDraft(SCOPE, { title: "x" }, 1000);
    expect(readDraft(SCOPE, 1000 + DRAFT_TTL_MS + 1)).toBeNull();
    expect(window.sessionStorage.getItem(draftStorageKey(SCOPE))).toBeNull();
  });

  it("clearDraft 删键", () => {
    writeDraft(SCOPE, { title: "x" });
    clearDraft(SCOPE);
    expect(readDraft(SCOPE)).toBeNull();
  });

  it("坏 JSON 当作没有草稿", () => {
    window.sessionStorage.setItem(draftStorageKey(SCOPE), "{oops");
    expect(readDraft(SCOPE)).toBeNull();
  });
});

describe("体积上限", () => {
  it("超过 32KB 返回 too-large 且不写", () => {
    const huge = { body: "x".repeat(DRAFT_MAX_BYTES) };
    expect(writeDraft(SCOPE, huge)).toBe("too-large");
    expect(readDraft(SCOPE)).toBeNull();
  });

  it("多字节字符按真实字节算（中文占 3 字节）", () => {
    // 12000 个汉字 = 36000 字节，远超上限；若按字符数算就漏过去了。
    expect(writeDraft(SCOPE, { body: "字".repeat(12000) })).toBe("too-large");
  });
});

describe("凭据剔除", () => {
  it("字段名命中凭据模式即整键丢弃", () => {
    const values = {
      title: "ok",
      apiKey: "sk-1",
      api_key: "sk-2",
      accessToken: "t",
      user_password: "p",
      secret: "s",
      credential: "c",
    };
    expect(stripSensitive(values)).toEqual({ title: "ok" });
  });

  it("omit 指定的字段一并丢弃", () => {
    expect(stripSensitive({ a: 1, avatar: "data:image" }, ["avatar"])).toEqual({ a: 1 });
  });

  it("写入侧再剔一次：调用方漏了 stripSensitive 也写不进凭据", () => {
    writeDraft(SCOPE, { apiKey: "sk-1", title: "ok" });
    expect(readDraft(SCOPE)?.values).toEqual({ title: "ok" });
  });
});
