/** 简历风险扫描面板：查重 / 敏感词 / 夸大 / 深挖风险点 / 合规校验。
 *
 * 只展示后端算好的风险点与建议，**绝不自动改写正文**。五类风险按固定顺序分组渲染，
 * 深挖风险点若联动到事实台账，会展示「台账 #{claim_id}」标记。
 */
import { ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Empty,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useMemo, useState } from "react";
import { scanResumeRisks } from "../api/resumeRisk";
import { useApi } from "../hooks/useApi";
import type { RiskCategory, RiskPoint, RiskSeverity } from "../types/resumeRisk";

const CATEGORY_ORDER: { key: RiskCategory; label: string; color: string }[] = [
  { key: "duplicate", label: "查重", color: "default" },
  { key: "sensitive", label: "敏感词", color: "red" },
  { key: "exaggeration", label: "夸大", color: "orange" },
  { key: "deep_dive", label: "深挖风险点", color: "volcano" },
  { key: "compliance", label: "合规校验", color: "magenta" },
];

const SEVERITY: Record<RiskSeverity, { label: string; color: string }> = {
  high: { label: "高", color: "red" },
  medium: { label: "中", color: "orange" },
  low: { label: "低", color: "blue" },
};

interface Props {
  resumeId: number;
}

/** 「AI 增强」偏好的本地存储键：本机单用户工具，不引入服务端设置项。 */
const ENHANCE_STORAGE_KEY = "resumeRisk.remoteEnhancement";

function initialEnhancePreference(): boolean {
  try {
    return window.localStorage.getItem(ENHANCE_STORAGE_KEY) !== "off";
  } catch {
    // 隐私模式等读不到 storage：默认开，与历史行为一致。
    return true;
  }
}

export default function ResumeRiskPanel({ resumeId }: Props) {
  const [enhance, setEnhance] = useState(initialEnhancePreference);
  const { data, loading, error, reload } = useApi(
    () => scanResumeRisks(resumeId, enhance),
    [resumeId, enhance],
  );

  const grouped = useMemo(() => {
    const map = new Map<RiskCategory, RiskPoint[]>();
    for (const point of data?.points ?? []) {
      const list = map.get(point.category) ?? [];
      list.push(point);
      map.set(point.category, list);
    }
    return CATEGORY_ORDER.map((item) => ({ ...item, points: map.get(item.key) ?? [] }));
  }, [data]);

  const total = data?.points.length ?? 0;

  if (loading) return <Spin />;
  if (error) return <Alert type="error" showIcon title={error} />;

  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
      <Space wrap>
        <Typography.Text strong>共 {total} 条风险点</Typography.Text>
        {CATEGORY_ORDER.map((item) => {
          const count = data?.summary?.[item.key] ?? 0;
          if (!count) return null;
          return (
            <Tag key={item.key} color={item.color}>
              {item.label} {count}
            </Tag>
          );
        })}
        {data?.llm_used && <Tag color="geekblue">含模型增强</Tag>}
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void reload()}>
          重新扫描
        </Button>
        {data?.remote_enhancement_available && (
          <Tooltip
            title={
              enhance
                ? "开启时会把你已配置的模型拿来复核简历——只发送遮罩后的正文（姓名/电话/邮箱/公司等已遮蔽），台账只发条数与承担程度这类结构信息，不发送条目原文。关掉后只用本地规则，完全不联网。"
                : "已关闭：只用本地规则，不会向模型发送任何内容。"
            }
          >
            <Space size={4}>
              <Switch
                size="small"
                checked={enhance}
                onChange={(next) => {
                  setEnhance(next);
                  try {
                    window.localStorage.setItem(ENHANCE_STORAGE_KEY, next ? "on" : "off");
                  } catch {
                    // 存不下就只在本次会话生效。
                  }
                }}
                aria-label="AI 增强"
              />
              <Typography.Text type="secondary">AI 增强</Typography.Text>
            </Space>
          </Tooltip>
        )}
      </Space>

      {data?.notes?.map((note) => (
        <Alert key={note} type="warning" showIcon title={note} />
      ))}

      {total === 0 ? (
        <Empty description="未发现明显风险点" />
      ) : (
        grouped.map((group) =>
          group.points.length === 0 ? null : (
            <Card
              key={group.key}
              size="small"
              title={
                <Space>
                  <Typography.Text strong>{group.label}</Typography.Text>
                  <Tag color={group.color}>{group.points.length}</Tag>
                </Space>
              }
            >
              <Space orientation="vertical" style={{ width: "100%" }} size="small">
                {group.points.map((point, index) => (
                  <RiskPointItem key={index} point={point} />
                ))}
              </Space>
            </Card>
          ),
        )
      )}
    </Space>
  );
}

function RiskPointItem({ point }: { point: RiskPoint }) {
  const severity = SEVERITY[point.severity] ?? SEVERITY.medium;
  return (
    <div
      style={{ borderTop: "1px solid #f0f0f0", paddingTop: 8 }}
      data-risk-category={point.category}
    >
      <Space size="small" wrap>
        <Tag color={severity.color}>{severity.label}</Tag>
        {point.location && <Typography.Text type="secondary">{point.location}</Typography.Text>}
        {point.claim_id != null && <Tag>事实台账 #{point.claim_id}</Tag>}
      </Space>
      {point.text && (
        <Typography.Paragraph style={{ margin: "8px 0 4px" }} code>
          {point.text}
        </Typography.Paragraph>
      )}
      {point.suggestion && (
        <Typography.Paragraph style={{ margin: "4px 0" }}>
          <Typography.Text type="success">建议：</Typography.Text>
          {point.suggestion}
        </Typography.Paragraph>
      )}
      {point.follow_up.length > 0 && (
        <Collapse
          size="small"
          ghost
          items={[
            {
              key: "follow-up",
              label: `追问准备（${point.follow_up.length}）`,
              children: (
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {point.follow_up.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
