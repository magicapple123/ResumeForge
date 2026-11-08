// SPDX-License-Identifier: Apache-2.0
/**
 * 语音听写状态机：MediaRecorder 录音 → Blob → FormData → POST /api/transcribe。
 *
 * 三态（计划 §6）：idle → recording → transcribing → idle。组件只读状态，不自己碰
 * MediaRecorder；这样"录音中禁提交""到点自动停""卸载要 stop track"都能在一处保证。
 * 四个容易漏的点：① 已知未配置时只出提示，不申请麦克风权限、不发转写请求；
 * ② 卸载/切轮次必须 track.stop() + abort 上传，否则指示灯一直亮着（像在偷录）；
 * ③ 到点自动停走与点"结束"完全相同的链路，最后一段录音不会丢；
 * ④ 错误分型：麦克风类与转写类各有独立 code，后端版本太旧（404/405）的提示 6 秒自清。
 */

import { useEffect, useRef, useState } from "react";
import { ApiError, isCancellation, request } from "../api/client";
import { t } from "../i18n";

export type VoiceStatus = "idle" | "recording" | "transcribing";

export type VoiceErrorCode =
  | "no_microphone"
  | "permission_denied"
  | "recording_failed"
  | "unsupported"
  | "timeout"
  | "not_configured"
  | "too_large"
  | "empty"
  | "backend_too_old"
  | "service_failed";

export interface VoiceError {
  code: VoiceErrorCode;
  message: string;
}

export interface VoiceController {
  status: VoiceStatus;
  /** 当前这段录音已录了多久（秒）。idle 时为 0。 */
  seconds: number;
  error: VoiceError | null;
  /** 语音服务是否已配置；null = 还在探测。 */
  configured: boolean | null;
  /** 音频会发到哪台主机（隐私提示用）；未配置时为空串。 */
  providerHost: string;
  start: () => void;
  stop: () => void;
  /** 丢弃当前录音/中止上传（切轮次、离开页面时用），不写回文字。 */
  cancel: () => void;
  clearError: () => void;
}

export interface UseVoiceInputOptions {
  /** 单段上限（秒）。面试追问 60、作答与助手输入 180。 */
  maxSeconds?: number;
  /** 转写成功后的回调：只交文字，绝不替调用方提交。 */
  onTranscribed: (text: string) => void;
  /** 挂载时是否探测服务状态。外层已持有 controller（VoiceButton 复用）时传 false。 */
  probeStatus?: boolean;
}

const DEFAULT_MAX_SECONDS = 180;
/** 「后端版本不支持语音」的提示存活时间：看到就够了，不能常驻成一行红字。 */
const BACKEND_TOO_OLD_CLEAR_MS = 6000;
/** 依次尝试的编码：Chrome/Edge 用 webm+opus，Safari 只支持 mp4。 */
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

interface TranscribeStatusResponse {
  configured: boolean;
  provider_host?: string;
}

interface TranscribeResponse {
  text: string;
  provider_host?: string;
}

/** 前端自己判定得到的错误码 → 文案。后端原因走 ApiError.message，不在这里翻。 */
function messageFor(code: VoiceErrorCode): string {
  switch (code) {
    case "no_microphone":
      return t("voiceInput.error.noMicrophone");
    case "permission_denied":
      return t("voiceInput.error.permissionDenied");
    case "recording_failed":
      return t("voiceInput.error.recordingFailed");
    case "unsupported":
      return t("voiceInput.error.unsupported");
    case "timeout":
      return t("voiceInput.error.timeout");
    case "not_configured":
      return t("voiceInput.error.notConfigured");
    case "too_large":
      return t("voiceInput.error.tooLarge");
    case "empty":
      return t("voiceInput.error.empty");
    case "backend_too_old":
      return t("voiceInput.error.backendTooOld");
    default:
      return t("voiceInput.error.serviceFailed");
  }
}

function errorOf(code: VoiceErrorCode): VoiceError {
  return { code, message: messageFor(code) };
}

/**
 * getUserMedia 的失败原因 → 用户能看懂的分类。不用 instanceof Error：部分环境里
 * DOMException 与 Error 不同链，判断失败会让"权限被拒"退化成兜底的"录音失败"。
 */
function microphoneErrorFor(error: unknown): VoiceError {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  if (name === "NotAllowedError" || name === "SecurityError") return errorOf("permission_denied");
  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    name === "OverconstrainedError"
  ) {
    return errorOf("no_microphone");
  }
  return errorOf("recording_failed");
}

/**
 * 转写请求失败 → 独立错误码；能拿到后端 detail 时优先原样展示（它写清了哪一步配错）。
 * 404/405 例外：那是这台后端没有语音接口（旧进程），detail 只是英文 `Not Found`，
 * 原样显示既看不出原因也没法行动，所以换成 `backend_too_old`。
 */
export function uploadErrorFor(error: unknown): VoiceError {
  if (error instanceof ApiError) {
    if (error.code === "timeout" || error.status === 504) return errorOf("timeout");
    if (error.status === 409) return errorOf("not_configured");
    if (error.status === 413) return errorOf("too_large");
    if (error.status === 422) return errorOf("empty");
    if (error.status === 404 || error.status === 405) return errorOf("backend_too_old");
    return {
      code: "service_failed",
      message: error.message || messageFor("service_failed"),
    };
  }
  return errorOf("service_failed");
}

function pickMimeType(ctor: typeof MediaRecorder): string {
  if (typeof ctor.isTypeSupported !== "function") return "";
  return MIME_CANDIDATES.find((type) => ctor.isTypeSupported(type)) ?? "";
}

function fileNameFor(mimeType: string): string {
  if (mimeType.includes("mp4")) return "voice.mp4";
  if (mimeType.includes("ogg")) return "voice.ogg";
  if (mimeType.includes("wav")) return "voice.wav";
  return "voice.webm";
}

export function useVoiceInput({
  maxSeconds = DEFAULT_MAX_SECONDS,
  onTranscribed,
  probeStatus = true,
}: UseVoiceInputOptions): VoiceController {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setVoiceError] = useState<VoiceError | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [providerHost, setProviderHost] = useState("");

  const mountedRef = useRef(true);
  const statusRef = useRef<VoiceStatus>("idle");
  const configuredRef = useRef<boolean | null>(null);
  const maxSecondsRef = useRef(maxSeconds);
  const onTranscribedRef = useRef(onTranscribed);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const discardRef = useRef(false);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const probeRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      discardRef.current = true;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && statusRef.current === "recording") {
        try {
          recorder.stop();
        } catch {
          // 已经停止/从未开始：无需处理，下面的 track.stop 才是关键。
        }
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      uploadAbortRef.current?.abort();
      uploadAbortRef.current = null;
    };
  }, []);

  // 三份"最新值"的镜像：异步链路（getUserMedia 之后、onstop 之后）读 ref，不读闭包。
  useEffect(() => {
    maxSecondsRef.current = maxSeconds;
    onTranscribedRef.current = onTranscribed;
    configuredRef.current = configured;
  }, [maxSeconds, onTranscribed, configured]);

  /**
   * 后端版本太旧的提示 6 秒后自动消失：这类错误不是用户操作引起的（旧进程没有
   * /api/transcribe），留着红字没有更多信息。定时器随卸载/错误变化一起清掉。
   */
  useEffect(() => {
    if (error?.code !== "backend_too_old") return;
    const timer = window.setTimeout(() => {
      if (mountedRef.current) setVoiceError(null);
    }, BACKEND_TOO_OLD_CLEAR_MS);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!probeStatus || probeRef.current) return;
    probeRef.current = (async () => {
      try {
        const snapshot = await request<TranscribeStatusResponse>("/transcribe/status");
        if (!mountedRef.current) return;
        setConfigured(snapshot.configured);
        setProviderHost(snapshot.provider_host ?? "");
      } catch {
        // 探测失败不拦着用户尝试：转写接口会用准确的中文原因再报一次（例如后端没起）。
      }
    })();
  }, [probeStatus]);

  const setStatusSafe = (next: VoiceStatus) => {
    statusRef.current = next;
    if (mountedRef.current) setStatus(next);
  };

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const finishIdle = () => {
    setStatusSafe("idle");
    if (mountedRef.current) setSeconds(0);
  };

  /** 用户点「结束」或到点自动停：交给 onstop 完成收尾与上传。 */
  const requestStop = () => {
    const recorder = recorderRef.current;
    if (!recorder || statusRef.current !== "recording") return;
    clearTimer();
    try {
      recorder.stop();
    } catch {
      recorderRef.current = null;
      stopTracks();
      setVoiceError(errorOf("recording_failed"));
      finishIdle();
    }
  };

  const handleStopped = async () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    const durationMs = Math.max(0, Date.now() - startedAtRef.current);
    const chunks = chunksRef.current;
    chunksRef.current = [];
    stopTracks();
    if (!mountedRef.current) return;
    if (discardRef.current) {
      discardRef.current = false;
      finishIdle();
      return;
    }
    if (chunks.length === 0) {
      setVoiceError(errorOf("recording_failed"));
      finishIdle();
      return;
    }
    const mimeType = recorder?.mimeType || chunks[0]?.type || "audio/webm";
    const blob = new Blob(chunks, { type: mimeType });
    setStatusSafe("transcribing");
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    const form = new FormData();
    form.append("file", blob, fileNameFor(mimeType));
    form.append("duration_ms", String(Math.round(durationMs)));
    form.append("language", "zh");
    try {
      const result = await request<TranscribeResponse>("/transcribe", {
        method: "POST",
        body: form,
        budget: "recognition",
        signal: controller.signal,
      });
      if (!mountedRef.current) return;
      const text = (result.text ?? "").trim();
      if (!text) {
        setVoiceError(errorOf("empty"));
      } else {
        onTranscribedRef.current(text);
      }
      finishIdle();
    } catch (uploadError) {
      if (!mountedRef.current) return;
      if (!isCancellation(uploadError)) setVoiceError(uploadErrorFor(uploadError));
      finishIdle();
    } finally {
      uploadAbortRef.current = null;
    }
  };

  const startTimer = () => {
    clearTimer();
    timerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      if (mountedRef.current) setSeconds(elapsed);
      if (elapsed >= maxSecondsRef.current && statusRef.current === "recording") {
        // 到点自动停：走与用户点「结束」相同的收尾链路，最后一段录音不会丢。
        requestStop();
      }
    }, 250);
  };

  const begin = async () => {
    if (statusRef.current !== "idle") return;
    setVoiceError(null);
    if (probeStatus && configuredRef.current === null && probeRef.current) {
      // 探测还没回来就点了麦克风：等它，避免"未配置却先申请了麦克风权限"。
      await probeRef.current;
    }
    if (!mountedRef.current) return;
    if (configuredRef.current === false) {
      setVoiceError(errorOf("not_configured"));
      return;
    }
    const ctor = typeof MediaRecorder === "undefined" ? null : MediaRecorder;
    if (!ctor || !navigator.mediaDevices?.getUserMedia) {
      setVoiceError(errorOf("unsupported"));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (microphoneError) {
      if (mountedRef.current) setVoiceError(microphoneErrorFor(microphoneError));
      return;
    }
    if (!mountedRef.current || statusRef.current !== "idle") {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    discardRef.current = false;
    let recorder: MediaRecorder;
    try {
      const mimeType = pickMimeType(ctor);
      recorder = mimeType ? new ctor(stream, { mimeType }) : new ctor(stream);
    } catch {
      stopTracks();
      setVoiceError(errorOf("recording_failed"));
      return;
    }
    recorderRef.current = recorder;
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      recorderRef.current = null;
      stopTracks();
      clearTimer();
      if (mountedRef.current) setVoiceError(errorOf("recording_failed"));
      finishIdle();
    };
    recorder.onstop = () => {
      void handleStopped();
    };
    startedAtRef.current = Date.now();
    if (mountedRef.current) setSeconds(0);
    try {
      recorder.start();
    } catch {
      stopTracks();
      recorderRef.current = null;
      setVoiceError(errorOf("recording_failed"));
      return;
    }
    setStatusSafe("recording");
    startTimer();
  };

  const start = () => {
    void begin();
  };

  const stop = () => {
    discardRef.current = false;
    requestStop();
  };

  const cancel = () => {
    clearTimer();
    discardRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && statusRef.current === "recording") {
      try {
        recorder.stop();
      } catch {
        recorderRef.current = null;
        stopTracks();
        finishIdle();
      }
      return;
    }
    recorderRef.current = null;
    stopTracks();
    uploadAbortRef.current?.abort();
    finishIdle();
  };

  return {
    status,
    seconds,
    error,
    configured,
    providerHost,
    start,
    stop,
    cancel,
    clearError: () => setVoiceError(null),
  };
}
