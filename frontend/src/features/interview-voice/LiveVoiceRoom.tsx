// SPDX-License-Identifier: Apache-2.0
/**
 * 面试进行中的「实时语音房间」：三段式外壳（header / body / footer）。
 *
 * 自 2026-11 的排版返工起，房间拆成三层：
 * - `LiveVoiceRoomStage`（左轨：形象 + 声波 + 摄像头 PiP）
 * - `LiveVoiceRoomTurn` + `LiveVoiceRoomAside`（主栏：当前问答卡 → 对话记录，记录自己滚）
 * - `LiveVoiceRoomControls`（底栏：模式 / 麦克风 / 状态 + 摄像头 / 设置 / 暂停）
 *
 * 为什么拆：单个文件已经 314 行、预算 500，而这次既要加设置弹层、又要加"改文字重问"和
 * 暂停入口，不拆必超。这里只留**状态**（摄像头授权、状态文案阶梯）与三层之间的拼装。
 *
 * 两个非显然的点仍然留在这里：
 * 1. 摄像头授权是异步的：`cameraRequest` 记「第几次请求」，关掉/重开/卸载时自增；迟到的
 *    `getUserMedia` 结果据此丢弃——否则用户关了摄像头，旧 promise 回来又把它打开；
 * 2. 状态文案是一条**优先级阶梯**（启动中 > 对方说话 > 被打断 > 思考 > 等 ASR > 聆听 >
 *    已关闭）。顺序动了会出现"正在思考"和"正在说话"同时闪。
 */
import { CloseOutlined } from "@ant-design/icons";
import { Button, Space, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InterviewMessage } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { JANE_FACE_SOURCES, janeFaceForStyle } from "../../pages/interview/janeFaces";
import type { EndpointMode } from "./endpoint";
import { useCameraSettings } from "./cameraSettings";
import { useCameraRecorder } from "./useCameraRecorder";
import { LiveVoiceRoomAside } from "./LiveVoiceRoomAside";
import { LiveVoiceRoomControls } from "./LiveVoiceRoomControls";
import { LiveVoiceRoomStage } from "./LiveVoiceRoomStage";
import { LiveVoiceRoomTurn, type CurrentTurn } from "./LiveVoiceRoomTurn";
import type { InterviewVoiceController } from "./useInterviewVoice";
import type { VoiceOption } from "./VoiceSettingsPopover";
import "./live-voice-room.css";
import "./liveVoiceRoomPanels.css";

export function LiveVoiceRoom({
  voice,
  mode,
  onModeChange,
  interviewerStyle,
  messages,
  pendingAnswer,
  streamingQuestion,
  speaking,
  speechNotice,
  voices = [],
  revising = false,
  sessionId = null,
  onClose,
  onPause,
  onRevise,
}: {
  voice: InterviewVoiceController;
  mode: EndpointMode;
  onModeChange: (mode: EndpointMode) => void;
  interviewerStyle: string;
  messages: InterviewMessage[];
  pendingAnswer: string | null;
  streamingQuestion: string | null;
  speaking: boolean;
  /** 合成回落 / 不支持朗读时的一句说明；null 表示一切正常。 */
  speechNotice?: string | null;
  /** 后端音色清单（拿不到时下拉只显示当前值）。 */
  voices?: VoiceOption[];
  /** 正在重新生成（改文字重问已提交）。 */
  revising?: boolean;
  /** 当前面试会话 id：录像与抽帧按它命名/上传；为空时只做本地预览。 */
  sessionId?: number | null;
  onClose: () => void;
  onPause?: () => void;
  onRevise?: (messageId: number, content: string) => void;
}) {
  useLocale();
  const [cameraSettings] = useCameraSettings();
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  // 摄像头请求序号：每次开/关/卸载都 +1，异步结果回来时只有序号没变才允许落地。
  const cameraRequest = useRef(0);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // 录制与抽帧共用这一路摄像头流；总开关关着时 hook 内部不会启动任何东西。
  const capture = useCameraRecorder({
    stream: cameraStream,
    sessionId,
    settings: cameraSettings,
    active: true,
  });

  const stopCamera = useCallback(() => {
    cameraRequest.current += 1;
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraStream(null);
    setCameraStarting(false);
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = cameraStream;
  }, [cameraStream]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(
    () => () => {
      // 卸载时必须自己停轨：<video> 被移除不会释放摄像头，指示灯会一直亮着。
      cameraRequest.current += 1;
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const toggleCamera = async () => {
    // 总开关没开：不申请摄像头权限（默认关是隐私红线，见 cameraSettings 文件头）。
    if (!cameraSettings.enabled) return;
    if (cameraStreamRef.current) {
      stopCamera();
      return;
    }
    const getUserMedia =
      typeof navigator === "undefined" ? undefined : navigator.mediaDevices?.getUserMedia;
    if (!getUserMedia) {
      setCameraError(true);
      return;
    }
    const request = cameraRequest.current + 1;
    cameraRequest.current = request;
    setCameraStarting(true);
    setCameraError(false);
    try {
      const stream = await getUserMedia.call(navigator.mediaDevices, {
        audio: false,
        video: { facingMode: "user" },
      });
      if (cameraRequest.current !== request) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      cameraStreamRef.current = stream;
      setCameraStarting(false);
      setCameraStream(stream);
    } catch {
      if (cameraRequest.current === request) {
        setCameraError(true);
        setCameraStarting(false);
      }
    }
  };

  // 优先级阶梯：越靠前越"当前"，避免同时命中两句话术时来回闪（顺序见文件头）。
  const statusKey = voice.starting
    ? "interviewVoice.status.starting"
    : speaking
      ? "interviewVoice.room.speaking"
      : voice.enabled
        ? voice.snapshot.ducked
          ? "interviewVoice.status.bargeIn"
          : voice.snapshot.thinking
            ? "interviewVoice.status.thinking"
            : voice.snapshot.phase === "waiting-asr"
              ? "interviewVoice.status.waitingAsr"
              : "interviewVoice.status.listening"
        : "interviewVoice.room.micIdle";

  // 「当前问答」= 最后一条面试官提问 + 最后一条用户回答（都只看正式问答阶段）。
  const formal = messages.filter((item) => item.phase !== "followup");
  const lastQuestion = [...formal].reverse().find((item) => item.role === "interviewer");
  const lastAnswer = [...formal].reverse().find((item) => item.role === "user");
  const turn: CurrentTurn = {
    question: lastQuestion?.content ?? null,
    answer: lastAnswer ? { id: lastAnswer.id, content: lastAnswer.content } : null,
  };

  return (
    <section className="interview-live-room" aria-label={t("interviewVoice.room.title")}>
      <header className="interview-live-room__header">
        <Space align="center" size={12}>
          <span className="interview-live-room__live-dot" aria-hidden="true" />
          <Typography.Text strong>{t("interviewVoice.room.title")}</Typography.Text>
        </Space>
        <Button autoFocus icon={<CloseOutlined aria-hidden="true" />} onClick={onClose}>
          {t("interviewVoice.room.exit")}
        </Button>
      </header>

      <div className="interview-live-room__content">
        {/*
          F15：左轨只放形象与摄像头，主栏是「当前问答 → 对话记录」。
          原来是"舞台 / 记录"两栏，但舞台主体是可伸缩的问答卡，于是宽的一侧几乎空着、
          内容重心反而挤在 300–420px 的右栏里。
        */}
        <LiveVoiceRoomStage
          faceSrc={JANE_FACE_SOURCES[janeFaceForStyle(interviewerStyle)]}
          interviewerName={t("interviewPage.interviewerName")}
          speaking={speaking}
          notice={speechNotice ?? null}
          cameraStream={cameraStream}
          cameraStarting={cameraStarting}
          cameraError={cameraError}
          cameraAllowed={cameraSettings.enabled}
          capture={capture}
          videoRef={videoRef}
          onToggleCamera={() => void toggleCamera()}
        />
        <div className="interview-live-room__main">
          <LiveVoiceRoomTurn turn={turn} revising={revising} onRevise={onRevise} />
          <LiveVoiceRoomAside
            messages={formal}
            pendingAnswer={pendingAnswer}
            streamingQuestion={streamingQuestion}
            faceSrc={JANE_FACE_SOURCES[janeFaceForStyle(interviewerStyle)]}
          />
        </div>
      </div>

      <LiveVoiceRoomControls
        voice={voice}
        mode={mode}
        onModeChange={onModeChange}
        statusLabel={t(statusKey)}
        cameraStream={cameraStream}
        cameraStarting={cameraStarting}
        onToggleCamera={() => void toggleCamera()}
        voices={voices}
        onPause={onPause}
      />
    </section>
  );
}

export default LiveVoiceRoom;
