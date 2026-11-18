// SPDX-License-Identifier: Apache-2.0
/**
 * 通话在场条（I-27）：48px 一行，取代原来的 300px 左轨。
 *
 * 左轨的问题不是"小"，而是**一半高度是空的**：168px 头像 + 一块 4:3 摄像头占位之后，
 * 下面再没有任何内容，而真正要读的对话记录被挤在 300–420px 里。现在把"谁在场、轮到谁"
 * 收成一行：40px 头像（播报时描边呼吸）+ 名字 + 状态胶囊 + 第 N 题。
 *
 * 状态胶囊直接读 `LiveVoiceRoom` 已经算好的那条优先级阶梯，这里不重复判断——
 * 两份状态推导必然漂成"胶囊说在思考、按钮说在听"。
 */
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export function LiveVoiceRoomPresence({
  faceSrc,
  interviewerName,
  statusLabel,
  questionCount,
  speaking,
}: {
  faceSrc: string;
  interviewerName: string;
  /** 已本地化的当前状态（speaking / thinking / waiting-asr / barge-in / listening …）。 */
  statusLabel: string;
  /** 已经问过几题（0 时不渲染，避免开场就出现"第 0 题"）。 */
  questionCount: number;
  speaking: boolean;
}) {
  useLocale();
  return (
    <div className="interview-live-room__presence">
      <span className={`interview-live-room__presence-avatar${speaking ? " is-speaking" : ""}`}>
        <img src={faceSrc} alt={t("interviewVoice.room.interviewer")} />
      </span>
      <span className="interview-live-room__presence-name">{interviewerName}</span>
      <span className="interview-live-room__status-pill" role="status">
        <span
          className={`interview-live-room__status-dot${speaking ? " is-speaking" : ""}`}
          aria-hidden="true"
        />
        {statusLabel}
      </span>
      {questionCount > 0 ? (
        <span className="interview-live-room__presence-meta">
          {t("interviewVoice.room.questionCount", { count: questionCount })}
        </span>
      ) : null}
    </div>
  );
}

export default LiveVoiceRoomPresence;
