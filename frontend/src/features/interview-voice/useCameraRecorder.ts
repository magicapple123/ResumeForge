// SPDX-License-Identifier: Apache-2.0
/**
 * 面试镜头的本地录制与抽帧（F18）。一个 hook 管两件事，因为它们共用同一路摄像头流：
 *
 * 1. **录像**：把 `<video>` 的画面画进 568×320 的 canvas，再 `captureStream(12)` 交给
 *    `MediaRecorder`。不直接录原始流的原因：摄像头常见 1080p，30 分钟能到 1GB 以上，
 *    而这里只需要"能回看姿态与表情"；画布降采样同时把分辨率与码率钉死（≤500kbps）。
 *    **只录画面**：画布流本来就没有音轨，`audio: false` 在 `getUserMedia` 那层已经保证。
 * 2. **抽帧**：每 15 秒把画面缩到 480px 宽的 JPEG（q0.6），最多 12 张，随停止一起上传。
 *    原帧只在内存里，上传后即丢弃——后端也只把 data URL 拼进模型消息，不落盘。
 *
 * 两条容易写错的时序：
 * - `MediaRecorder` 的 `stop()` 是异步的：`onstop` 里才拿得到完整 blob。上传必须挂在
 *   `onstop`，不能在调用 `stop()` 之后立刻读 chunks。
 * - 组件卸载时 `stop()` 之后还要把 blob 传上去，否则"关掉房间就丢一整场录像"。这里用
 *   `pendingRef` 兜住，卸载后照样发请求（请求不依赖组件存活），只是不再 setState。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeInterviewCameraFrames, uploadInterviewRecording } from "../../api/interview";
import { t } from "../../i18n";
import {
  CAMERA_FRAME_INTERVAL_MS,
  CAMERA_MAX_FRAMES,
  CAMERA_MAX_RECORD_BYTES,
  CAMERA_MAX_RECORD_SECONDS,
  type InterviewCameraSettings,
} from "./cameraSettings";

export type CameraUploadState = "idle" | "recording" | "uploading" | "done" | "failed";

export interface CameraRecorderController {
  /** 正在录制。 */
  recording: boolean;
  /** 已抽帧数（0 表示还没到第一个 15 秒）。 */
  sampled: number;
  /** 已录制秒数。 */
  elapsed: number;
  uploadState: CameraUploadState;
  /** 失败原因（i18n key，由界面翻译）；空串表示没有错误。 */
  error: string;
  /** 立即停止并上传（房间里的「停止录制」）。 */
  stop: () => void;
  /** 上传失败后重试（blob 仍在内存里）。 */
  retry: () => void;
}

const RECORDER_MIME = "video/webm;codecs=vp8";
const RECORD_WIDTH = 568;
const RECORD_HEIGHT = 320;
const RECORD_FPS = 12;
const FRAME_WIDTH = 480;

/** 浏览器是否具备录制能力（Safari 老版本没有 MediaRecorder）。 */
export function cameraRecordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function"
  );
}

/** 把一帧画到目标宽度，返回 JPEG data URL；用于抽帧（纯函数，便于单测尺寸换算）。 */
export function drawFrameDataUrl(
  source: HTMLVideoElement,
  width = FRAME_WIDTH,
  quality = 0.6,
): string | null {
  const sourceWidth = source.videoWidth || 0;
  const sourceHeight = source.videoHeight || 0;
  if (!sourceWidth || !sourceHeight) return null;
  const height = Math.max(1, Math.round((sourceHeight / sourceWidth) * width));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** 内部：一次录制的可变状态（不进 React state，避免每帧重渲染）。 */
interface SessionRefs {
  recorder: MediaRecorder | null;
  chunks: BlobPart[];
  bytes: number;
  frames: string[];
  startedAt: number;
  elapsed: number;
  stopped: boolean;
  uploadSeq: number;
}

export function useCameraRecorder(options: {
  stream: MediaStream | null;
  sessionId: number | null;
  settings: InterviewCameraSettings;
  /** 房间当前是否需要录制（暂停/关闭时为 false，会先停再传）。 */
  active: boolean;
}): CameraRecorderController {
  const { stream, sessionId, settings, active } = options;
  const [recording, setRecording] = useState(false);
  const [sampled, setSampled] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [uploadState, setUploadState] = useState<CameraUploadState>("idle");
  const [error, setError] = useState("");
  const refs = useRef<SessionRefs>({
    recorder: null,
    chunks: [],
    bytes: 0,
    frames: [],
    startedAt: 0,
    elapsed: 0,
    stopped: false,
    uploadSeq: 0,
  });
  const pendingBlob = useRef<Blob | null>(null);
  const mounted = useRef(true);
  const settingsRef = useRef(settings);
  const sessionRef = useRef(sessionId);
  // React Compiler 的 refs 规则不允许在渲染期写 ref：统一挪到 effect，异步回调读到的
  // 就是"最近一次提交后"的值。
  useEffect(() => {
    settingsRef.current = settings;
    sessionRef.current = sessionId;
  }, [settings, sessionId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const upload = useCallback(async (blob: Blob, frames: string[], seconds: number) => {
    const id = sessionRef.current;
    if (!id) return;
    const seq = refs.current.uploadSeq;
    if (mounted.current) {
      setUploadState("uploading");
      setError("");
    }
    try {
      const current = settingsRef.current;
      if (current.record && blob.size > 0) {
        await uploadInterviewRecording(id, blob, current.retentionDays, seconds);
      }
      if (current.analyze && frames.length > 0) {
        await analyzeInterviewCameraFrames(id, frames, current.countInScore);
      }
      if (refs.current.uploadSeq === seq && mounted.current) {
        setUploadState("done");
      }
      pendingBlob.current = null;
    } catch (cause) {
      if (refs.current.uploadSeq === seq && mounted.current) {
        setUploadState("failed");
        setError(
          cause instanceof Error && cause.message
            ? cause.message
            : t("interviewCamera.room.uploadFailed"),
        );
      }
      pendingBlob.current = blob;
    }
  }, []);

  const stop = useCallback(() => {
    const state = refs.current;
    if (state.stopped) return;
    state.stopped = true;
    state.elapsed = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
    const recorder = state.recorder;
    state.recorder = null;
    const frames = [...state.frames];
    const seconds = state.elapsed;
    const finish = () => {
      const blob = new Blob(state.chunks, { type: "video/webm" });
      state.chunks = [];
      if (mounted.current) {
        setRecording(false);
        setElapsed(seconds);
      }
      if (blob.size > 0 || frames.length > 0) {
        void upload(blob, frames, seconds);
      } else if (mounted.current) {
        setUploadState("idle");
      }
    };
    if (!recorder || recorder.state === "inactive") {
      finish();
      return;
    }
    // onstop 之后才拿得到最后一段数据；这里不用 addEventListener，避免重复绑。
    recorder.onstop = finish;
    try {
      recorder.stop();
    } catch {
      finish();
    }
  }, [upload]);

  const retry = useCallback(() => {
    const blob = pendingBlob.current;
    if (!blob) return;
    refs.current.uploadSeq += 1;
    void upload(blob, [], refs.current.elapsed);
  }, [upload]);

  // 录制主循环：流就绪 + 总开关 + 录像开关 + 房间活跃时启动；任一条件失效就停并上传。
  useEffect(() => {
    const shouldRecord = Boolean(
      stream && sessionId && settings.enabled && settings.record && active,
    );
    if (!shouldRecord || !stream || !cameraRecordingSupported()) return;

    const state = refs.current;
    state.chunks = [];
    state.bytes = 0;
    state.frames = [];
    state.stopped = false;
    state.startedAt = Date.now();
    state.elapsed = 0;
    state.uploadSeq += 1;
    setUploadState("recording");
    setSampled(0);
    setElapsed(0);
    setError("");

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    void video.play().catch(() => undefined);

    const canvas = document.createElement("canvas");
    canvas.width = RECORD_WIDTH;
    canvas.height = RECORD_HEIGHT;
    const context = canvas.getContext("2d");
    let raf = 0;
    let lastDraw = 0;
    const draw = (stamp: number) => {
      raf = requestAnimationFrame(draw);
      if (stamp - lastDraw < 1000 / RECORD_FPS) return;
      lastDraw = stamp;
      if (context && video.videoWidth) {
        context.drawImage(video, 0, 0, RECORD_WIDTH, RECORD_HEIGHT);
      }
    };
    raf = requestAnimationFrame(draw);

    try {
      const canvasStream = canvas.captureStream(RECORD_FPS);
      const recorder = new MediaRecorder(canvasStream, {
        mimeType: RECORDER_MIME,
        videoBitsPerSecond: 500_000,
      });
      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;
        state.chunks.push(event.data);
        state.bytes += event.data.size;
        if (state.bytes >= CAMERA_MAX_RECORD_BYTES) {
          // 超体积上限：自动停，报告里会显示"已截断"（见 ReportCard 说明）。
          stop();
        }
      };
      recorder.start(1000);
      state.recorder = recorder;
      setRecording(true);
    } catch {
      setRecording(false);
      setError(t("interviewCamera.room.unsupported"));
      cancelAnimationFrame(raf);
      return;
    }

    const tick = window.setInterval(() => {
      if (state.stopped) return;
      const seconds = Math.round((Date.now() - state.startedAt) / 1000);
      setElapsed(seconds);
      if (seconds >= CAMERA_MAX_RECORD_SECONDS) stop();
    }, 1000);

    const sampler = settings.analyze
      ? window.setInterval(() => {
          if (state.stopped || state.frames.length >= CAMERA_MAX_FRAMES) return;
          const frame = drawFrameDataUrl(video);
          if (!frame) return;
          state.frames.push(frame);
          if (mounted.current) setSampled(state.frames.length);
        }, CAMERA_FRAME_INTERVAL_MS)
      : 0;

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(tick);
      if (sampler) window.clearInterval(sampler);
      // 停麦前先停录：stop() 会把已录内容与已抽帧一起传上去。
      stop();
    };
    // stop 是 useCallback（依赖上传函数），不作为重启动条件。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, sessionId, settings.enabled, settings.record, settings.analyze, active]);

  return { recording, sampled, elapsed, uploadState, error, stop, retry };
}
