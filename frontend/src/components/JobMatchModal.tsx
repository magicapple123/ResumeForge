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
import {
  BulbOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  ReloadOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Descriptions, Modal, Progress, Space, Tag, Typography } from "antd";
import EmptyState from "./common/EmptyState";
import PageSkeleton from "./common/PageSkeleton";
import { useCallback, useEffect, useRef, useState } from "react";
import { createAiTask } from "../api/aiTasks";
import { deleteJobMatch, getJobMatch } from "../api/jobs";
import { useBackgroundTasks } from "../hooks/useBackgroundTasks";
import { beginMatchAnalysis, endMatchAnalysis } from "../utils/jobMatchAnalysisState";
import {
  attachTaskUi,
  backgroundTaskKey,
  cancelBackgroundTask,
  watchAiTask,
} from "../utils/backgroundTasks";
import {
  ADMISSION_META,
  MATCH_STATUS_META,
  type HardGateResult,
  type Job,
  type JobMatchOut,
  type MatchCondition,
  type MatchScoreDimension,
} from "../types";
import { t, type MessageKey } from "../i18n";
import {
  ADMISSION_LABEL_KEYS,
  MATCH_STATUS_LABEL_KEYS,
  matchScoreDimensionKey,
} from "../i18n/enum/apply";
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

/**
 * 参考分分项的展示名：按后端稳定的 `key` 查语言包。
 *
 * `label` 是后端下发的中文展示名（`MATCH_SCORE_DIMENSIONS`），英文界面下会露中文；
 * 后端新增分项时表里查不到，回退它下发的原文——不显示 key，也不留空。
 */
function dimensionLabel(dimension: MatchScoreDimension): string {
  const labelKey = matchScoreDimensionKey(dimension.key);
  return labelKey ? t(labelKey) : dimension.label;
}

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
              <Tag color={meta.color}>{t(MATCH_STATUS_LABEL_KEYS[condition.status])}</Tag>
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
  /** 建任务请求还在飞（真正的"进行中"由登记表里那条任务说了算）。 */
  const [starting, setStarting] = useState(false);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const version = useRef(0);
  const lastJobId = useRef<number | null>(null);

  // 任务状态来自**统一登记表**（`utils/backgroundTasks`），不是本组件的 useState：
  // 关掉弹窗后轮询仍在，页头任务面板也能看到并取消同一个任务。
  const tracked = useBackgroundTasks();
  const taskKey = taskId === null ? null : backgroundTaskKey("job_match", taskId);
  const activeTask = taskKey === null ? undefined : tracked.find((item) => item.key === taskKey);
  const analyzing = starting || activeTask !== undefined;

  useEffect(() => {
    if (!job || lastJobId.current === job.id) return;
    lastJobId.current = job.id;
    version.current += 1;
    setData(null);
    setError("");
    setLoading(false);
    // 换岗位 = 换任务：旧任务的进度不该显示在新岗位上（旧任务仍在后台跑完并提醒）。
    setTaskId(null);
  }, [job]);

  useEffect(() => {
    if (taskKey === null) return undefined;
    // 弹窗开着时声明"界面在看这个任务"：完成时用右上角卡片，不弹居中弹窗打断用户。
    return attachTaskUi(taskKey);
  }, [taskKey]);

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

  // 离开弹窗 = 任务继续在后台跑（不是取消）；列表里的"分析中"标志由登记表兜底清掉。
  useEffect(() => {
    return () => {
      if (lastJobId.current !== null) endMatchAnalysis(lastJobId.current);
    };
  }, []);

  /**
   * 发起一次分析：**建任务**就返回，不在请求里等模型。
   *
   * 为什么必须这样：改动前这里直接 `await generateJobMatch()`，那条 HTTP 连接就是任务的
   * 生命线——用户关掉弹窗、切页或刷新，连接一断前端就再也拿不到结果，而**后端仍会把
   * token 烧完**（该端点曾经是 sync def，跑在线程池里，客户端断开对它毫无影响）。
   * 现在任务由后端后台线程跑，前端只轮询状态，关掉窗口真的不影响结果。
   */
  const analyze = async () => {
    if (!job) return;
    const jobId = job.id;
    const label = t("jobMatch.task.label", { job: job.title });
    setError("");
    setStarting(true);
    beginMatchAnalysis(jobId);
    try {
      const created = await createAiTask({
        kind: "job_match",
        payload: { job_id: jobId, force: data != null && data.id > 0 },
        label,
      });
      setTaskId(created.id);
      // 完成提醒（弹窗 + 提示音 + 「查看岗位」深链）由登记表统一发：只有它知道用户
      // 是"还在看弹窗"还是"已经走开了"。
      watchAiTask(created, label, (finished) => {
        setTaskId(null);
        endMatchAnalysis(jobId);
        if (finished.status === "completed") {
          void load();
          return;
        }
        if (finished.status === "failed") {
          setError(finished.error || t("jobMatch.error.analyze"));
        }
        // cancelled：用户自己按的取消，回到"未分析"即可，不再报一个错。
      });
    } catch (createError) {
      endMatchAnalysis(jobId);
      setError(createError instanceof Error ? createError.message : t("jobMatch.error.analyze"));
    } finally {
      setStarting(false);
    }
  };

  const cancelAnalyze = async () => {
    if (taskKey === null) return;
    try {
      // 登记表 → 适配器 → `POST /ai-tasks/{id}/cancel`：后端会真的停下执行体。
      await cancelBackgroundTask(taskKey);
    } catch (cancelError) {
      message.error(
        cancelError instanceof Error ? cancelError.message : t("jobMatch.error.cancelFailed"),
      );
    }
  };

  const clear = async () => {
    if (!job) return;
    setStarting(true);
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
      setStarting(false);
    }
  };

  const hasResult = data != null && data.id > 0;
  const result = hasResult ? data.result : null;
  const admissionMeta = result ? ADMISSION_META[result.admission] : null;
  const admissionLabelKey = result ? ADMISSION_LABEL_KEYS[result.admission] : null;
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
      onCancel={onClose}
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
          title={
            activeTask?.progressPercent != null
              ? t("jobMatch.hint.progress", { percent: activeTask.progressPercent })
              : t("jobMatch.hint.starting")
          }
          description={t("jobMatch.hint.background")}
          // 关掉弹窗不等于取消；要停下就按这颗：它会让后端真的停止模型调用。
          action={
            taskKey === null ? null : (
              <Button
                size="small"
                danger
                icon={<CloseCircleOutlined />}
                onClick={() => void cancelAnalyze()}
              >
                {t("jobMatch.action.cancel")}
              </Button>
            )
          }
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
                {admissionMeta && admissionLabelKey && (
                  <Tag color={admissionMeta.color}>{t(admissionLabelKey)}</Tag>
                )}
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
                        <span className="job-match-score-label">{dimensionLabel(dimension)}</span>
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
