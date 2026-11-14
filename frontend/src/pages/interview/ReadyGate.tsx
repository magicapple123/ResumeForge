// SPDX-License-Identifier: Apache-2.0
/**
 * "准备好了吗"闸门（0066）：进房间前必须由用户自己点一下才开始计时。
 *
 * 产品原话是"用户点击开始面试时，面试官要先问用户是否准备好，用户点击『准备好了』之后
 * 才开始计时"。所以它不是装饰性的卡片，而是**计时的开关**：没点之前面试官已经在场
 * （第一题已经生成好了），但秒表不走，输入框也不出现。
 *
 * 三个入口文案共用一块卡片：
 * - `start`：首次进房间，「准备好了」；
 * - `resume`：离开后回来，「继续面试」——同样要用户主动点，因为离开的这段时间不该算进时长；
 * - `paused`：面试中点「暂停」，卡片换成暂停态说明并给「继续面试」（Q2）。
 *   暂停卡上必须写明"暂停时间不计入面试用时"，否则用户会以为丢了几分钟。
 */
import { CheckCircleOutlined, PauseCircleOutlined } from "@ant-design/icons";
import { Button, Card, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { JANE_FACE_SOURCES } from "./janeFaces";

/** 闸门卡的三种口径。 */
export type ReadyGateMode = "start" | "resume" | "paused";

export function ReadyGate({
  onReady,
  mode = "start",
  /** 兼容旧调用方：只给 `resuming` 时等价于 `mode="resume"`。 */
  resuming,
  onResume,
}: {
  /** 用户点了主按钮（开始计时并显示作答区）。 */
  onReady: () => void;
  /** 卡片口径：首次进入 / 离开后回来 / 面试中暂停。 */
  mode?: ReadyGateMode;
  /** @deprecated 用 `mode="resume"`；两者同时给时以 `mode` 为准。 */
  resuming?: boolean;
  /** 暂停态下点「继续面试」的回调；不给时退回 `onReady`。 */
  onResume?: () => void;
}) {
  // 本卡用模块级 t()：必须订阅语言变化，否则切语言后文案不重渲染。
  useLocale();
  const effective: ReadyGateMode = mode !== "start" ? mode : resuming ? "resume" : "start";
  const paused = effective === "paused";
  const title = paused ? t("interviewPage.paused.title") : t("interviewPage.ready.title");
  const body = paused ? t("interviewPage.paused.body") : t("interviewPage.ready.body");
  const action = paused
    ? t("interviewPage.paused.resume")
    : effective === "resume"
      ? t("interviewPage.ready.resume")
      : t("interviewPage.ready.start");
  return (
    <Card size="small" className={`interview-ready-gate${paused ? " is-paused" : ""}`}>
      <div className="interview-ready-gate-head">
        <img
          className="jane-avatar jane-avatar--intro"
          src={JANE_FACE_SOURCES.idle}
          alt={t("interviewPage.avatarAlt")}
        />
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          <Typography.Text type="secondary">{body}</Typography.Text>
        </div>
      </div>
      <Button
        type="primary"
        icon={paused ? <PauseCircleOutlined /> : <CheckCircleOutlined />}
        onClick={paused && onResume ? onResume : onReady}
        className="interview-ready-gate-action"
      >
        {action}
      </Button>
      <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
        {t("interviewPage.ready.hint")}
      </Typography.Text>
    </Card>
  );
}

export default ReadyGate;
