// SPDX-License-Identifier: Apache-2.0
/**
 * 面试房间的头部：身份 Tag + 进度 + 计时器 + 「结束 / 新建」。
 *
 * 自 InterviewPage 拆出（0066 加计时器时顺手做的一次拆分）：页面本体已经贴着 500 行
 * 预算，头部这一段是自成一体的展示 + 两个回调，搬出来不影响任何行为。
 */
import { ClockCircleOutlined, StopOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Button, Space, Tag, Typography } from "antd";
import type { InterviewDetail } from "../../types";
import { t } from "../../i18n";
import {
  interviewDifficultyLabelKey,
  interviewTypeLabelKey,
  interviewerStyleLabelKey,
} from "../../i18n/enum/interview";
import { useLocale } from "../../i18n/i18nContext";

export function RoomHeader({
  session,
  finished,
  answered,
  submitting,
  timerLabel,
  showTimer,
  onEndEarly,
  onNew,
}: {
  session: InterviewDetail;
  finished: boolean;
  /** 已答轮数（服务端算的）。 */
  answered: number;
  submitting: boolean;
  /** `mm:ss` / `h:mm:ss`；`showTimer` 为假时不渲染（还没点「准备好了」）。 */
  timerLabel: string;
  showTimer: boolean;
  onEndEarly: () => void;
  onNew: () => void;
}) {
  // 本卡用模块级 t()：必须订阅语言变化，否则切语言后 Tag / 进度不重渲染。
  useLocale();
  // 房间头部 Tag 显示的是协议值（提交/入库都用它），显示名随语言变；
  // 后端可能回传白名单外的历史值，映射不到就原样显示。
  const typeLabelKey = interviewTypeLabelKey(session.interview_type);
  const difficultyLabelKey = interviewDifficultyLabelKey(session.difficulty);
  const styleLabelKey = interviewerStyleLabelKey(session.interviewer_style);
  const current = Math.min(answered + (finished ? 0 : 1), session.rounds);

  return (
    <div className="interview-room-head">
      <Space size={6} wrap>
        <b>{session.title}</b>
        <Tag color="blue">{typeLabelKey ? t(typeLabelKey) : session.interview_type}</Tag>
        <Tag>{difficultyLabelKey ? t(difficultyLabelKey) : session.difficulty}</Tag>
        <Tag>{styleLabelKey ? t(styleLabelKey) : session.interviewer_style}</Tag>
        {session.job_title ? <Tag color="geekblue">{session.job_title}</Tag> : null}
        {/* 关联简历（0066）：面试官读的就是这份简历，摆在头上让用户随时能确认。 */}
        {session.resume_title ? <Tag color="cyan">{session.resume_title}</Tag> : null}
      </Space>
      <Space size={6} wrap>
        <Typography.Text type="secondary">
          {session.rounds_min != null
            ? t("interview.round.withClosing", { current })
            : t("interview.round.progress", { current, total: session.rounds })}
        </Typography.Text>
        {/* 计时器只在用户点过「准备好了」之后出现：没开始就不该有读数。 */}
        {showTimer ? (
          <Typography.Text type="secondary" className="interview-timer">
            <ClockCircleOutlined /> {t("interviewPage.timer.label")} {timerLabel}
          </Typography.Text>
        ) : null}
        {!finished && (
          <Button
            size="small"
            danger
            icon={<StopOutlined />}
            onClick={onEndEarly}
            loading={submitting}
          >
            {t("interview.action.end")}
          </Button>
        )}
        <Button size="small" icon={<ThunderboltOutlined />} onClick={onNew}>
          {t("interview.action.new")}
        </Button>
      </Space>
    </div>
  );
}

export default RoomHeader;
