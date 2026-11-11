// SPDX-License-Identifier: Apache-2.0
/**
 * 26A/26B/26C/26G 的编排契约：用假时钟 + 假转写把"常开 / 按住说话 / 断句 / 插话"跑完。
 * 不依赖真麦克风，也不需要 React。
 */
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_VAD_CONFIG } from "./vad";
import { InterviewVoiceSession, type VoiceSessionDeps } from "./voiceSession";
import type { InterviewVoiceOutput } from "./voiceOutput";
import type { VoiceTelemetryFields } from "./telemetry";

const SPEECH_FRAME = 320;

function sineFrame(): Float32Array {
  const frame = new Float32Array(SPEECH_FRAME);
  for (let index = 0; index < SPEECH_FRAME; index += 1) {
    frame[index] = 0.3 * Math.sin((2 * Math.PI * 440 * index) / 16_000);
  }
  return frame;
}

const SILENCE_FRAME = new Float32Array(SPEECH_FRAME);

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface Harness {
  session: InterviewVoiceSession;
  now: { value: number };
  transcripts: string[];
  bargeIns: number;
  telemetry: Array<{ event: string; fields?: VoiceTelemetryFields }>;
  transcribe: ReturnType<typeof vi.fn>;
  output: { calls: string[]; impl: InterviewVoiceOutput };
  feed(ms: number, speech: boolean): Promise<void>;
  snapshot(): ReturnType<InterviewVoiceSession["snapshot"]>;
}

function harness(texts: string[] = [], overrides: Partial<VoiceSessionDeps> = {}): Harness {
  const now = { value: 0 };
  const transcripts: string[] = [];
  const telemetry: Array<{ event: string; fields?: VoiceTelemetryFields }> = [];
  const calls: string[] = [];
  const output: InterviewVoiceOutput = {
    enqueue: (text) => calls.push(`enqueue:${text}`),
    duck: (depth) => calls.push(`duck:${depth}`),
    flush: () => calls.push("flush"),
    stop: () => calls.push("stop"),
  };
  const pending = [...texts];
  const transcribe = vi.fn(async () => pending.shift() ?? "");
  const bargeInSpy = { count: 0 };
  const session = new InterviewVoiceSession({
    now: () => now.value,
    transcribe,
    output,
    telemetry: (event, fields) => telemetry.push({ event, fields }),
    onTranscript: (text) => transcripts.push(text),
    onBargeIn: () => {
      bargeInSpy.count += 1;
    },
    vadConfig: { ...DEFAULT_VAD_CONFIG, minSpeechMs: 60, hangoverMs: 200 },
    ...overrides,
  });
  const feed = async (ms: number, speech: boolean) => {
    const frame = speech ? sineFrame() : SILENCE_FRAME;
    for (let elapsed = 0; elapsed < ms; elapsed += 20) {
      now.value += 20;
      session.handleFrame(frame, now.value);
      await flushPromises();
    }
  };
  return {
    session,
    now,
    transcripts,
    get bargeIns() {
      return bargeInSpy.count;
    },
    telemetry,
    transcribe,
    output: { calls, impl: output },
    feed,
    snapshot: () => session.snapshot(),
  };
}

describe("interview-voice/session：常开模式断句（26B）", () => {
  it("静音 < 700ms 不上传；到 700ms 才上传", async () => {
    const test = harness([]);
    await test.feed(200, true); // 开口 + 说话
    await test.feed(400, false); // 静音 400ms
    expect(test.transcribe).not.toHaveBeenCalled();
    await test.feed(320, false); // 累计静音 720ms
    expect(test.transcribe).toHaveBeenCalledTimes(1);
  });

  it("语义完整：转写回来立即发", async () => {
    const test = harness(["好，开始吧。"]);
    await test.feed(200, true);
    await test.feed(720, false);
    expect(test.transcripts).toEqual(["好，开始吧。"]);
    const endpoint = test.telemetry.find((item) => item.event === "interview-voice.endpoint");
    expect(endpoint?.fields?.decision).toBe("complete");
  });

  it("结尾是语气词：延长到 1.4s 才发（不是 700ms 就发）", async () => {
    const test = harness(["我们用了 Redis 然后"]);
    await test.feed(200, true);
    await test.feed(720, false);
    expect(test.transcripts).toEqual([]);
    await test.feed(680, false); // 累计静音 1.4s
    expect(test.transcripts).toEqual(["我们用了 Redis 然后"]);
    expect(test.snapshot().phase).toBe("idle");
  });

  it("「让我想一下」：进入思考模式，最多 5s 静音才发", async () => {
    const test = harness(["让我想一下"]);
    await test.feed(200, true);
    await test.feed(720, false);
    expect(test.snapshot().thinking).toBe(true);
    expect(test.transcripts).toEqual([]);
    await test.feed(4_000, false); // 累计约 4.7s
    expect(test.transcripts).toEqual([]);
    await test.feed(400, false); // 越过 5s
    expect(test.transcripts).toEqual(["让我想一下"]);
    expect(test.snapshot().thinking).toBe(false);
  });

  it("ASR 期间用户又开口：同一轮继续收集，两段拼接后一起发", async () => {
    const test = harness(["我想说，", "三点"]);
    await test.feed(200, true);
    await test.feed(720, false); // 上传第一段，转写「我想说」→ 没说完，进入 extended
    expect(test.transcripts).toEqual([]);
    await test.feed(200, true); // 用户接着说（同一轮）
    await test.feed(720, false); // 上传第二段
    await test.feed(800, false); // 等第二段判定/延长窗口
    expect(test.transcripts).toEqual(["我想说， 三点"]);
  });

  it("没识别出内容的小段被丢弃，不打断整轮", async () => {
    const test = harness([""]);
    await test.feed(200, true);
    await test.feed(720, false);
    expect(test.transcripts).toEqual([]);
    expect(test.snapshot().phase).toBe("idle");
  });
});

describe("interview-voice/session：按住说话（26G）", () => {
  it("按住期间静音再久也不上传，松开立即上传并发送", async () => {
    const test = harness(["嗯，我说完了。"]);
    test.session.setMode("push-to-talk");
    await test.feed(200, true);
    await test.feed(1_500, false);
    expect(test.transcribe).not.toHaveBeenCalled();
    test.session.releasePushToTalk();
    await flushPromises();
    expect(test.transcribe).toHaveBeenCalledTimes(1);
    expect(test.transcripts).toEqual(["嗯，我说完了。"]);
  });
});

describe("interview-voice/session：插话（26C）", () => {
  it("语音 >= 300ms：duck 到 -24dB（不是停）", async () => {
    const test = harness([]);
    test.session.setAssistantActive(true);
    await test.feed(320, true);
    expect(test.output.calls).toContain("duck:-24");
    expect(test.bargeIns).toBe(0);
    expect(test.snapshot().ducked).toBe(true);
  });

  it("duck 后持续 200ms 仍在说：硬停（onBargeIn + flush + cancel）", async () => {
    const cancelTurn = vi.fn().mockResolvedValue({ rolled_back_chars: 12 });
    const test = harness([], { cancelTurn });
    test.session.setAssistantActive(true);
    await test.feed(300, true); // 触发 duck
    await test.feed(220, true); // 越过确认窗口
    expect(test.bargeIns).toBe(1);
    expect(test.output.calls).toContain("flush");
    expect(cancelTurn).toHaveBeenCalledTimes(1);
    const barge = test.telemetry.filter((item) => item.event === "interview-voice.barge-in");
    expect(barge.some((item) => item.fields?.interrupted === true)).toBe(true);
    await flushPromises();
    const rollback = test.telemetry.find((item) => item.event === "interview-voice.rollback");
    expect(rollback?.fields?.rolledBackChars).toBe(12);
  });

  it("200ms 内停了（短反馈词）：恢复音量，不打断", async () => {
    const test = harness([]);
    test.session.setAssistantActive(true);
    await test.feed(320, true); // duck（语音满 300ms）
    await test.feed(100, false); // 立刻停下
    expect(test.output.calls).toContain("duck:0");
    expect(test.bargeIns).toBe(0);
    expect(test.snapshot().ducked).toBe(false);
  });

  it("面试官说完（assistantActive=false）：插话状态复位", async () => {
    const test = harness([]);
    test.session.setAssistantActive(true);
    await test.feed(300, true);
    test.session.setAssistantActive(false);
    expect(test.snapshot().ducked).toBe(false);
    expect(test.snapshot().phase).toBe("idle");
  });
});

describe("interview-voice/session：关闭与清理", () => {
  it("stop 丢弃未决内容，不调用 onTranscript", async () => {
    const test = harness(["好，开始吧。"]);
    await test.feed(200, true);
    test.session.stop();
    await test.feed(720, false);
    expect(test.transcripts).toEqual([]);
    expect(test.snapshot().phase).toBe("idle");
  });

  it("转写失败：报错误码并复位（不会卡在 waiting-asr）", async () => {
    const onError = vi.fn();
    const test = harness([], { onError, transcribe: vi.fn().mockRejectedValue(new Error("x")) });
    await test.feed(200, true);
    await test.feed(720, false);
    expect(onError).toHaveBeenCalledWith("transcribe-failed");
    expect(test.snapshot().phase).toBe("idle");
  });
});
