// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位匹配度分析弹窗：把 JD 与**你已确认的资料 / 简历**逐条对照。
 *
 * 与「岗位需求解读」并列但性质不同——解读只读招聘原文（"这岗位要什么"），
 * 这里会读取个人资料与简历（"我够不够"），所以标题与说明都明确写出这一区别。
 *
 * 三条硬约束（设计 §9）：
 * - **五类结论本身不渲染任何百分比 / 评分**——模型给出的判断只有"到没到"这一层，
 *   给它配一个数字会让人以为存在一个客观分数；
 * - 准入结论只读后端返回的 `admission`，前端不自行再判一次；
 * - 证据不足的条目如实写"资料中未提供"，不替模型补事实。
 *
 * **与「匹配度参考分」的区别（别把两者混起来）**：参考分是后端用**纯本地规则**现算的
 * 派生值（技能覆盖 / 年限 / 项目相关度 / 硬性门槛 / JD 关键词覆盖五个分项加权），
 * **不调用模型、不落库、也不参与投递准入**，并且**强制展示后端下发的免责文案**。
 * 它放在五类结论**之后**作为补充，且不给分数配"好/差"的颜色分级——后端没有定义档位，
 * 前端自己划一条线就是在编造一个判断。
 */
import { BulbOutlined, DeleteOutlined, ReloadOutlined, RobotOutlined } from "@ant-design/icons";
import { Alert, App, Button, Descriptions, Modal, Progress, Space, Tag, Typography } from "antd";
import EmptyState from "./common/EmptyState";
import PageSkeleton from "./common/PageSkeleton";
import { useCallback, useEffect, useRef, useState } from "react";
import { deleteJobMatch, generateJobMatch, getJobMatch } from "../api/jobs";
import { notifyTaskDone } from "../utils/taskNotify";
import { beginMatchAnalysis, endMatchAnalysis } from "../utils/jobMatchAnalysisState";
import {
  ADMISSION_META,
  MATCH_STATUS_META,
  type HardGateResult,
  type Job,
  type JobMatchOut,
  type MatchCondition,
} from "../types";
import { t, type MessageKey } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

interface Props {
  job: Job | null;
  onClose: () => void;
}

const HARD_GATE_LABELS: Record<HardGateResult, { labelKey: MessageKey; color: string }> = {
  met: { labelKey: "jobMatch.hardGate.met", color: "green" },
  unmet: { labelKey: "jobMatch.hardGate.unmet", color: "red" },
  unknown: { labelKey: "jobMatch.hardGate.unknown", color: "gold" },
};

const GROUPS: {
  key: keyof Pick<JobMatchOut["result"], "hard_conditions" | "core_abilities" | "bonus_items">;
  titleKey: MessageKey;
}[] = [
  { key: "hard_conditions", titleKey: "jobMatch.group.hardConditions" },
  { key: "core_abilities", titleKey: "jobMatch.group.coreAbilities" },
  { key: "bonus_items", titleKey: "jobMatch.group.bonusItems" },
];

function ConditionList({ conditions }: { conditions: MatchCondition[] }) {
  useLocale();
  if (conditions.length === 0) {
    return <EmptyState inline description={t("jobMatch.empty.none")} />;
  }
  return (
    <ul className="job-match-conditions">
      {conditions.map((condition, index) => {
        const meta = MATCH_STATUS_META[condition.status];
        return (
          <li key={`${condition.label}-${index}`} className="job-match-condition">
            <Space wrap size={8}>
              <Tag color={meta.color}>{meta.label}</Tag>
              <Typography.Text strong>{condition.label}</Typography.Text>
            </Space>
            {condition.jd_quote && (
              <Typography.Paragraph type="secondary" className="job-match-quote">
                {t("jobMatch.condition.jdQuote", { quote: condition.jd_quote })}
              </Typography.Paragraph>
            )}
            <Typography.Paragraph className="job-match-evidence">
              {t("jobMatch.condition.evidence", {
                evidence: condition.evidence || t("jobMatch.condition.evidenceMissing"),
              })}
            </Typography.Paragraph>
          </li>
        );
      })}
    </ul>
  );
}

export default function JobMatchModal({ job, onClose }: Props) {
  useLocale();
  const { message } = App.useApp();
  const [data, setData] = useState<JobMatchOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const version = useRef(0);
  const lastJobId = useRef<number | null>(null);

  useEffect(() => {
    if (!job || lastJobId.current === job.id) return;
    lastJobId.current = job.id;
    version.current += 1;
    setData(null);
    setError("");
    setLoading(false);
  }, [job]);

  const load = useCallback(async () => {
    if (!job) return;
    const current = ++version.current;
    setLoading(true);
    setError("");
    try {
      const result = await getJobMatch(job.id);
      if (current === version.current) setData(result);
    } catch (loadError) {
      if (current === version.current) {
        setError(loadError instanceof Error ? loadError.message : t("jobMatch.error.load"));
      }
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, [job]);

  // 打开弹窗即拉取匹配分析：与 load 的 loading 置位耦合。按"派生事件"书面
  // 理由豁免 Compiler 规则。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (job) void load();
  }, [job, load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 用户在分析过程中关掉了弹窗：请求照跑。人已经走了之后不再 setState（组件可能已卸载），
  // 完成时改走全局通知；同时全局登记表让岗位列表 / 详情抽屉显示「分析中」标志。
  const leftWhileAnalyzing = useRef(false);

  const handleCancel = () => {
    if (analyzing) leftWhileAnalyzing.current = true;
    onClose();
  };

  const analyze = async () => {
    if (!job) return;
    const jobId = job.id;
    setAnalyzing(true);
    setError("");
    leftWhileAnalyzing.current = false;
    beginMatchAnalysis(jobId);
    try {
      await generateJobMatch(jobId, data != null && data.id > 0);
      // 无论人是否还在弹窗前，完成都走统一出口（通知卡片 + 提醒声）——
      // 用户反馈过"生成完了没有任何提醒"。区别只在文案指路。
      notifyTaskDone({
        title: t("jobMatch.toast.doneTitle"),
        description: leftWhileAnalyzing.current
          ? t("jobMatch.toast.doneInDetail")
          : t("jobMatch.toast.doneHere"),
      });
      if (leftWhileAnalyzing.current) return;
      await load();
    } catch (analyzeError) {
      const detail =
        analyzeError instanceof Error ? analyzeError.message : t("jobMatch.error.analyze");
      notifyTaskDone({
        kind: "error",
        title: t("jobMatch.error.title"),
        description: leftWhileAnalyzing.current
          ? `${detail}${t("jobMatch.error.retryHint")}`
          : detail,
      });
      if (leftWhileAnalyzing.current) return;
      setError(detail);
    } finally {
      endMatchAnalysis(jobId);
      if (!leftWhileAnalyzing.current) setAnalyzing(false);
    }
  };

  const clear = async () => {
    if (!job) return;
    setAnalyzing(true);
    try {
      await deleteJobMatch(job.id);
      message.success(t("jobMatch.toast.cleared"));
      setData(null);
      await load();
    } catch (clearError) {
      message.error(
        clearError instanceof Error ? clearError.message : t("jobMatch.error.clearFailed"),
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const hasResult = data != null && data.id > 0;
  const result = hasResult ? data.result : null;
  const admissionMeta = result ? ADMISSION_META[result.admission] : null;
  const hardGateMeta = result ? HARD_GATE_LABELS[result.hard_gate] : null;

  return (
    <Modal
      title={
        <Space orientation="vertical" size={0}>
          <Space>
            <RobotOutlined />
            {t("jobMatch.page.title")}
          </Space>
          <Typography.Text type="secondary" className="job-match-subtitle">
            {t("jobMatch.page.subtitle")}
          </Typography.Text>
        </Space>
      }
      open={!!job}
      onCancel={handleCancel}
      footer={null}
      width={760}
      // 匹配分析逐条输出，条数不固定：限高让超长内容只滚弹窗内部。
      styles={{
        body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto", overflowX: "hidden" },
      }}
      destroyOnHidden
    >
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          style={{ marginBottom: 12 }}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>
              {t("jobMatch.action.retry")}
            </Button>
          }
        />
      )}

      {analyzing ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title={t("jobMatch.hint.background")}
        />
      ) : null}

      {loading && !data ? (
        <PageSkeleton rows={8} card={false} />
      ) : !hasResult ? (
        <Space orientation="vertical" style={{ width: "100%" }} size={12}>
          <EmptyState inline description={t("jobMatch.empty")} />
          <Typography.Paragraph type="secondary">{t("jobMatch.intro")}</Typography.Paragraph>
          <Button
            type="primary"
            icon={<BulbOutlined />}
            loading={analyzing}
            onClick={() => void analyze()}
          >
            {t("jobMatch.action.start")}
          </Button>
        </Space>
      ) : (
        result && (
          <div className="job-match-content">
            <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
              <Descriptions.Item label={t("jobMatch.field.job")}>
                {data.company ? `${data.company} · ` : ""}
                {data.job_title}
              </Descriptions.Item>
              <Descriptions.Item label={t("jobMatch.field.model")}>
                {data.model || t("jobMatch.model.local")}
              </Descriptions.Item>
              <Descriptions.Item label={t("jobMatch.field.verdict")}>
                {admissionMeta && <Tag color={admissionMeta.color}>{admissionMeta.label}</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label={t("jobMatch.field.hardGate")}>
                {hardGateMeta && <Tag color={hardGateMeta.color}>{t(hardGateMeta.labelKey)}</Tag>}
              </Descriptions.Item>
            </Descriptions>

            {result.admission === "block" && (
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 12 }}
                title={t("jobMatch.warning.gaps")}
              />
            )}
            {result.admission === "needs_confirm" && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                title={t("jobMatch.warning.unknown")}
              />
            )}

            {GROUPS.map((group) => (
              <section key={group.key} className="job-match-group">
                <Typography.Title level={5}>{t(group.titleKey)}</Typography.Title>
                <ConditionList conditions={result[group.key]} />
              </section>
            ))}

            {result.advice && (
              <>
                <Typography.Title level={5}>{t("jobMatch.section.advice")}</Typography.Title>
                <Typography.Paragraph>{result.advice}</Typography.Paragraph>
              </>
            )}

            {/* 参考分放在五类结论**之后**：它只是补充感知"差多少"，不能盖过准入结论。
                分数用单一色相画（不按高低变色）：后端没有定义档位，前端自己划"好/差"的线
                就是在编造一个它没有的判断。 */}
            {data.reference_score && (
              <section className="job-match-score">
                <Typography.Title level={5}>{t("jobMatch.section.score")}</Typography.Title>
                <div className="job-match-score-head">
                  <Progress
                    type="circle"
                    size={72}
                    percent={data.reference_score.score}
                    format={(value) => <span className="job-match-score-value">{value}</span>}
                  />
                  <Typography.Paragraph type="secondary" className="job-match-score-disclaimer">
                    {data.reference_score.disclaimer}
                  </Typography.Paragraph>
                </div>
                <ul className="job-match-score-dimensions">
                  {data.reference_score.dimensions.map((dimension) => (
                    <li key={dimension.key}>
                      <div className="job-match-score-line">
                        <span className="job-match-score-label">{dimension.label}</span>
                        <Progress percent={dimension.score} showInfo={false} size="small" />
                        <span className="job-match-score-value">{dimension.score}</span>
                      </div>
                      {dimension.evidence && (
                        <Typography.Text type="secondary">{dimension.evidence}</Typography.Text>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {result.notes.length > 0 && (
              <>
                <Typography.Title level={5}>{t("jobMatch.section.scope")}</Typography.Title>
                <ul className="job-match-notes">
                  {result.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </>
            )}

            <Space wrap style={{ marginTop: 12 }}>
              <Button icon={<ReloadOutlined />} loading={analyzing} onClick={() => void analyze()}>
                {t("jobMatch.action.reanalyze")}
              </Button>
              <Button
                danger
                icon={<DeleteOutlined />}
                loading={analyzing}
                onClick={() => void clear()}
              >
                {t("jobMatch.action.clear")}
              </Button>
            </Space>
          </div>
        )
      )}
    </Modal>
  );
}
