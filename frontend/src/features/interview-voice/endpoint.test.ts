// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  EXTENDED_GRACE_MS,
  EXTENDED_SILENCE_MS,
  SILENCE_CONTINUE_MS,
  SILENCE_SEND_MS,
  THINKING_SILENCE_MS,
  classifyTranscript,
  decideEndpoint,
  endsWithFiller,
  shouldUploadSegment,
} from "./endpoint";

const LAST_SPEECH = 1_000;

function decide(input: Partial<Parameters<typeof decideEndpoint>[0]>) {
  return decideEndpoint({
    text: "",
    silenceMs: SILENCE_SEND_MS,
    atMs: LAST_SPEECH + SILENCE_SEND_MS,
    lastSpeechAt: LAST_SPEECH,
    ...input,
  });
}

describe("interview-voice/endpoint：语义分类", () => {
  it.each(["好，开始吧。", "我讲完了", "以上。", "因为做了缓存，QPS 提升了 3 倍"])(
    "%s 判为完整",
    (text) => expect(classifyTranscript(text)).toBe("complete"),
  );

  it.each(["我觉得应该先做，", "我们用了 Redis 然后", "首先是", "因为"])(
    "%s 判为没说完/语气词结尾",
    (text) => expect(classifyTranscript(text)).toBe("incomplete"),
  );

  it.each(["让我想一下", "稍等，我组织下语言", "我想想"])("%s 进入思考模式", (text) =>
    expect(classifyTranscript(text)).toBe("thinking"),
  );

  it("空文本不算完整", () => {
    expect(classifyTranscript("   ")).toBe("incomplete");
  });

  it("语气词 / 连接词 / 逗号结尾都算没说完", () => {
    expect(endsWithFiller("然后")).toBe(true);
    expect(endsWithFiller("比如，")).toBe(true);
    expect(endsWithFiller("就是")).toBe(true);
    expect(endsWithFiller("做完了。")).toBe(false);
  });
});

describe("interview-voice/endpoint：需求表逐行", () => {
  it("静音 < 700ms：继续听，不发（即使文字完整）", () => {
    const decision = decide({
      text: "好，开始吧。",
      silenceMs: SILENCE_CONTINUE_MS - 1,
      atMs: LAST_SPEECH + SILENCE_CONTINUE_MS - 1,
    });
    expect(decision).toMatchObject({ kind: "wait" });
    expect(decision.kind === "wait" && decision.deadlineAt).toBe(LAST_SPEECH + SILENCE_CONTINUE_MS);
  });

  it("静音 700–800ms 且语义完整：立即发", () => {
    expect(decide({ text: "好，开始吧。", silenceMs: 750 })).toEqual({
      kind: "send",
      cause: "complete",
    });
  });

  it("静音 700–800ms 且结尾是语气词：延长到 1.2–1.5s 档", () => {
    const decision = decide({ text: "我们用了 Redis 然后", silenceMs: 750 });
    expect(decision.kind).toBe("wait");
    if (decision.kind !== "wait") return;
    expect(decision.cause).toBe("filler");
    expect(decision.deadlineAt).toBe(LAST_SPEECH + EXTENDED_SILENCE_MS);
  });

  it("ASR 慢导致延长窗口已过：至少再等 EXTENDED_GRACE_MS 才发", () => {
    const now = LAST_SPEECH + EXTENDED_SILENCE_MS + 50;
    const decision = decide({
      text: "我们用了 Redis 然后",
      silenceMs: now - LAST_SPEECH,
      atMs: now,
    });
    expect(decision.kind).toBe("wait");
    if (decision.kind !== "wait") return;
    expect(decision.deadlineAt).toBe(now + EXTENDED_GRACE_MS);
  });

  it("语义完整且已过 800ms：立即发", () => {
    expect(decide({ text: "做完了。", silenceMs: 900 }).kind).toBe("send");
  });

  it("按住说话松开：立即发，跳过所有计时", () => {
    expect(decide({ text: "嗯", silenceMs: 10, atMs: LAST_SPEECH + 10, released: true })).toEqual({
      kind: "send",
      cause: "release",
    });
  });

  it("「让我想一下」：进入 extended wait，最多 5s 静音", () => {
    const decision = decide({ text: "让我想一下", silenceMs: 900 });
    expect(decision).toEqual({
      kind: "thinking",
      deadlineAt: LAST_SPEECH + THINKING_SILENCE_MS,
    });
  });

  it("思考模式静音已满 5s：发（thinking-timeout）", () => {
    const now = LAST_SPEECH + THINKING_SILENCE_MS + 10;
    const decision = decide({
      text: "让我想一下",
      silenceMs: now - LAST_SPEECH,
      atMs: now,
    });
    expect(decision).toEqual({ kind: "send", cause: "thinking-timeout" });
  });

  it("空转写不发（等错误兜底），期限不早于延长档", () => {
    const decision = decide({ text: "  ", silenceMs: 900 });
    expect(decision.kind).toBe("wait");
    if (decision.kind !== "wait") return;
    expect(decision.deadlineAt).toBeGreaterThanOrEqual(LAST_SPEECH + EXTENDED_SILENCE_MS);
  });
});

describe("interview-voice/endpoint：分段的触发时机", () => {
  it("常开模式：静音到 700ms 才上传", () => {
    const base = { mode: "always-on" as const, hasAudio: true, uploadRequested: false };
    expect(shouldUploadSegment({ ...base, silenceMs: 699 })).toBe(false);
    expect(shouldUploadSegment({ ...base, silenceMs: 700 })).toBe(true);
  });

  it("按住说话：静音再久也不上传，松开才上传", () => {
    const base = {
      mode: "push-to-talk" as const,
      hasAudio: true,
      uploadRequested: false,
      silenceMs: 5_000,
    };
    expect(shouldUploadSegment(base)).toBe(false);
    expect(shouldUploadSegment({ ...base, released: true })).toBe(true);
  });

  it("没有音频或已经请求过上传：不重复上传", () => {
    const base = {
      mode: "always-on" as const,
      hasAudio: false,
      uploadRequested: false,
      silenceMs: 900,
    };
    expect(shouldUploadSegment(base)).toBe(false);
    expect(shouldUploadSegment({ ...base, hasAudio: true, uploadRequested: true })).toBe(false);
  });
});
