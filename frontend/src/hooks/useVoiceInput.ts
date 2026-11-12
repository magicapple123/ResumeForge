// SPDX-License-Identifier: Apache-2.0
/**
 * 语音听写状态机：MediaRecorder 录音 → 三道闸门 → Blob → FormData → POST /api/transcribe。
 *
 * 四态（#8）：idle → **starting** → recording → transcribing → idle。组件只读状态，
 * 不自己碰 MediaRecorder；这样"录音中禁提交""到点自动停""卸载要 stop track"都能在一处保证。
 *
 * ## `starting` 为什么必须有（需求 #8 的根因）
 *
 * 旧实现里 `begin()` 是异步的：`await getUserMedia()` 期间 `status` 还是 `idle`，按钮
 * 外观一点变化都没有。用户点一下没反应就会**再点一下**——此时 `status` 已经变成
 * `recording`，按钮也换成了「结束录音」，第二下正好把录音掐死在 0.1–0.3 秒。后端日志里
 * `bytes=632…1584`（折算 0.1–0.3 s）全是这个形状，而 `qwen3-asr-flash` 对非语音音频
 * 稳定幻觉出「嗯。」。
 *
 * 所以修法有两层，缺一层都拦不住：
 * 1. 点下麦克风**立刻**进 `starting`（按钮变「正在打开麦克风…」并 disabled）；
 * 2. `begin()` 用 `startingRef` 做**同步**占位——`statusRef` 要等一次渲染才更新，挡不住
 *    同一个 tick 里的第二次点击；
 * 3. 再加一道 `MIN_STOP_INTERVAL_MS`：即使按钮状态被绕过（键盘、自动化），起录后
 *    400ms 内的 stop 也一律忽略。
 *
 * ## 录音层为什么不在这个文件
 *
 * `getUserMedia` / `MediaRecorder` / `AudioContext` / 峰值采样在 `voiceRecorder.ts`，
 * 阈值与纯判定在 `voiceGates.ts`，错误码与文案在 `voiceErrors.ts`。此前这里 450/500 行，
 * 再加 #8 的四件事就走不动了。
 */

import { useEffect, useRef, useState } from "react";
import { ApiError, isCancellation, request } from "../api/client";
import {
  readPreferredDeviceId,
  savePreferredDeviceId,
} from "../features/interview-voice/voicePrefs";
import { t } from "../i18n";
import { errorOf, microphoneErrorFor, type VoiceError } from "./voiceErrors";
import {
  FILLER_MAX_MS,
  MIN_RECORDING_MS,
  MIN_STOP_INTERVAL_MS,
  SILENCE_PEAK_THRESHOLD,
  formatPeakPercent,
  isFillerOnly,
} from "./voiceGates";
import { VoiceRecorder, fileNameFor, type OpenRecording } from "./voiceRecorder";

export type { VoiceError, VoiceErrorCode } from "./voiceErrors";

export type VoiceStatus = "idle" | "starting" | "recording" | "transcribing";

export interface VoiceController {
  status: VoiceStatus;
  /** 当前这段录音已录了多久（秒）。idle / starting 时为 0。 */
  seconds: number;
  error: VoiceError | null;
  /**
   * 一次性提示（例如「原来的麦克风不在了，已切回系统默认」）：不是错误，不阻断操作。
   * 可选，是为了让既有调用方（面试页、测试替身）不必补字段。
   */
  notice?: string | null;
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

interface TranscribeStatusResponse {
  configured: boolean;
  provider_host?: string;
}

interface TranscribeResponse {
  text: string;
  provider_host?: string;
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
      message: error.message || errorOf("service_failed").message,
    };
  }
  return errorOf("service_failed");
}

export function useVoiceInput({
  maxSeconds = DEFAULT_MAX_SECONDS,
  onTranscribed,
  probeStatus = true,
}: UseVoiceInputOptions): VoiceController {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setVoiceError] = useState<VoiceError | null>(null);
  const [notice, setVoiceNotice] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [providerHost, setProviderHost] = useState("");

  const mountedRef = useRef(true);
  const statusRef = useRef<VoiceStatus>("idle");
  /** 同步占位：`statusRef` 要等一次渲染，挡不住同一 tick 的第二次点击。 */
  const startingRef = useRef(false);
  /** 每次 begin 的唯一令牌：starting 期间被 cancel 时用它作废这次启动。 */
  const beginTokenRef = useRef(0);
  const configuredRef = useRef<boolean | null>(null);
  const maxSecondsRef = useRef(maxSeconds);
  const onTranscribedRef = useRef(onTranscribed);
  const recorderRef = useRef<VoiceRecorder | null>(null);
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
      beginTokenRef.current += 1;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      // 同步清理：先灭麦克风指示灯，再让还在等 stop() 的调用方结算成 discarded。
      recorder?.dispose();
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

  const finishIdle = () => {
    setStatusSafe("idle");
    if (mountedRef.current) setSeconds(0);
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

  /** MediaRecorder 自身报错（轨道被系统收走等）：不留下半死的录音状态。 */
  const handleRecorderError = () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    recorder?.dispose();
    clearTimer();
    if (mountedRef.current) setVoiceError(errorOf("recording_failed"));
    finishIdle();
  };

  const finishRecording = async (recorder: VoiceRecorder) => {
    const clip = await recorder.stop();
    if (!mountedRef.current) return;
    const discarded = clip.discarded || discardRef.current;
    discardRef.current = false;
    if (discarded) {
      finishIdle();
      return;
    }
    const durationMs = clip.durationMs;
    // 闸门一：一个字节都没收到 = 录音本身失败（与"太短"是两回事）。
    if (clip.chunks.length === 0) {
      setVoiceError(errorOf("recording_failed"));
      finishIdle();
      return;
    }
    // 闸门二：太短——几乎必然是误触，上传只会换回一句幻觉文案。
    if (durationMs < MIN_RECORDING_MS) {
      setVoiceError(errorOf("too_short"));
      finishIdle();
      return;
    }
    // 闸门三：全程没电平 = 设备选错 / 被静音 / 没说话。文案带实测峰值，
    // 用户一眼能分清"设备问题"还是"自己没开口"。
    if (clip.peak !== null && clip.peak < SILENCE_PEAK_THRESHOLD) {
      setVoiceError(errorOf("no_sound", { peak: formatPeakPercent(clip.peak) }));
      finishIdle();
      return;
    }
    const mimeType = clip.mimeType;
    const blob = new Blob(clip.chunks, { type: mimeType });
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
      } else if (isFillerOnly(text) && durationMs < FILLER_MAX_MS) {
        // 语气词兜底：短录音 + 只有「嗯/啊/…」= 没听清。长录音保留原文，
        // 因为用户可能真的只答了一个「嗯」（见 #8 的取舍说明）。
        setVoiceError(errorOf("no_heard"));
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

  /** 用户点「结束」或到点自动停：交给录音层结算，闸门与上传在 finishRecording 里。 */
  const requestStop = () => {
    if (statusRef.current !== "recording") return;
    const recorder = recorderRef.current;
    if (!recorder) return;
    // 连点保护：起录后这一小段窗口内的 stop 一律忽略（不报错、不打断）。
    if (Date.now() - startedAtRef.current < MIN_STOP_INTERVAL_MS) return;
    recorderRef.current = null;
    clearTimer();
    void finishRecording(recorder);
  };

  const begin = async () => {
    if (startingRef.current) return;
    if (statusRef.current !== "idle") return;
    startingRef.current = true;
    const token = beginTokenRef.current + 1;
    beginTokenRef.current = token;
    // 同步进入 starting：`await` 之前的这几行都在同一个 tick 里跑完，
    // 所以第二次点击会撞上上面的两个守卫。
    setStatusSafe("starting");
    if (mountedRef.current) setVoiceNotice(null);
    // 是否真的录上了：决定 finally 里要不要把状态退回 idle。用局部变量而不是
    // 回读 `statusRef`——TS 会把上面 `!== "idle"` 的窄化一路带进 finally。
    let startedRecording = false;
    try {
      setVoiceError(null);
      if (probeStatus && configuredRef.current === null && probeRef.current) {
        // 探测还没回来就点了麦克风：等它，避免"未配置却先申请了麦克风权限"。
        await probeRef.current;
      }
      if (!mountedRef.current || token !== beginTokenRef.current) return;
      if (configuredRef.current === false) {
        setVoiceError(errorOf("not_configured"));
        return;
      }
      if (!VoiceRecorder.isSupported()) {
        setVoiceError(errorOf("unsupported"));
        return;
      }
      let opened: OpenRecording;
      try {
        opened = await VoiceRecorder.open({
          deviceId: readPreferredDeviceId(),
          onError: handleRecorderError,
        });
      } catch (microphoneError) {
        if (mountedRef.current) setVoiceError(microphoneErrorFor(microphoneError));
        return;
      }
      if (!mountedRef.current || token !== beginTokenRef.current) {
        opened.recorder.dispose();
        return;
      }
      if (opened.deviceLost) {
        // 选中的设备不在了：清存储 + 提示一次，本次已回退系统默认并继续录音。
        savePreferredDeviceId(null);
        setVoiceNotice(t("voiceInput.settings.device.lost"));
      }
      recorderRef.current = opened.recorder;
      discardRef.current = false;
      startedAtRef.current = Date.now();
      if (mountedRef.current) setSeconds(0);
      setStatusSafe("recording");
      startedRecording = true;
      startTimer();
    } finally {
      startingRef.current = false;
      // 任何提前返回的路径都不能把状态卡在 starting（用户会看到永远转圈的按钮）。
      if (!startedRecording) finishIdle();
    }
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
    beginTokenRef.current += 1;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    if (recorder) {
      // 让录音层自己走清理（停轨道 + 关 AudioContext），不在这里等它。
      recorder.discard();
    }
    finishIdle();
  };

  return {
    status,
    seconds,
    error,
    notice,
    configured,
    providerHost,
    start,
    stop,
    cancel,
    clearError: () => setVoiceError(null),
  };
}
