/**
 * 填充结果卡：成功/待确认/失败计数、成功率与未落定项明细。
 * （自 WebFormPage 拆出：:986-1014 整块逐字随迁，内用 FillRateTag，纯 props。）
 */
import { Alert, Card, Space, Tag, Typography } from "antd";
import type { WebFormFillResult } from "../../types";
import { FillRateTag } from "./FillRateTag";

export function FillResultCard({ result }: { result: WebFormFillResult }) {
  return (
    <Card size="small" title="填充结果">
      <Space size="middle" wrap>
        <Tag color="success">已填 {result.filled}</Tag>
        {result.unverified ? <Tag color="warning">待确认 {result.unverified}</Tag> : null}
        {result.failed ? <Tag color="error">失败 {result.failed}</Tag> : null}
        <FillRateTag filled={result.filled} total={result.form_control_total} />
      </Space>
      {result.unverified || result.failed ? (
        <ul style={{ marginTop: 8, marginBottom: 0 }}>
          {result.outcomes
            .filter((outcome) => outcome.status === "unverified" || outcome.status === "failed")
            .map((outcome) => (
              <li key={outcome.index}>
                <Typography.Text type="secondary">
                  第 {outcome.index + 1} 个控件：{outcome.detail || outcome.status}
                </Typography.Text>
              </li>
            ))}
        </ul>
      ) : null}
      <Alert
        style={{ marginTop: 12 }}
        type="info"
        showIcon
        title="请回到浏览器窗口核对，确认无误后由你自己点击提交"
      />
    </Card>
  );
}
