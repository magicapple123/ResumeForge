// SPDX-License-Identifier: Apache-2.0
/**
 * 26A/26G 的 React 接线：麦克风生命周期 + 语音会话状态，全部逻辑在
 * ``capture.ts`` 与 ``voiceSession.ts`` 里，这个 hook 只做三件事：
 *
 * 1. 用户点「开启实时语音」才申请麦克风（常开 ≠ 自动要权限），关闭时立即释放轨道；
 * 2. 把采集到的 20ms 帧喂给会话，把会话快照映射成 React state（给指示器/波形用）；
 * 3. 把错误收敛成可本地化的错误码，组件负责出文案（hook 里不调 ``t()``）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MicCapture, isMicCaptureSupported, micErrorCode } from "./capture";
import {
  InterviewVoiceSession,
  type VoiceSessionSnapshot,
  type VoiceSessionErrorCode,
} from "./voiceSession";
import type { EndpointMode, EndpointTiming } from "./endpoint";
import type { InterviewVoiceOutput } from "./voiceOutput";
import { cancelInterviewVoiceTurn, transcribeSegment } from "./transcribe";

export type VoiceErrorCode = ReturnType<typeof micErrorCode> | VoiceSessionErrorCode;

export interface UseInterviewVoiceOptions {
  mode: EndpointMode;
  /** 面试官是否正在生成/播报：为真时麦克风进入插话检测（26C）。 */
  assistantActive: boolean;
  /** 一段语音判定完成，文字交给作答框（追加语义由调用方决定）。 */
  onTranscript: (text: string) => void;
  /** 硬插话：调用方 abort 当前生成（cancel 已由会话先发）。 */
  onBargeIn: () => void;
  /** 26F 接口位；默认 no-op（纯文字模式）。 */
  output?: InterviewVoiceOutput;
  /** 断句时长覆盖（Q1-D，来自通话设置）；不传 = `endpoint.ts` 的默认常量。 */
  endpointTiming?: EndpointTiming;
  /** 插话灵敏度覆盖（Q1-D）：最小连续语音时长。 */
  bargeInMinSpeechMs?: number;
  /** 测试注入点：不打开真麦克风也能跑状态机。 */
  deps?: {
    createCapture?: (options: {
      onFrame: (frame: Float32Array, atMs: number) => void;
      onError?: (error: unknown) => void;
    }) => MicCapture;
    transcribe?: (pcm: Int16Array) => Promise<string>;
    cancelTurn?: () => Promise<{ rolled_back_chars?: number } | unknown>;
    now?: () => number;
  };
}

export interface InterviewVoiceController {
  supported: boolean;
  enabled: boolean;
  starting: boolean;
  error: VoiceErrorCode | null;
  snapshot: VoiceSessionSnapshot;
  mode: EndpointMode;
  toggle: () => void;
  releasePushToTalk: () => void;
  clearError: () => void;
}

const IDLE_SNAPSHOT: VoiceSessionSnapshot = {
  phase: "idle",
  voiceActive: false,
  level: 0,
  waveform: [],
  thinking: false,
  ducked: false,
};

/** 取消请求的兜底：本机接口通常 <20ms，卡住时也不能让"打断"永远不 abort 当前流。 */
const CANCEL_ABORT_BUDGET_MS = 120;

export function useInterviewVoice({
  mode,
  assistantActive,
  onTranscript,
  onBargeIn,
  output,
  endpointTiming,
  bargeInMinSpeechMs,
  deps,
}: UseInterviewVoiceOptions): InterviewVoiceController {
  const supported = useMemo(() => isMicCaptureSupported(), []);
  const [enabled, setEnabled] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<VoiceErrorCode | null>(null);
  const [snapshot, setSnapshot] = useState<VoiceSessionSnapshot>(IDLE_SNAPSHOT);
  const captureRef = useRef<MicCapture | null>(null);
  const sessionRef = useRef<InterviewVoiceSession | null>(null);
  const startRequestRef = useRef(0);
  const callbacksRef = useRef({
    onTranscript,
    onBargeIn,
    deps,
    output,
    endpointTiming,
    bargeInMinSpeechMs,
  });
  // 最新回调镜像放到 effect 里更新（渲染期写 ref 会被 react-hooks/refs 拦）。
  useEffect(() => {
    callbacksRef.current = {
      onTranscript,
      onBargeIn,
      deps,
      output,
      endpointTiming,
      bargeInMinSpeechMs,
    };
  }, [onTranscript, onBargeIn, deps, output, endpointTiming, bargeInMinSpeechMs]);

  const teardown = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    sessionRef.current?.dispose();
    sessionRef.current = null;
    setSnapshot(IDLE_SNAPSHOT);
  }, []);

  const start = useCallback(async () => {
    if (!supported || captureRef.current) return;
    const startRequest = startRequestRef.current + 1;
    startRequestRef.current = startRequest;
    setStarting(true);
    setError(null);
    const current = callbacksRef.current;
    const cancelTurn =
      current.deps?.cancelTurn ??
      (async () => {
        const fallback = new Promise<undefined>((resolve) => {
          window.setTimeout(() => resolve(undefined), CANCEL_ABORT_BUDGET_MS);
        });
        return Promise.race([cancelInterviewVoiceTurn(), fallback]);
      });
    const session = new InterviewVoiceSession({
      now: current.deps?.now,
      output: current.output,
      transcribe: current.deps?.transcribe ?? ((pcm) => transcribeSegment(pcm)),
      cancelTurn,
      onTranscript: (text) => callbacksRef.current.onTranscript(text),
      onBargeIn: () => callbacksRef.current.onBargeIn(),
      // 单段识别失败不关闭语音：会话内部已复位，用户再说一次即可。
      onError: (code) => setError(code),
      onUpdate: (next) => setSnapshot(next),
      // 通话设置（Q1-D）：断句时长与插话灵敏度都是"这次通话怎么听"的偏好。
      endpointTiming: current.endpointTiming,
      bargeInMinSpeechMs: current.bargeInMinSpeechMs,
    });
    const createCapture =
      current.deps?.createCapture ??
      ((options) => new MicCapture({ onFrame: options.onFrame, onError: options.onError }));
    const capture = createCapture({
      onFrame: (frame, atMs) => session.handleFrame(frame, atMs),
      onError: (captureError) => {
        setError(micErrorCode(captureError));
        teardown();
        setEnabled(false);
      },
    });
    sessionRef.current = session;
    captureRef.current = capture;
    try {
      await capture.start();
      if (startRequestRef.current !== startRequest) {
        capture.stop();
        return;
      }
      setEnabled(true);
    } catch (microphoneError) {
      if (startRequestRef.current === startRequest) {
        setError(micErrorCode(microphoneError));
        teardown();
        setEnabled(false);
      }
    } finally {
      if (startRequestRef.current === startRequest) setStarting(false);
    }
  }, [supported, teardown]);

  const stop = useCallback(() => {
    startRequestRef.current += 1;
    teardown();
    setEnabled(false);
    setStarting(false);
  }, [teardown]);

  const toggle = useCallback(() => {
    if (enabled || starting) {
      stop();
    } else {
      void start();
    }
  }, [enabled, starting, start, stop]);

  // 面试官开始/停止播报：只切分支，不重开麦克风。
  useEffect(() => {
    sessionRef.current?.setAssistantActive(assistantActive);
  }, [assistantActive]);

  // 模式切换（常开 / 按住说话）与播报状态是同一条会话，只换断句触发源（26G）。
  useEffect(() => {
    sessionRef.current?.setMode(mode);
  }, [mode]);

  useEffect(
    () => () => {
      startRequestRef.current += 1;
      teardown();
    },
    [teardown],
  );

  return {
    supported,
    enabled,
    starting,
    error,
    snapshot,
    mode,
    toggle,
    releasePushToTalk: () => sessionRef.current?.releasePushToTalk(),
    clearError: () => setError(null),
  };
}
