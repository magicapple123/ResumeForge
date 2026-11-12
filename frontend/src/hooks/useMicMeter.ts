// SPDX-License-Identifier: Apache-2.0
/**
 * 只做电平的麦克风钩子：给「测试麦克风」弹层用。
 *
 * 为什么不复用 `useVoiceInput`：那个 hook 的语义是"录一段 → 上传转写"，而测试麦克风
 * **不该消耗上游额度**，也不该在没有配置语音服务时不可用。所以这里只建
 * `getUserMedia` + `LevelMeter`，不碰 MediaRecorder、不发任何请求。
 *
 * 采样与清理复用 `voiceRecorder` 的 `LevelMeter`（同一个 AudioContext 释放纪律：
 * Chrome 每页上限约 6 个 context，测试弹层反复开合同样会撞上）。
 *
 * `start` / `stop` 用 `useCallback` 固定引用：调用方（弹层）把它们放进 effect 的依赖里，
 * 每次渲染换一份新函数会让"3 秒倒计时"被反复重建，表现为秒数永远停在 3。所以这两个
 * 回调里只读 ref 与 `setState`，状态切换直接内联（不经过每次渲染都新建的辅助函数）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { readPreferredDeviceId } from "../features/interview-voice/voicePrefs";
import { errorOf, microphoneErrorFor, type VoiceError } from "./voiceErrors";
import { PEAK_SAMPLE_INTERVAL_MS } from "./voiceGates";
import { LevelMeter } from "./voiceMeter";

export type MicMeterStatus = "idle" | "starting" | "live";

export interface MicMeter {
  status: MicMeterStatus;
  /** 当前帧电平 0..1（驱动电平条）。 */
  level: number;
  /** 本次测试的峰值 0..1。 */
  peak: number;
  /** 设备名（来自 track.label）；拿不到时为空串，由调用方用占位文案兜住。 */
  deviceLabel: string;
  /** 是否因为原设备不在而回退到了系统默认。 */
  deviceLost: boolean;
  error: VoiceError | null;
  start: () => void;
  stop: () => void;
}

export function useMicMeter(): MicMeter {
  const [status, setStatus] = useState<MicMeterStatus>("idle");
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [deviceLabel, setDeviceLabel] = useState("");
  const [deviceLost, setDeviceLost] = useState(false);
  const [error, setVoiceError] = useState<VoiceError | null>(null);

  const mountedRef = useRef(true);
  const statusRef = useRef<MicMeterStatus>("idle");
  const startingRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const meterRef = useRef<LevelMeter | null>(null);
  const timerRef = useRef<number | null>(null);

  /** 唯一的释放出口：清采样定时器 + 关 AudioContext + 停轨道（灭指示灯）。 */
  const release = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    meterRef.current?.dispose();
    meterRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      release();
    };
  }, [release]);

  const stop = useCallback(() => {
    release();
    startingRef.current = false;
    statusRef.current = "idle";
    if (!mountedRef.current) return;
    setLevel(0);
    setStatus("idle");
  }, [release]);

  const start = useCallback(() => {
    if (startingRef.current || statusRef.current === "live") return;
    startingRef.current = true;
    statusRef.current = "starting";
    setVoiceError(null);
    setPeak(0);
    setLevel(0);
    setDeviceLost(false);
    setStatus("starting");
    void (async () => {
      const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
      if (!media?.getUserMedia) {
        startingRef.current = false;
        statusRef.current = "idle";
        setVoiceError(errorOf("unsupported"));
        setStatus("idle");
        return;
      }
      const preferred = readPreferredDeviceId();
      let stream: MediaStream | null = null;
      let lost = false;
      if (preferred) {
        try {
          stream = await media.getUserMedia({ audio: { deviceId: { exact: preferred } } });
        } catch {
          // 设备不在了：回退默认，测试仍然要能跑完。
          lost = true;
        }
      }
      try {
        if (!stream) stream = await media.getUserMedia({ audio: true });
      } catch (microphoneError) {
        startingRef.current = false;
        if (!mountedRef.current) return;
        statusRef.current = "idle";
        setVoiceError(microphoneErrorFor(microphoneError));
        setStatus("idle");
        return;
      }
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      meterRef.current = LevelMeter.create(stream);
      // 开始那一刻就取一帧：短测试也能看到峰值，不必等第一个采样刻度。
      meterRef.current?.read();
      setDeviceLabel(stream.getAudioTracks?.()[0]?.label ?? "");
      setDeviceLost(lost);
      statusRef.current = "live";
      startingRef.current = false;
      setStatus("live");
      timerRef.current = window.setInterval(() => {
        const meter = meterRef.current;
        if (!meter) return;
        const current = meter.read();
        if (!mountedRef.current) return;
        setLevel(current);
        setPeak(meter.peak);
      }, PEAK_SAMPLE_INTERVAL_MS);
    })();
  }, []);

  return { status, level, peak, deviceLabel, deviceLost, error, start, stop };
}
