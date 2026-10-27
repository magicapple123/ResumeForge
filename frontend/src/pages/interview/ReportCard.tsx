// SPDX-License-Identifier: Apache-2.0
/**
 * 面试评分报告卡：dashboard 分数 + 维度列表 + 强项/改进清单。
 * （自 InterviewPage 拆出，逐字搬运，行为等价。）
 */
import { PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Listy, Progress, Tag, Typography } from "antd";
import { ListyItem } from "../../components/common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../../components/common/listyPadding";
import type { InterviewDetail } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { JANE_FACE_SOURCES, janeFaceForScore } from "./janeFaces";

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
  const report = session.report ?? {};
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
        </>
      )}
      <Button onClick={onSaveToMaterial} loading={saving} icon={<PlusOutlined />}>
        {t("interviewPage.report.saveToMaterial")}
      </Button>
    </Card>
  );
}
