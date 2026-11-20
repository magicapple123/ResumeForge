// SPDX-License-Identifier: Apache-2.0
/**
 * 面试进行中的「实时语音房间」：在场条 + 时间线 + 点评栏 + 呼叫条（I-27）。
 *
 * 自 2026-11-18 的整页重排起，房间不再是"左轨 + 主栏"：
 * - `LiveVoiceRoomPresence`（48px 在场条：头像 / 名字 / 状态胶囊 / 第 N 题）
 * - `LiveVoiceRoomAside` + `LiveVoiceRoomTurn`（时间线：历史在上、当前轮在末尾高亮）
 * - `LiveVoiceRoomReview`（右侧 260px 本轮点评，空态常驻占位）
 * - `LiveVoiceRoomCameraPip`（只在摄像头开启时出现，右下角 160×120）
 * - `LiveVoiceRoomControls`（底栏：模式 / 麦克风 / 摄像头 / 设置 / 暂停）
 *
 * 为什么拆：单个文件已经 314 行、预算 500，而这次既要加设置弹层、又要加"改文字重问"和
 * 暂停入口，不拆必超。这里只留**状态**（摄像头授权、状态文案阶梯）与各层之间的拼装。
 *
 * 两个非显然的点仍然留在这里：
 * 1. 摄像头授权是异步的：`cameraRequest` 记「第几次请求」，关掉/重开/卸载时自增；迟到的
 *    `getUserMedia` 结果据此丢弃——否则用户关了摄像头，旧 promise 回来又把它打开；
 * 2. 状态文案是一条**优先级阶梯**（启动中 > 对方说话 > 被打断 > 思考 > 等 ASR > 聆听 >
 *    已关闭）。顺序动了会出现"正在思考"和"正在说话"同时闪。
 */
import { CloseOutlined } from "@ant-design/icons";
import { App, Button, Space, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InterviewMessage } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { JANE_FACE_SOURCES, janeFaceForStyle } from "../../pages/interview/janeFaces";
import type { EndpointMode } from "./endpoint";
import { useCameraSettings } from "./cameraSettings";
import {
  cameraNotice,
  cameraSettingsActionLabel,
  classifyCameraError,
  openCameraSettings,
  type CameraFailure,
} from "./liveVoiceRoomCamera";
import { useCameraRecorder } from "./useCameraRecorder";
import { LiveVoiceRoomAside } from "./LiveVoiceRoomAside";
import { LiveVoiceRoomCameraPip } from "./LiveVoiceRoomCameraPip";
import { LiveVoiceRoomControls } from "./LiveVoiceRoomControls";
import { LiveVoiceRoomPresence } from "./LiveVoiceRoomPresence";
import { LiveVoiceRoomReview } from "./LiveVoiceRoomReview";
import { LiveVoiceRoomTurn, type CurrentTurn } from "./LiveVoiceRoomTurn";
import type { InterviewVoiceController } from "./useInterviewVoice";
import type { VoiceOption } from "./VoiceSettingsPopover";
import "./live-voice-room.css";
import "./liveVoiceRoomPanels.css";

/** R3-03：三态指示点的可访问名称（中英各一条，见 `i18n/messages/*.interviewVoice.ts`）。 */
const LIVE_DOT_LABELS = {
  idle: "interviewVoice.room.liveDotIdle",
  live: "interviewVoice.room.liveDotLive",
  ended: "interviewVoice.room.liveDotEnded",
} as const;

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
  // I-26：轻提示必须走 `App.useApp()` 的实例，静态 `message` 拿不到 ConfigProvider 的主题，
  // 而且在 jsdom 里根本不渲染——那样"提示有没有出现"就没法被测试断言（只能断言调用了函数）。
  const { message } = App.useApp();
  const [cameraSettings] = useCameraSettings();
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraStarting, setCameraStarting] = useState(false);
  // 上一次 `getUserMedia` 为什么没成（权限 / 没有设备 / 被占用）。与 `cameraSettings.enabled`
  // 一起收成一句话：左栏小字、底栏悬停提示、点击后的轻提示，三处同源（见 liveVoiceRoomCamera）。
  const [cameraFailure, setCameraFailure] = useState<CameraFailure | null>(null);
  /**
   * R3-03：这次房间里**开启过**通话吗？只增不减。
   *
   * 三态指示点需要把「从没开过」和「开过又停了」分开，而控制器只有 `enabled` 这个
   * 当下值——没有"曾经开过"的位。用一个本地标记补上，**不新增任何接口轮询**：
   * 状态源仍是 `voice.enabled`（在场条状态胶囊也读它）。
   */
  const [everLive, setEverLive] = useState(false);
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

  /**
   * I-27：通话期间隐藏全局助手浮球（它 z-index 更高，会压在房间左下角）。
   *
   * 用 `<body data-immersive>` + 一条 CSS 规则，而不是卸载浮球组件：球可能持有长连接 /
   * 状态，卸载会把"退出通话后球不见了"变成新 bug。属性在卸载时移除，浮球自动恢复。
   */
  useEffect(() => {
    document.body.dataset.immersive = "interview";
    return () => {
      delete document.body.dataset.immersive;
    };
  }, []);

  // R3-03：把"开过"这件事记下来。写在渲染期（React 官方"按 props 调整 state"的写法）而不是
  // effect 里：effect 里 setState 会多一次级联提交，且触发 react-hooks/set-state-in-effect。
  if (voice.enabled && !everLive) setEverLive(true);

  /** 两处按钮共用的那句话（`null` = 一切正常，显示"本机预览"）。 */
  const cameraMessage = cameraNotice(cameraSettings.enabled, cameraFailure);

  /**
   * 「为什么打不开」必须说出来（I-26）。
   *
   * 用轻提示而不是 Modal：通话可能正在录音，弹窗会把焦点抢走。总开关关着时多给一个
   * 「去设置」入口——这是唯一能自己解决的分支（权限/设备问题要去浏览器那里改）。
   */
  const notifyCamera = useCallback(
    (text: string, withSettings: boolean) => {
      message.open({
        key: "interview-camera-blocked",
        type: "warning",
        duration: withSettings ? 6 : 4,
        content: withSettings ? (
          <span className="interview-live-room__camera-alert">
            {text}
            <Button type="link" size="small" onClick={openCameraSettings}>
              {cameraSettingsActionLabel()}
            </Button>
          </span>
        ) : (
          text
        ),
      });
    },
    [message],
  );

  const toggleCamera = async () => {
    if (cameraStreamRef.current) {
      stopCamera();
      return;
    }
    // 总开关没开：不申请摄像头权限（默认关是隐私红线，见 cameraSettings 文件头），
    // 但**不再静默**——说清原因并给出「去设置」。
    if (!cameraSettings.enabled) {
      notifyCamera(cameraNotice(false, null) as string, true);
      return;
    }
    const getUserMedia =
      typeof navigator === "undefined" ? undefined : navigator.mediaDevices?.getUserMedia;
    if (!getUserMedia) {
      const failure: CameraFailure = "unsupported";
      setCameraFailure(failure);
      notifyCamera(cameraNotice(true, failure) as string, false);
      return;
    }
    const request = cameraRequest.current + 1;
    cameraRequest.current = request;
    setCameraStarting(true);
    setCameraFailure(null);
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
    } catch (error) {
      if (cameraRequest.current !== request) return;
      // 三类原因分开说：只说"打不开"等于没说，用户不知道该改权限还是插摄像头。
      const failure = classifyCameraError(error);
      setCameraFailure(failure);
      setCameraStarting(false);
      notifyCamera(cameraNotice(true, failure) as string, false);
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

  // R3-03：红点的三态。`starting`（申请麦克风还没成功）算**未开始**——确实还没在通话。
  const callState: keyof typeof LIVE_DOT_LABELS = voice.enabled
    ? "live"
    : everLive
      ? "ended"
      : "idle";

  // 「当前问答」= 最后一条面试官提问 + 最后一条用户回答（都只看正式问答阶段）。
  const formal = messages.filter((item) => item.phase !== "followup");
  const lastQuestion = [...formal].reverse().find((item) => item.role === "interviewer");
  const lastAnswer = [...formal].reverse().find((item) => item.role === "user");
  const turn: CurrentTurn = {
    question: lastQuestion?.content ?? null,
    answer: lastAnswer ? { id: lastAnswer.id, content: lastAnswer.content } : null,
  };
  // I-25：记录区放**已完成**的轮次，当前轮只在底部卡片里。
  // 判据：按 **id** 剔除当前卡正在渲染的两条（同一个对象，引用相等与 id 相同在这里等价）。
  // 用 id 而不是引用，是为了同一 id 出现两条（例如以后把流式消息也写进 `formal`）时也能剔干净；
  // 那种情况下卡片只渲染一条，等于“保留 status 更完整的那条”（`streamingQuestion` 现在不在
  // `formal` 里，所以暂时不会发生）。
  const currentTurnIds = new Set<number>();
  if (lastQuestion) currentTurnIds.add(lastQuestion.id);
  if (lastAnswer) currentTurnIds.add(lastAnswer.id);
  const historyMessages = formal.filter((item) => !currentTurnIds.has(item.id));
  const hasTurn = Boolean(turn.question || turn.answer);
  // I-27：点评搬出气泡 → 独立一栏。取**最近一条**有 feedback 的正式消息；
  // 接口只给一段 Markdown，不在这里拆"结构/证据/表达"三个分（打分是报告的事）。
  const latestFeedback =
    [...formal].reverse().find((item) => (item.context?.feedback ?? "").trim() !== "")?.context
      ?.feedback ?? null;
  // 「第 N 题」按正式提问数算：追问（`phase === "followup"`）不属于题号。
  const questionCount = formal.filter((item) => item.role === "interviewer").length;

  return (
    <section className="interview-live-room" aria-label={t("interviewVoice.room.title")}>
      <header className="interview-live-room__header">
        <Space align="center" size={12}>
          {/* R3-03：三态（未开始 / 通话中 / 已结束）。不写 `aria-hidden`——它现在是有
              信息量的状态，读屏用户也要听得到（原来恒亮的装饰点只能骗过眼睛）。 */}
          <span
            className={`interview-live-room__live-dot is-${callState}`}
            role="img"
            aria-label={t(LIVE_DOT_LABELS[callState])}
          />
          <Typography.Text strong>{t("interviewVoice.room.title")}</Typography.Text>
        </Space>
        <Button autoFocus icon={<CloseOutlined aria-hidden="true" />} onClick={onClose}>
          {t("interviewVoice.room.exit")}
        </Button>
      </header>

      {/*
        I-27：左侧 300px 轨道换成 48px 在场条。轨道一半高度原本是空的，而真正要读的
        对话记录被挤在窄栏里；在场条只回答"谁在场、轮到谁、第几题"。
      */}
      <div className="interview-live-room__presence-row">
        <LiveVoiceRoomPresence
          faceSrc={JANE_FACE_SOURCES[janeFaceForStyle(interviewerStyle)]}
          interviewerName={t("interviewPage.interviewerName")}
          statusLabel={t(statusKey)}
          questionCount={questionCount}
          speaking={speaking}
        />
        {/* 合成回落 / 不支持朗读的说明：删左轨后必须仍可见（验收 4），放在在场条右端。 */}
        {speechNotice ? (
          <Typography.Text type="secondary" className="interview-live-room__notice">
            {speechNotice}
          </Typography.Text>
        ) : null}
      </div>

      <div className="interview-live-room__content">
        <div className={`interview-live-room__thread${cameraStream ? " has-camera" : ""}`}>
          {/*
            I-25：历史在上、当前问答在下——与聊天流的时间顺序一致。
            顺序落在 DOM 上（不用 CSS `order`），Tab 顺序才会和视觉顺序一致；
            同时 `Aside` 只拿剔除当前轮后的历史消息，同一轮不会渲染两遍。
            I-27：`Aside` 里的消息区仍然独占 `aria-live`，当前轮留在它外面——
            把当前卡塞进 live 区域会让同一轮被播报两次（I-25 的回退）。
          */}
          <LiveVoiceRoomAside
            messages={historyMessages}
            pendingAnswer={pendingAnswer}
            streamingQuestion={streamingQuestion}
            faceSrc={JANE_FACE_SOURCES[janeFaceForStyle(interviewerStyle)]}
            // 历史为空但下方已经有当前问答时，「等待面试官提问」会与末尾那条提问自相矛盾。
            emptyText={hasTurn ? t("interviewVoice.room.historyEmpty") : undefined}
          />
          <LiveVoiceRoomTurn turn={turn} revising={revising} onRevise={onRevise} />
          {cameraStream ? <LiveVoiceRoomCameraPip videoRef={videoRef} capture={capture} /> : null}
        </div>
        <LiveVoiceRoomReview feedback={latestFeedback} />
      </div>

      <LiveVoiceRoomControls
        voice={voice}
        mode={mode}
        onModeChange={onModeChange}
        cameraStream={cameraStream}
        cameraStarting={cameraStarting}
        cameraNotice={cameraMessage}
        onToggleCamera={() => void toggleCamera()}
        voices={voices}
        onPause={onPause}
      />
    </section>
  );
}

export default LiveVoiceRoom;
