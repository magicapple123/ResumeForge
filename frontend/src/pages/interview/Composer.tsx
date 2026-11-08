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
 * 语音（T13）与其它两处共用 useVoiceInput / VoiceButton，这里多两条面试专属约束：
 * - 单段上限 3 分钟（maxSeconds=180，到点自动停并转写）；
 * - 转写结果**追加**在已有文字后面（appendTranscript），不覆盖、不插光标；
 * - 录音中「提交回答」禁用并改文案「请先结束录音」，Ctrl/Cmd+Enter 同样不提交。
 */
import { StopOutlined } from "@ant-design/icons";
import { Button, Input, Space, Typography } from "antd";
import { useEffect, useRef } from "react";
import { appendTranscript } from "../../components/voice/appendTranscript";
import { VoiceButton } from "../../components/voice/VoiceButton";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useVoiceInput } from "../../hooks/useVoiceInput";
import "../../styles/interview-voice.css";

export function Composer({
  value,
  submitting,
  onChange,
  onSubmit,
  onStop,
}: {
  /** 输入框里的文字（受控）。 */
  value: string;
  /** 是否正在生成：输入框禁用，按钮换成「停止本轮」。 */
  submitting: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** 停止本轮：abort 当前请求，页面立刻回到可提问状态。 */
  onStop: () => void;
}) {
  useLocale();
  // 转写是异步的（上传 + 服务端识别），回调里读 value 会拿到点击"结束"那一刻的旧值。
  // 用 ref 跟住最新受控值，追加语义才不会把用户在这几秒里敲的字覆盖掉。
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  const voice = useVoiceInput({
    maxSeconds: 180,
    onTranscribed: (text) => onChange(appendTranscript(valueRef.current, text)),
  });
  const recording = voice.status === "recording";

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

  return (
    <div className="interview-composer">
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
      <div className="interview-composer-actions">
        <Typography.Text type="secondary">{t("interview.hint.dontKnow")}</Typography.Text>
        <Space size={8} align="center">
          {/* 语音与提交同在一行；录音中提交按钮换成「请先结束录音」的禁用态。 */}
          <VoiceButton
            voice={voice}
            maxSeconds={180}
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
  );
}

export default Composer;
