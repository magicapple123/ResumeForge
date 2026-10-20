// SPDX-License-Identifier: Apache-2.0
/** 批量适配度分析的结果展示层：条件列表、单岗位卡片与整批结果视图。
 *  （自 JobMatchBatchPanel 拆出：面板只管状态机与数据流，展示组件在这里。） */
import { Alert, Card, Listy, Progress, Space, Tag, Typography } from "antd";
import { ListyItem } from "../common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../common/listyPadding";
import {
  ADMISSION_META,
  MATCH_STATUS_META,
  type JobMatchBatchItem,
  type JobMatchBatchOut,
  type MatchCondition,
} from "../../types";

type BatchMatchResult = NonNullable<JobMatchBatchItem["result"]>;

const GROUPS: Array<{
  key: keyof Pick<BatchMatchResult, "hard_conditions" | "core_abilities" | "bonus_items">;
  label: string;
}> = [
  { key: "hard_conditions", label: "硬性条件" },
  { key: "core_abilities", label: "核心能力" },
  { key: "bonus_items", label: "加分项" },
];

function sourceLabel(source: JobMatchBatchItem["analysis_source"]): string {
  if (source === "existing") return "复用已有分析";
  if (source === "local") return "本地降级";
  return "本次新分析";
}

function ConditionList({ conditions }: { conditions: MatchCondition[] }) {
  if (conditions.length === 0) {
    return <Typography.Text type="secondary">暂无条目</Typography.Text>;
  }
  return (
    <Listy
      items={conditions}
      rowKey={(condition) => `${condition.label}|${condition.jd_quote}`}
      styles={{ item: { ...LISTY_ITEM_PADDING_SMALL } }}
      itemRender={(condition) => {
        const meta = MATCH_STATUS_META[condition.status];
        return (
          <ListyItem>
            <Space orientation="vertical" size={2} style={{ width: "100%" }}>
              <Space size={6} wrap>
                <Tag color={meta.color}>{meta.label}</Tag>
                <Typography.Text strong>{condition.label}</Typography.Text>
              </Space>
              {condition.evidence ? (
                <Typography.Text type="secondary">依据：{condition.evidence}</Typography.Text>
              ) : null}
            </Space>
          </ListyItem>
        );
      }}
    />
  );
}

function MatchDetail({ item }: { item: JobMatchBatchItem }) {
  const result = item.result;
  if (!result) return null;
  const admission = ADMISSION_META[result.admission];
  return (
    <Space orientation="vertical" size="small" style={{ width: "100%" }}>
      <Space wrap>
        <Tag color={admission.color}>准入：{admission.label}</Tag>
        <Tag>
          硬性门槛：
          {result.hard_gate === "met" ? "满足" : result.hard_gate === "unmet" ? "未满足" : "待确认"}
        </Tag>
      </Space>
      {GROUPS.map((group) => (
        <section key={group.key}>
          <Typography.Text strong>{group.label}</Typography.Text>
          <ConditionList conditions={result[group.key] ?? []} />
        </section>
      ))}
      {result.advice ? <Typography.Paragraph>{result.advice}</Typography.Paragraph> : null}
      {result.notes.length > 0 ? (
        <Typography.Text type="secondary">说明：{result.notes.join("；")}</Typography.Text>
      ) : null}
    </Space>
  );
}

export function BatchItemCard({ item }: { item: JobMatchBatchItem }) {
  if (item.status === "failed") {
    return (
      <Card size="small" title={`${item.job_title}${item.company ? ` · ${item.company}` : ""}`}>
        <Alert type="error" showIcon title={item.error || "本岗位分析失败"} />
      </Card>
    );
  }

  const score = item.reference_score?.score ?? 0;
  // 参考分颜色分档：≥70 绿（把握较大）、40–69 主题蓝、<40 琥珀（偏弱）。**纯展示口径**——
  // 参考分不参与准入，颜色只是帮视线定位高低，不构成第二套结论。
  const scoreColor = score >= 70 ? "#3f9d63" : score >= 40 ? "#5b8ff9" : "#e6a23c";
  return (
    <Card
      size="small"
      title={
        <Space size={6} wrap>
          <Tag color="blue">第 {item.rank ?? "-"} 名</Tag>
          <span>{item.job_title}</span>
          {item.company ? (
            <Typography.Text type="secondary">· {item.company}</Typography.Text>
          ) : null}
        </Space>
      }
      extra={<Tag>{sourceLabel(item.analysis_source)}</Tag>}
    >
      <div className="batch-score-row">
        <Progress
          type="circle"
          percent={score}
          size={72}
          strokeColor={scoreColor}
          format={(value) => (
            <span className="batch-score-number">
              {value}
              <span className="batch-score-unit">分</span>
            </span>
          )}
        />
        <div className="batch-score-meta">
          <Typography.Text strong>匹配度参考分</Typography.Text>
          {item.result ? (
            <Tag color={ADMISSION_META[item.result.admission].color}>
              准入：{ADMISSION_META[item.result.admission].label}
            </Tag>
          ) : (
            <Tag>暂无结论</Tag>
          )}
          {item.model ? (
            <Typography.Text type="secondary" className="batch-score-model">
              模型：{item.model}
            </Typography.Text>
          ) : null}
        </div>
      </div>
      <CollapselessDetail item={item} />
    </Card>
  );
}

function CollapselessDetail({ item }: { item: JobMatchBatchItem }) {
  // 原 Collapse 在弹层里展开体验一般：详情直接平铺（结果弹卡空间足够）。
  return (
    <div style={{ marginTop: 8 }}>
      <Typography.Text strong type="secondary">
        匹配详情
      </Typography.Text>
      <MatchDetail item={item} />
    </div>
  );
}

export function BatchResultView({ batch }: { batch: JobMatchBatchOut }) {
  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Alert
        type={batch.failed_count > 0 ? "warning" : "success"}
        showIcon
        title={`已完成 ${batch.completed_count} 个岗位，${batch.failed_count} 个岗位失败`}
        description={`结果已保存，可在「历史记录」中回看；已按匹配度参考分从高到低排列。${batch.model ? `本批使用模型：${batch.model}` : "本批未配置模型，使用本地降级结果。"}`}
      />
      {batch.items.length === 0 ? (
        <Typography.Text type="secondary">没有可展示的分析结果</Typography.Text>
      ) : (
        <Listy
          items={batch.items}
          rowKey={(item) => `${batch.id}-${item.job_id}`}
          itemRender={(item) => (
            <ListyItem>
              <div style={{ width: "100%" }}>
                <BatchItemCard item={item} />
              </div>
            </ListyItem>
          )}
        />
      )}
    </Space>
  );
}
