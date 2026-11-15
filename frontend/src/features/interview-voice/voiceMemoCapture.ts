// SPDX-License-Identifier: Apache-2.0
/**
 * 「语音记一条」的录音层（T09）：16kHz PCM 采集 → WAV → 现有 `POST /api/transcribe`。
 *
 * ## 为什么不用 `useVoiceInput`（面试页那个）
 *
 * 那个 hook 走 `MediaRecorder`，浏览器给的是 **webm/opus**。DeepSeek 的转写只收
 * 16bit PCM WAV / Ogg Opus，webm 会被上游 400——所以口述这条链路必须自己产出 WAV。
 * 这里复用 `MicCapture`（AEC/降噪 + AudioWorklet 分帧的既有实现）与 `audio.ts` 的
 * `concatFloat32` / `floatToPcm16` / `encodeWavBlob`，一行编码逻辑都不新写。
 *
 * ## 为什么不是常开、也不做 VAD 切段
 *
 * "记一条"是**一次一句话**的动作：点一下开始、再点一下结束，整段直接转写。VAD 切段是
 * 面试通话的需求（连续对话），用在这里只会把一句话切成好几条。
 *
 * ## 三道闸门与面试页同口径
 *
 * 太短（< `MIN_RECORDING_MS`）多半是误触；全程无电平（< `SILENCE_PEAK_THRESHOLD`）
 * 是设备选错或被静音。两档都在**上传前**拦住，文案也共用 `hooks/voiceErrors`，
 * 免得同一个 `NotAllowedError` 在两个入口显示两种说法。
 */
import { useEffect, useRef, useState } from "react";
import { isCancellation } from "../../api/client";
import { concatFloat32, floatToPcm16, pcm16Level, TARGET_SAMPLE_RATE } from "./audio";
import { isMicCaptureSupported, MicCapture, micErrorCode } from "./capture";
import { transcribeSegment } from "./transcribe";
import {
  formatPeakPercent,
  MIN_RECORDING_MS,
  SILENCE_PEAK_THRESHOLD,
} from "../../hooks/voiceGates";
import { errorOf, microphoneErrorFor, type VoiceError } from "../../hooks/voiceErrors";
import { uploadErrorFor } from "../../hooks/useVoiceInput";

export type VoiceMemoStatus = "idle" | "recording" | "transcribing";

export interface VoiceMemoCapture {
  status: VoiceMemoStatus;
  /** 已录秒数（idle 时为 0）。 */
  seconds: number;
  error: VoiceError | null;
  start: () => void;
  stop: () => void;
  /** 丢弃当前录音（离开编辑器/切文档时用）。 */
  cancel: () => void;
  clearError: () => void;
}

export interface VoiceMemoCaptureOptions {
  /** 单段上限（秒）：来自 `/transcribe/status` 的 `max_seconds`，选 DeepSeek 时是 120。 */
  maxSeconds: number;
  /** 转写成功后的文字；本 hook 不替调用方插入任何东西。 */
  onTranscribed: (text: string) => void;
}

/** 计时器与自动停止的间隔：250ms 足够让"剩几秒"的读数看起来是连续的。 */
const TICK_MS = 250;

export function useVoiceMemoCapture({
  maxSeconds,
  onTranscribed,
}: VoiceMemoCaptureOptions): VoiceMemoCapture {
  const [status, setStatus] = useState<VoiceMemoStatus>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setVoiceError] = useState<VoiceError | null>(null);

  const captureRef = useRef<MicCapture | null>(null);
  const framesRef = useRef<Float32Array[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const statusRef = useRef<VoiceMemoStatus>("idle");
  const maxSecondsRef = useRef(maxSeconds);
  const onTranscribedRef = useRef(onTranscribed);
  /** 用户点了取消：结算时不再上传。 */
  const discardRef = useRef(false);

  useEffect(() => {
    maxSecondsRef.current = maxSeconds;
    onTranscribedRef.current = onTranscribed;
  }, [maxSeconds, onTranscribed]);

  const setStatusSafe = (next: VoiceMemoStatus) => {
    statusRef.current = next;
    if (mountedRef.current) setStatus(next);
  };

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const teardown = () => {
    const capture = captureRef.current;
    captureRef.current = null;
    capture?.stop();
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      discardRef.current = true;
      clearTimer();
      teardown();
    };
  }, []);

  /** 收尾：把 PCM 编码成 WAV 交给现有接口；空/静音在本地就拦住。 */
  const finish = async () => {
    const frames = framesRef.current;
    framesRef.current = [];
    const durationMs = Date.now() - startedAtRef.current;
    const pcm = frames.length > 0 ? floatToPcm16(concatFloat32(frames)) : new Int16Array(0);
    if (pcm.length === 0) {
      if (!discardRef.current) setVoiceError(errorOf("recording_failed"));
      setStatusSafe("idle");
      return;
    }
    if (durationMs < MIN_RECORDING_MS) {
      if (!discardRef.current) setVoiceError(errorOf("too_short"));
      setStatusSafe("idle");
      return;
    }
    const level = pcm16Level(pcm);
    if (level < SILENCE_PEAK_THRESHOLD) {
      if (!discardRef.current) {
        setVoiceError(errorOf("no_sound", { peak: formatPeakPercent(level) }));
      }
      setStatusSafe("idle");
      return;
    }
    setStatusSafe("transcribing");
    try {
      const text = (await transcribeSegment(pcm)).trim();
      if (!mountedRef.current) return;
      if (!text) setVoiceError(errorOf("empty"));
      else onTranscribedRef.current(text);
    } catch (uploadError) {
      if (!mountedRef.current) return;
      if (!isCancellation(uploadError)) setVoiceError(uploadErrorFor(uploadError));
    } finally {
      if (mountedRef.current) setSeconds(0);
      setStatusSafe("idle");
    }
  };

  const requestStop = () => {
    if (statusRef.current !== "recording") return;
    clearTimer();
    teardown();
    void finish();
  };

  const startTimer = () => {
    clearTimer();
    timerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      if (mountedRef.current) setSeconds(elapsed);
      if (elapsed >= maxSecondsRef.current && statusRef.current === "recording") {
        // 到点自动停：与用户点「结束」走同一条收尾链路，最后一段不会丢。
        requestStop();
      }
    }, TICK_MS);
  };

  const start = () => {
    if (statusRef.current !== "idle") return;
    setVoiceError(null);
    if (!isMicCaptureSupported()) {
      setVoiceError(errorOf("unsupported"));
      return;
    }
    framesRef.current = [];
    discardRef.current = false;
    const capture = new MicCapture({
      onFrame: (frame) => {
        framesRef.current.push(frame);
      },
      onError: (captureError) => {
        // 轨道被系统收走：停下并把原因说出来（静默停在"录音中"最糟）。
        clearTimer();
        teardown();
        if (mountedRef.current) setVoiceError(errorOf("recording_failed"));
        setStatusSafe("idle");
        void captureError;
      },
    });
    captureRef.current = capture;
    setStatusSafe("recording");
    startedAtRef.current = Date.now();
    if (mountedRef.current) setSeconds(0);
    void capture.start().catch((micError: unknown) => {
      teardown();
      if (!mountedRef.current) return;
      const code = micErrorCode(micError);
      setVoiceError(code === "unsupported" ? errorOf("unsupported") : microphoneErrorFor(micError));
      setStatusSafe("idle");
    });
    startTimer();
  };

  const stop = () => {
    discardRef.current = false;
    requestStop();
  };

  const cancel = () => {
    discardRef.current = true;
    clearTimer();
    teardown();
    framesRef.current = [];
    if (mountedRef.current) setSeconds(0);
    setStatusSafe("idle");
  };

  return {
    status,
    seconds,
    error,
    start,
    stop,
    cancel,
    clearError: () => setVoiceError(null),
  };
}

/** 采样率常量在本文件外也会被读（测试用它算期望的帧数），转出去免得重复写 16000。 */
export const VOICE_MEMO_SAMPLE_RATE = TARGET_SAMPLE_RATE;
