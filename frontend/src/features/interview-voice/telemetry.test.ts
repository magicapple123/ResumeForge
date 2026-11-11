// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";

const diagnostics = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("../../utils/clientDiagnostics", () => ({ recordClientDiagnostic: diagnostics.record }));

import { VoiceTurnClock, recordVoiceTelemetry } from "./telemetry";

describe("interview-voice/telemetry：结构化观测", () => {
  it("事件走 clientDiagnostics，带 interview-voice. 前缀与数字字段", () => {
    recordVoiceTelemetry("interview-voice.endpoint", {
      silenceMs: 750,
      endpointMs: 780,
      decision: "complete",
    });
    expect(diagnostics.record).toHaveBeenCalledWith("interview-voice.endpoint", {
      silenceMs: 750,
      endpointMs: 780,
      decision: "complete",
    });
  });

  it("recordVoiceTelemetry 只收白名单字段（不接收对话内容）", () => {
    recordVoiceTelemetry("interview-voice.barge-in", { interrupted: true, rolledBackChars: 0 });
    const [, fields] = diagnostics.record.mock.calls[diagnostics.record.mock.calls.length - 1] as [
      string,
      Record<string, unknown>,
    ];
    expect(fields).toEqual({ interrupted: true, rolledBackChars: 0 });
  });
});

describe("interview-voice/telemetry：一轮的耗时打点", () => {
  it("elapsedMs 计算两个打点之间的耗时", () => {
    let now = 1_000;
    const clock = new VoiceTurnClock(() => now);
    clock.mark("speech-end");
    now += 750;
    clock.mark("endpoint");
    expect(clock.elapsedMs("speech-end", "endpoint")).toBe(750);
    expect(clock.elapsedMs("speech-end", "missing")).toBeUndefined();
  });

  it("mark 返回打点时刻；reset 清空", () => {
    const clock = new VoiceTurnClock(() => 42);
    expect(clock.mark("vad-start")).toBe(42);
    expect(clock.has("vad-start")).toBe(true);
    clock.reset();
    expect(clock.has("vad-start")).toBe(false);
  });

  it("同一名字重复打点以最后一次为准（重连/重试不累加）", () => {
    let now = 0;
    const clock = new VoiceTurnClock(() => now);
    clock.mark("speech-end");
    now = 500;
    clock.mark("speech-end");
    now = 900;
    clock.mark("endpoint");
    expect(clock.elapsedMs("speech-end", "endpoint")).toBe(400);
  });
});
