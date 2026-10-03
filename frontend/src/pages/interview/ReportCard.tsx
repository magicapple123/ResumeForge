/**
 * 面试评分报告卡：dashboard 分数 + 维度列表 + 强项/改进清单。
 * （自 InterviewPage 拆出，逐字搬运，行为等价。）
 */
import { PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Listy, Progress, Tag, Typography } from "antd";
import { ListyItem } from "../../components/common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../../components/common/listyPadding";
import type { InterviewDetail } from "../../types";

export function ReportCard({
  session,
  onSaveToMaterial,
  saving,
}: {
  session: InterviewDetail;
  onSaveToMaterial: () => void;
  saving: boolean;
}) {
  const report = session.report ?? {};
  const failed = report.error || (!report.dimensions?.length && !report.summary);
  return (
    <Card size="small" className="interview-report" title="面试评分报告">
      {failed ? (
        <Alert
          type="warning"
          showIcon
          title="报告没有生成成功"
          description={
            report.summary || "可以在资料箱里找到这场面试的问答记录，重新体验一次也可以。"
          }
        />
      ) : (
        <>
          <div className="interview-report-score">
            <Progress
              type="dashboard"
              size={120}
              percent={Math.round(report.score ?? 0)}
              format={(value) => `${value} 分`}
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
                      {item.score} 分
                    </Tag>
                  </div>
                  <Typography.Text type="secondary">{item.comment}</Typography.Text>
                </div>
              </ListyItem>
            )}
          />
          <div className="interview-report-lists">
            <div>
              <Typography.Title level={5}>做得好的地方</Typography.Title>
              <ul>
                {(report.strengths ?? []).map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </div>
            <div>
              <Typography.Title level={5}>下次可以改进</Typography.Title>
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
        把这场面试存进资料箱
      </Button>
    </Card>
  );
}
