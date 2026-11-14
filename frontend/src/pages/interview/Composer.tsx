// SPDX-License-Identifier: Apache-2.0
/**
 * 面试作答区：输入框 + 「提交回答」/「停止本轮」+ 语音听写。
 *
 * 自 InterviewPage 拆出（T04-c）：页面本体贴着 500 行预算，而这一段是纯渲染。
 *
 * 「停止本轮」是这个组件存在的实质理由：一轮生成要十几到几十秒，用户不该被迫等完。
 * 生成中按钮换成它——点下去 abort 掉 SSE，界面立刻回到可继续提问的状态，服务端把这一轮
 * 标成 interrupted（回答保留，可重答）。**不是**"结束面试"：那是 RoomHeader 上的另一件事。
 *
 * 实时通话（Q1）之后这里多了四件事：
 * - **音色**：面试官的话交给后端 `qwen3-tts-flash`（默认 Cherry）朗读，浏览器音色退为兜底，
 *   兜底时界面上必须有一句说明（静默无声比音色不对更难排查）；
 * - **可配置**：音色 / 语速 / 音量 / 断句 / 自动发送 / 录音上限都从 `voiceSettings` 来，
 *   改完立即生效、重启保留；
 * - **识别纠错 L1**：关掉「自动发送」后，识别结果先落成可编辑的待确认气泡，
 *   可以「重说这段」（只覆盖最近一段）或「就这样发」；
 * - **改文字重问 L2**：已提交的那条回答可以在通话左栏的"当前问答"里改字重问。
 */
import { StopOutlined, VideoCameraOutlined } from "@ant-design/icons";
import { Button, Input, Space, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { appendTranscript } from "../../features/interview-voice/appendTranscript";
import { BrowserSpeechOutput } from "../../features/interview-voice/browserSpeechOutput";
import { VoiceButton } from "../../features/interview-voice/VoiceButton";
import type { EndpointMode } from "../../features/interview-voice/endpoint";
import { InterviewVoiceBar } from "../../features/interview-voice/InterviewVoiceBar";
import { LiveVoiceRoom } from "../../features/interview-voice/LiveVoiceRoom";
import { RemoteSpeechOutput } from "../../features/interview-voice/remoteSpeechOutput";
import { useInterviewVoice } from "../../features/interview-voice/useInterviewVoice";
import {
  BARGE_IN_MIN_SPEECH_MS,
  useVoiceSettings,
} from "../../features/interview-voice/voiceSettings";
import type { VoiceOption } from "../../features/interview-voice/VoiceSettingsPopover";
import type { InterviewMessage } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useVoiceInput } from "../../hooks/useVoiceInput";
import "../../styles/interview-voice.css";

/** 后端音色清单：拿不到就只显示当前值，不阻塞通话。 */
interface TtsStatus {
  available: boolean;
  default_voice: string;
  voices: VoiceOption[];
}

export function Composer({
  value,
  submitting,
  onChange,
  onSubmit,
  onSubmitText,
  onStop,
  onPause,
  onRevise,
  interviewerReply,
  interviewerStyle,
  messages,
  pendingAnswer,
  streamingQuestion,
  sessionId,
}: {
  /** 输入框里的文字（受控）。 */
  value: string;
  /** 是否正在生成：输入框禁用，按钮换成「停止本轮」。 */
  submitting: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** 通话模式下，识别完成后直接提交回答。 */
  onSubmitText: (value: string) => void;
  /** 停止本轮：abort 当前请求，页面立刻回到可提问状态。 */
  onStop: () => void;
  /** 暂停面试（Q2）。实时通话房间是覆盖全屏的一层，头部按钮被盖住，所以房间内必须另给入口。 */
  onPause?: () => void;
  /** 改文字重问（Q1-L2）：改掉已提交的那条回答并重新生成。 */
  onRevise?: (messageId: number, content: string) => void;
  interviewerReply: { sequence: number; text: string } | null;
  interviewerStyle: string;
  messages: InterviewMessage[];
  pendingAnswer: string | null;
  streamingQuestion: string | null;
  /** 当前面试 id：录像与抽帧按它命名（F18）。 */
  sessionId?: number | null;
}) {
  const locale = useLocale();
  const [settings] = useVoiceSettings();
  const [liveRoomOpen, setLiveRoomOpen] = useState(false);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const [speechError, setSpeechError] = useState(false);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [tts, setTts] = useState<TtsStatus | null>(null);
  const roomOpenRef = useRef(false);
  const wasLiveRoomOpen = useRef(false);
  const liveRoomTriggerRef = useRef<HTMLButtonElement>(null);
  const spokenReplySequence = useRef(0);
  // 设置要能被"当前这次播报"读到，又不能让回复 effect 因为设置变化重跑（会重播上一句）。
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const browserOutput = useMemo(
    () =>
      BrowserSpeechOutput.create({
        onSpeakingChange: setAssistantSpeaking,
        onError: () => setSpeechError(true),
      }),
    [],
  );
  const speechOutput = useMemo(
    () =>
      new RemoteSpeechOutput({
        voice: settings.voice,
        rate: settings.rate,
        volume: settings.volume,
        onSpeakingChange: setAssistantSpeaking,
        // 兜底时把原因写到界面上（"本轮改用本机音色"），不许静默无声。
        onFallback: (reason) => {
          setSpeechError(true);
          setFallbackReason(reason);
        },
        fallback: browserOutput,
      }),
    [browserOutput, settings.voice, settings.rate, settings.volume],
  );
  useEffect(() => {
    speechOutput.configure({
      voice: settings.voice,
      rate: settings.rate,
      volume: settings.volume,
    });
    browserOutput.configure({ rate: settings.rate, volume: settings.volume });
  }, [browserOutput, speechOutput, settings.voice, settings.rate, settings.volume]);
  useEffect(() => {
    browserOutput.setLocale(locale);
  }, [locale, browserOutput]);
  useEffect(() => () => speechOutput.stop(), [speechOutput]);

  // 进房间先问一次音色清单（同时让后端预热一次合成：首次冷启动实测 6.4s）。
  useEffect(() => {
    if (!liveRoomOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/interview/voice/tts/status", { method: "GET" });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          available: boolean;
          default_voice: string;
          voices: { id: string; label: string }[];
        };
        if (!cancelled) setTts(payload);
      } catch {
        // 拿不到清单不影响通话：下拉只显示当前音色，合成失败时还有浏览器兜底。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [liveRoomOpen]);

  // 转写是异步的（上传 + 服务端识别），回调里读 value 会拿到点击"结束"那一刻的旧值。
  // 用 ref 跟住最新受控值，追加语义才不会把用户在这几秒里敲的字覆盖掉。
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  useEffect(() => {
    roomOpenRef.current = liveRoomOpen;
    if (wasLiveRoomOpen.current && !liveRoomOpen) liveRoomTriggerRef.current?.focus();
    wasLiveRoomOpen.current = liveRoomOpen;
  }, [liveRoomOpen]);
  const voice = useVoiceInput({
    maxSeconds: settings.maxRecordSeconds,
    onTranscribed: (text) => onChange(appendTranscript(valueRef.current, text)),
  });
  const recording = voice.status === "recording";

  /**
   * 待确认气泡（L1）：`segments` 记"有哪几段"（用来显示粒度），`draft` 是用户实际看到/编辑的
   * 文本。**替换语义放在这里而不是 `useInterviewVoice` 里**：hook 只负责"这段识别成了什么"，
   * "这几段怎么拼"本来就是缓冲区所有者的职责，放在这里还能被组件测试直接覆盖。
   */
  const [pending, setPending] = useState<{ segments: string[]; draft: string } | null>(null);
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  // #26 P0 实时语音：VAD 分段 → /api/transcribe → 断句规则决定何时把文字落进输入框。
  // 面试官正在生成（submitting）时同一条麦克风切到插话检测；硬停后先 cancel 服务端
  // 这一轮再 abort（顺序由会话保证），界面立刻回到可提问态。
  const [voiceMode, setVoiceMode] = useState<EndpointMode>("always-on");
  const onStopRef = useRef(onStop);
  useEffect(() => {
    onStopRef.current = onStop;
  }, [onStop]);
  const realtimeVoice = useInterviewVoice({
    mode: voiceMode,
    assistantActive: submitting || assistantSpeaking,
    onTranscript: (text) => {
      if (!roomOpenRef.current) {
        onChange(appendTranscript(valueRef.current, text));
        return;
      }
      // 自动发送且还没有待确认内容：保持原来的"说完就发"，一条都不攒。
      if (settingsRef.current.autoSend && pendingRef.current === null) {
        onSubmitText(text);
        return;
      }
      const segments = [...(pendingRef.current?.segments ?? []), text];
      const draft = `${pendingRef.current?.draft ?? ""}${text}`;
      setPending({ segments, draft });
    },
    onBargeIn: () => onStopRef.current(),
    output: speechOutput,
    endpointTiming: {
      continueMs: settings.endpointSilenceMs,
      extendedMs: settings.fillerHoldMs,
      thinkingMs: 5000,
      graceMs: 400,
    },
    bargeInMinSpeechMs: BARGE_IN_MIN_SPEECH_MS[settings.bargeIn],
  });

  useEffect(() => {
    if (!interviewerReply || interviewerReply.sequence <= spokenReplySequence.current) return;
    spokenReplySequence.current = interviewerReply.sequence;
    // 「面试官是否朗读」是界面偏好：关掉就只出文字。
    if (roomOpenRef.current && settingsRef.current.speakInterviewer) {
      speechOutput.enqueue(interviewerReply.text);
    }
  }, [interviewerReply, speechOutput]);

  // 提交/停止本轮后这一轮清空（turn.reset 会把 answer 置空）：正在录的那段必须停掉，
  // 否则它会在下一轮才把文字追加进来，看起来像"提交后自己又冒出一句话"。
  const cancelVoiceRef = useRef(voice.cancel);
  useEffect(() => {
    cancelVoiceRef.current = voice.cancel;
  });
  useEffect(() => {
    if (submitting) cancelVoiceRef.current();
  }, [submitting]);

  const appendTranscribed = (text: string) => {
    onChange(appendTranscript(valueRef.current, text));
  };

  const closeLiveRoom = () => {
    if (realtimeVoice.enabled || realtimeVoice.starting) realtimeVoice.toggle();
    speechOutput.stop();
    setLiveRoomOpen(false);
  };

  if (liveRoomOpen) {
    const notice = fallbackReason
      ? t("interviewVoice.room.fallbackReason", { reason: fallbackReason })
      : speechError || tts?.available === false
        ? t("interviewVoice.room.fallbackLocal")
        : null;
    return (
      <div className="interview-composer">
        <LiveVoiceRoom
          voice={realtimeVoice}
          mode={voiceMode}
          onModeChange={setVoiceMode}
          interviewerStyle={interviewerStyle}
          messages={messages}
          pendingAnswer={pendingAnswer}
          streamingQuestion={streamingQuestion}
          speaking={assistantSpeaking}
          speechNotice={notice}
          voices={tts?.voices ?? []}
          revising={submitting}
          sessionId={sessionId ?? null}
          onClose={closeLiveRoom}
          onPause={onPause}
          onRevise={onRevise}
        />
      </div>
    );
  }

  return (
    <div className="interview-composer">
      {/* F14：输入框 / 语音条 / 通话入口 / 操作行收进同一个作答框。此前四者平级、
          各自带边框，中间还夹一段无归属的空白，整块读起来是断开的。 */}
      <div className="interview-composer-shell">
        <Input.TextArea
          value={value}
          autoSize={{ minRows: 3, maxRows: 10 }}
          placeholder={t("interview.placeholder")}
          disabled={submitting}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              // 录音中不提交：此时输入框里只有"已说完并转写"的部分，提交会把没说到的
              // 半句话当成完整回答；先结束录音、确认文字再提交（计划 §7 冲突处理）。
              if (recording) return;
              onSubmit();
            }
          }}
        />
        <InterviewVoiceBar
          voice={realtimeVoice}
          mode={voiceMode}
          onModeChange={setVoiceMode}
          disabled={submitting}
        />
        <div className="interview-composer-actions">
          <Typography.Text type="secondary">{t("interview.hint.dontKnow")}</Typography.Text>
          <Space size={8} align="center" wrap>
            {/* 通话入口移进操作行（原来是独占一行的次要按钮，把作答区切成两段）。 */}
            <Button
              ref={liveRoomTriggerRef}
              className="interview-composer__live-room"
              icon={<VideoCameraOutlined aria-hidden="true" />}
              disabled={!realtimeVoice.supported || undefined}
              onClick={() => setLiveRoomOpen(true)}
            >
              {t("interviewVoice.room.enter")}
            </Button>
            {/* 语音与提交同在一行；录音中提交按钮换成「请先结束录音」的禁用态。 */}
            <VoiceButton
              voice={voice}
              maxSeconds={settings.maxRecordSeconds}
              disabled={submitting}
              onTranscribed={appendTranscribed}
            />
            {submitting ? (
              // 生成中：主按钮换成「停止本轮」，不加载动画——这时候"转圈"传达的是"请等"，
              // 而我们要说的是"可以不等"。
              <Button danger icon={<StopOutlined />} onClick={onStop}>
                {t("interview.action.stopRound")}
              </Button>
            ) : (
              <Button
                type="primary"
                disabled={!value.trim() || recording || undefined}
                onClick={onSubmit}
              >
                {recording ? t("voiceInput.action.submitBlocked") : t("interview.action.submit")}
              </Button>
            )}
          </Space>
        </div>
      </div>
      {/* 待确认气泡留在作答框外：它是"待确认的一段话"，不是输入区的一部分。 */}
      {pending ? (
        <section className="interview-pending-bubble" aria-live="polite">
          <div className="interview-pending-bubble__head">
            <Typography.Text strong>{t("interviewVoice.pending.title")}</Typography.Text>
            <Typography.Text type="secondary">
              {t("interviewVoice.pending.segment", { index: pending.segments.length })}
            </Typography.Text>
          </div>
          <Input.TextArea
            value={pending.draft}
            autoSize={{ minRows: 2, maxRows: 8 }}
            placeholder={t("interviewVoice.pending.editPlaceholder")}
            onChange={(event) =>
              setPending((current) =>
                current ? { ...current, draft: event.target.value } : current,
              )
            }
          />
          <Typography.Text type="secondary" className="interview-pending-bubble__hint">
            {t("interviewVoice.pending.hint")}
          </Typography.Text>
          <Space size={8} wrap>
            <Button
              onClick={() =>
                // 「重说这段」= 丢弃最近一段，下一次识别结果自然补上这一段。
                setPending((current) => {
                  if (!current || current.segments.length === 0) return current;
                  const last = current.segments[current.segments.length - 1] ?? "";
                  const draft = current.draft.endsWith(last)
                    ? current.draft.slice(0, current.draft.length - last.length)
                    : "";
                  return { segments: current.segments.slice(0, -1), draft };
                })
              }
            >
              {t("interviewVoice.pending.resay")}
            </Button>
            <Button
              type="primary"
              disabled={!pending.draft.trim()}
              onClick={() => {
                const text = pending.draft.trim();
                setPending(null);
                if (text) onSubmitText(text);
              }}
            >
              {t("interviewVoice.pending.send")}
            </Button>
            <Button type="text" onClick={() => setPending(null)}>
              {t("interviewVoice.pending.discard")}
            </Button>
          </Space>
        </section>
      ) : null}
    </div>
  );
}

export default Composer;
