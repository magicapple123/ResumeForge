// SPDX-License-Identifier: Apache-2.0
/**
 * 面试评分报告卡：dashboard 分数 + 维度列表 + 强项/改进清单。
 * （自 InterviewPage 拆出，逐字搬运，行为等价。）
 */
import { BookOutlined, ClockCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Listy, Progress, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { createKnowledgeFromSource } from "../../api/knowledge";
import { ListyItem } from "../../components/common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../../components/common/listyPadding";
import { formatElapsed } from "../../features/interview/useInterviewTimer";
import type { InterviewDetail } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { JANE_FACE_SOURCES, janeFaceForScore } from "./janeFaces";
import { CameraReportSection } from "./CameraReportSection";

export function ReportCard({
  session,
  onSaveToMaterial,
  saving,
}: {
  session: InterviewDetail;
  onSaveToMaterial: () => void;
  saving: boolean;
}) {
  // 本卡用模块级 t()：必须订阅语言变化，否则切语言后报告文案不重渲染。
  useLocale();
  const { message } = App.useApp();
  const [savingKnowledge, setSavingKnowledge] = useState(false);
  const report = session.report ?? {};

  /** #29B：服务端取源数据生成面经条目（正文/分类/公司/问题清单都由后端拼）。 */
  const saveToKnowledge = async () => {
    if (savingKnowledge) return;
    setSavingKnowledge(true);
    try {
      const saved = await createKnowledgeFromSource("interview_report", session.id);
      if (saved.created) {
        message.success(t("knowledgePage.capture.saved", { title: saved.title }));
      } else {
        message.info(t("knowledgePage.capture.exists", { title: saved.title }));
      }
      // 整页跳转（不用 useNavigate）：报告卡也会在非 Router 的阅读态/测试里渲染。
      window.location.assign("/knowledge");
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("knowledgePage.capture.failed"));
    } finally {
      setSavingKnowledge(false);
    }
  };
  const failed = report.error || (!report.dimensions?.length && !report.summary);
  return (
    <Card size="small" className="interview-report" title={t("interviewPage.report.cardTitle")}>
      {failed ? (
        <Alert
          type="warning"
          showIcon
          title={t("interviewPage.report.failedTitle")}
          description={report.summary || t("interviewPage.report.failedBody")}
        />
      ) : (
        <>
          <div className="interview-report-score">
            <Progress
              type="dashboard"
              size={120}
              percent={Math.round(report.score ?? 0)}
              format={(value) => t("interviewPage.report.score", { score: value ?? 0 })}
            />
            <img
              className="jane-avatar jane-avatar--report"
              src={JANE_FACE_SOURCES[janeFaceForScore(report.score)]}
              alt={t("interviewPage.avatarAlt")}
            />
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {report.summary}
            </Typography.Paragraph>
            {/* 面试用时（0066）：报告要能回答"这场面试聊了多久"——它也是评分时的一个
                节奏依据（太短=回答浮在表层，太长而轮次少=表达拖沓）。 */}
            <Space size={4}>
              <ClockCircleOutlined />
              <Typography.Text type="secondary">
                {t("interviewPage.timer.label")} {formatElapsed(session.duration_seconds)}
              </Typography.Text>
            </Space>
          </div>
          <Listy
            items={report.dimensions ?? []}
            rowKey={(item) => item.name}
            styles={{ item: { ...LISTY_ITEM_PADDING_SMALL } }}
            itemRender={(item) => (
              <ListyItem>
                <div className="interview-dimension">
                  <div className="interview-dimension-head">
                    <b>{item.name}</b>
                    <Tag color={item.score >= 80 ? "green" : item.score >= 60 ? "gold" : "red"}>
                      {t("interviewPage.report.score", { score: item.score })}
                    </Tag>
                  </div>
                  <Typography.Text type="secondary">{item.comment}</Typography.Text>
                </div>
              </ListyItem>
            )}
          />
          <div className="interview-report-lists">
            <div>
              <Typography.Title level={5}>{t("interviewPage.report.strengths")}</Typography.Title>
              <ul>
                {(report.strengths ?? []).map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </div>
            <div>
              <Typography.Title level={5}>
                {t("interviewPage.report.improvements")}
              </Typography.Title>
              <ul>
                {(report.improvements ?? []).map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </div>
          </div>
          {/* F18：镜头表现单独一节（实验性，默认不计入总分）。 */}
          <CameraReportSection sessionId={session.id} camera={report.camera} />
        </>
      )}
      <Space wrap>
        <Button onClick={onSaveToMaterial} loading={saving} icon={<PlusOutlined />}>
          {t("interviewPage.report.saveToMaterial")}
        </Button>
        {/* #29B 回流：会话 id 由后端取报告/问题清单，前端不拼正文。 */}
        <Button
          onClick={() => void saveToKnowledge()}
          loading={savingKnowledge}
          icon={<BookOutlined />}
        >
          {t("knowledgePage.capture.interview")}
        </Button>
      </Space>
    </Card>
  );
}
