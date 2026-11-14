// SPDX-License-Identifier: Apache-2.0
/**
 * 面试房间的头部：身份 Tag + 进度 + 计时器 + 「结束 / 新建」。
 *
 * 自 InterviewPage 拆出（0066 加计时器时顺手做的一次拆分）：页面本体已经贴着 500 行
 * 预算，头部这一段是自成一体的展示 + 两个回调，搬出来不影响任何行为。
 */
import {
  ClockCircleOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  StopOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Button, Space, Tag, Tooltip, Typography } from "antd";
import type { RefObject } from "react";
import type { InterviewDetail } from "../../types";
import { t } from "../../i18n";
import {
  interviewDifficultyLabelKey,
  interviewTypeLabelKey,
  interviewerStyleLabelKey,
} from "../../i18n/enum/interview";
import { useLocale } from "../../i18n/i18nContext";
import { CompanyKnowledgeSection } from "./CompanyKnowledgeSection";

export function RoomHeader({
  session,
  finished,
  answered,
  submitting,
  timerLabel,
  showTimer,
  paused = false,
  pauseButtonRef,
  onPause,
  onEndEarly,
  onNew,
}: {
  session: InterviewDetail;
  finished: boolean;
  /** 已答轮数（服务端算的）。 */
  answered: number;
  submitting: boolean;
  /** `mm:ss` / `h:mm:ss`；`showTimer` 为假时不渲染。 */
  timerLabel: string;
  showTimer: boolean;
  /** 用户主动暂停中：计时读数灰化并标「已暂停」。 */
  paused?: boolean;
  /** 「恢复」时焦点回到这颗按钮（Q2 要求）。 */
  pauseButtonRef?: RefObject<HTMLButtonElement | null>;
  /** 不给就不渲染暂停按钮（既有调用方与单测无需改）。 */
  onPause?: () => void;
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
    <>
      <div className="interview-room-head">
        {/* 左侧身份 Tag 行**不换行**：antd 的 `wrap` 是行内样式，CSS 压不住它；
            1366 下这排 Tag 会把右侧按钮组顶到第二行。窄屏由父级 `overflow-x` 横向滚动。 */}
        <Space size={6}>
          <b>{session.title}</b>
          <Tag color="blue">{typeLabelKey ? t(typeLabelKey) : session.interview_type}</Tag>
          <Tag>{difficultyLabelKey ? t(difficultyLabelKey) : session.difficulty}</Tag>
          <Tag>{styleLabelKey ? t(styleLabelKey) : session.interviewer_style}</Tag>
          {session.job_title ? <Tag color="geekblue">{session.job_title}</Tag> : null}
          {/* 关联简历（0066）：面试官读的就是这份简历，摆在头上让用户随时能确认。 */}
          {session.resume_title ? <Tag color="cyan">{session.resume_title}</Tag> : null}
          {/* 导入的材料文件名（#41）：文件这一侧没有标题可显示，就把文件名摆出来。 */}
          {session.job_material_name ? (
            <Tag color="geekblue">{session.job_material_name}</Tag>
          ) : null}
          {session.resume_material_name ? (
            <Tag color="cyan">{session.resume_material_name}</Tag>
          ) : null}
        </Space>
        <Space size={6} wrap>
          <Typography.Text type="secondary">
            {session.rounds_min != null
              ? t("interview.round.withClosing", { current })
              : t("interview.round.progress", { current, total: session.rounds })}
          </Typography.Text>
          {/* 计时器常显（Q2）：暂停时灰化并加「已暂停」后缀，**不要整块消失**——
              读数一消失，用户会以为累计时长被清零了。 */}
          {showTimer ? (
            <Typography.Text
              type="secondary"
              className={`interview-timer${paused ? " is-paused" : ""}`}
            >
              <ClockCircleOutlined /> {t("interviewPage.timer.label")} {timerLabel}
              {paused ? (
                <span className="interview-timer__paused">
                  {" · "}
                  {t("interviewPage.paused.badge")}
                </span>
              ) : null}
            </Typography.Text>
          ) : null}
          {/* 暂停入口用**图标按钮**：1366 下右侧已经有两段文字 + 两个按钮，加一个文字按钮会折行。 */}
          {!finished && onPause ? (
            <Tooltip
              title={paused ? t("interviewPage.paused.resume") : t("interviewPage.paused.action")}
            >
              <Button
                ref={pauseButtonRef}
                size="small"
                aria-label={
                  paused ? t("interviewPage.paused.resume") : t("interviewPage.paused.action")
                }
                icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
                onClick={onPause}
                disabled={submitting && !paused}
              />
            </Tooltip>
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
      {/* #29D：这家公司面经 N 条（读知识库 related；0 条/无公司名时整块不渲染）。 */}
      <CompanyKnowledgeSection company={session.company} />
    </>
  );
}

export default RoomHeader;
