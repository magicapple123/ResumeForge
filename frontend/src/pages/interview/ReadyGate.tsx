// SPDX-License-Identifier: Apache-2.0
/**
 * "准备好了吗"闸门（0066）：进房间前必须由用户自己点一下才开始计时。
 *
 * 产品原话是"用户点击开始面试时，面试官要先问用户是否准备好，用户点击『准备好了』之后
 * 才开始计时"。所以它不是装饰性的卡片，而是**计时的开关**：没点之前面试官已经在场
 * （第一题已经生成好了），但秒表不走，输入框也不出现。
 *
 * 两个入口文案共用一块卡片：首次进房间是「准备好了」，离开后回来是「继续面试」——
 * 后者同样要用户主动点，因为离开的这段时间不该算进面试时长。
 */
import { CheckCircleOutlined } from "@ant-design/icons";
import { Button, Card, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { JANE_FACE_SOURCES } from "./janeFaces";

export function ReadyGate({
  onReady,
  resuming,
}: {
  /** 用户点了主按钮（开始计时并显示作答区）。 */
  onReady: () => void;
  /** 是否为"离开后又回来"：按钮文案与说明改口径。 */
  resuming: boolean;
}) {
  // 本卡用模块级 t()：必须订阅语言变化，否则切语言后文案不重渲染。
  useLocale();
  return (
    <Card size="small" className="interview-ready-gate">
      <div className="interview-ready-gate-head">
        <img
          className="jane-avatar jane-avatar--intro"
          src={JANE_FACE_SOURCES.idle}
          alt={t("interviewPage.avatarAlt")}
        />
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            {t("interviewPage.ready.title")}
          </Typography.Title>
          <Typography.Text type="secondary">{t("interviewPage.ready.body")}</Typography.Text>
        </div>
      </div>
      <Button
        type="primary"
        icon={<CheckCircleOutlined />}
        onClick={onReady}
        className="interview-ready-gate-action"
      >
        {resuming ? t("interviewPage.ready.resume") : t("interviewPage.ready.start")}
      </Button>
      <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
        {t("interviewPage.ready.hint")}
      </Typography.Text>
    </Card>
  );
}

export default ReadyGate;
