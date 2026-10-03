/**
 * AI 兜底卡：规则能确定就不调用模型，只有认不出的框才问一次。
 * （自 WebFormPage 拆出：:809-836 整块逐字随迁，纯 props。）
 */
import { Card, Space, Switch, Typography } from "antd";

export function AiAssistCard({
  aiOn,
  aiAvailable,
  liveRunning,
  onAiEnabledChange,
}: {
  aiOn: boolean;
  aiAvailable: boolean | null;
  liveRunning: boolean;
  onAiEnabledChange: (enabled: boolean) => void;
}) {
  return (
    <Card size="small" title="未识别字段智能辅助">
      <Space size="middle" wrap>
        <Switch
          checked={aiOn}
          disabled={aiAvailable !== true}
          onChange={onAiEnabledChange}
          aria-label="AI 字段识别辅助"
        />
        {aiAvailable === true ? (
          <Typography.Text type="secondary">
            规则未识别的字段，可交由你在「设置」里配置的模型辅助判断。
            <Typography.Text strong>
              只发页面上本来就有的文字与字段名，不发你的资料内容
            </Typography.Text>
            ；命中的行会标上「AI 建议」并且默认不勾选。
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">
            尚未配置大模型，暂时无法使用。到「设置」页填好 Base URL
            与模型名之后，规则认不出的框就能交给 AI 识别。
          </Typography.Text>
        )}
        {liveRunning ? (
          <Typography.Text type="warning">改动会在下次「开启」时生效</Typography.Text>
        ) : null}
      </Space>
    </Card>
  );
}
