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
import { t, type MessageKey } from "../../i18n";
import { ADMISSION_LABEL_KEYS, MATCH_STATUS_LABEL_KEYS } from "../../i18n/enum/apply";
import { useLocale } from "../../i18n/i18nContext";

type BatchMatchResult = NonNullable<JobMatchBatchItem["result"]>;

const GROUPS: Array<{
  key: keyof Pick<BatchMatchResult, "hard_conditions" | "core_abilities" | "bonus_items">;
  labelKey: MessageKey;
}> = [
  { key: "hard_conditions", labelKey: "jobMatchBatchResult.group.hardConditions" },
  { key: "core_abilities", labelKey: "jobMatchBatchResult.group.coreAbilities" },
  { key: "bonus_items", labelKey: "jobMatchBatchResult.group.bonusItems" },
];

/** 分析来源对应的文案 key；渲染处再 `t()`，模块作用域不求值文案。 */
function sourceLabel(source: JobMatchBatchItem["analysis_source"]): MessageKey {
  if (source === "existing") return "jobMatchBatchResult.source.existing";
  if (source === "local") return "jobMatchBatchResult.source.local";
  return "jobMatchBatchResult.source.new";
}

function ConditionList({ conditions }: { conditions: MatchCondition[] }) {
  useLocale();
  if (conditions.length === 0) {
    return (
      <Typography.Text type="secondary">{t("jobMatchBatchResult.condition.empty")}</Typography.Text>
    );
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
                <Tag color={meta.color}>{t(MATCH_STATUS_LABEL_KEYS[condition.status])}</Tag>
                <Typography.Text strong>{condition.label}</Typography.Text>
              </Space>
              {condition.evidence ? (
                <Typography.Text type="secondary">
                  {t("jobMatchBatchResult.condition.evidence", { evidence: condition.evidence })}
                </Typography.Text>
              ) : null}
            </Space>
          </ListyItem>
        );
      }}
    />
  );
}

function MatchDetail({ item }: { item: JobMatchBatchItem }) {
  useLocale();
  const result = item.result;
  if (!result) return null;
  const admission = ADMISSION_META[result.admission];
  return (
    <Space orientation="vertical" size="small" style={{ width: "100%" }}>
      <Space wrap>
        <Tag color={admission.color}>
          {t("jobMatchBatchResult.admission.tag", {
            label: t(ADMISSION_LABEL_KEYS[result.admission]),
          })}
        </Tag>
        <Tag>
          {t("jobMatchBatchResult.hardGate.field", {
            state:
              result.hard_gate === "met"
                ? t("jobMatchBatchResult.hardGate.met")
                : result.hard_gate === "unmet"
                  ? t("jobMatchBatchResult.hardGate.unmet")
                  : t("jobMatchBatchResult.hardGate.unknown"),
          })}
        </Tag>
      </Space>
      {GROUPS.map((group) => (
        <section key={group.key}>
          <Typography.Text strong>{t(group.labelKey)}</Typography.Text>
          <ConditionList conditions={result[group.key] ?? []} />
        </section>
      ))}
      {result.advice ? <Typography.Paragraph>{result.advice}</Typography.Paragraph> : null}
      {result.notes.length > 0 ? (
        <Typography.Text type="secondary">
          {t("jobMatchBatchResult.notes.field", {
            notes: result.notes.join(t("jobMatchBatchResult.separator.notes")),
          })}
        </Typography.Text>
      ) : null}
    </Space>
  );
}

export function BatchItemCard({ item }: { item: JobMatchBatchItem }) {
  useLocale();
  if (item.status === "failed") {
    return (
      <Card size="small" title={`${item.job_title}${item.company ? ` · ${item.company}` : ""}`}>
        <Alert
          type="error"
          showIcon
          title={item.error || t("jobMatchBatchResult.error.itemFailed")}
        />
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
          <Tag color="blue">{t("jobMatchBatchResult.card.rank", { rank: item.rank ?? "-" })}</Tag>
          <span>{item.job_title}</span>
          {item.company ? (
            <Typography.Text type="secondary">· {item.company}</Typography.Text>
          ) : null}
        </Space>
      }
      extra={<Tag>{t(sourceLabel(item.analysis_source))}</Tag>}
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
              <span className="batch-score-unit">{t("jobMatchBatchResult.score.unit")}</span>
            </span>
          )}
        />
        <div className="batch-score-meta">
          <Typography.Text strong>{t("jobMatchBatchResult.score.label")}</Typography.Text>
          {item.result ? (
            <Tag color={ADMISSION_META[item.result.admission].color}>
              {t("jobMatchBatchResult.admission.tag", {
                label: t(ADMISSION_LABEL_KEYS[item.result.admission]),
              })}
            </Tag>
          ) : (
            <Tag>{t("jobMatchBatchResult.verdict.none")}</Tag>
          )}
          {item.model ? (
            <Typography.Text type="secondary" className="batch-score-model">
              {t("jobMatchBatchResult.model.field", { model: item.model })}
            </Typography.Text>
          ) : null}
        </div>
      </div>
      <CollapselessDetail item={item} />
    </Card>
  );
}

function CollapselessDetail({ item }: { item: JobMatchBatchItem }) {
  useLocale();
  // 原 Collapse 在弹层里展开体验一般：详情直接平铺（结果弹卡空间足够）。
  return (
    <div style={{ marginTop: 8 }}>
      <Typography.Text strong type="secondary">
        {t("jobMatchBatchResult.detail.title")}
      </Typography.Text>
      <MatchDetail item={item} />
    </div>
  );
}

export function BatchResultView({ batch }: { batch: JobMatchBatchOut }) {
  useLocale();
  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Alert
        type={batch.failed_count > 0 ? "warning" : "success"}
        showIcon
        title={t("jobMatchBatchResult.summary.title", {
          completed: batch.completed_count,
          failed: batch.failed_count,
        })}
        description={`${t("jobMatchBatchResult.summary.description")}${
          batch.model
            ? t("jobMatchBatchResult.summary.modelUsed", { model: batch.model })
            : t("jobMatchBatchResult.summary.modelMissing")
        }`}
      />
      {batch.items.length === 0 ? (
        <Typography.Text type="secondary">{t("jobMatchBatchResult.empty.results")}</Typography.Text>
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
