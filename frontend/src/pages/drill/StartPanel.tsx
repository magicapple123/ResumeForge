// SPDX-License-Identifier: Apache-2.0
/** 开场面板：选主张、定题数与反馈方式。 */
import { Alert, App, Button, Modal, Select, Space, Typography } from "antd";
import EmptyState from "../../components/common/EmptyState";
import PageSkeleton from "../../components/common/PageSkeleton";
import { ThunderboltOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { createDrillSession } from "../../api/drill";
import { listClaims } from "../../api/claims";
import AbortButton from "../../components/common/AbortButton";
import { errorText, useAbortableRequest } from "../../hooks/useAbortableRequest";
import { useApi } from "../../hooks/useApi";
import { useJobSearchSelect } from "../../hooks/remoteSearchOptions";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { Claim, DrillSession, FeedbackPolicy } from "../../types";
import { DRILL_QUESTION_OPTIONS } from "../../types";

/**
 * 反馈策略是协议值，展示名在语言包里。`types/drill.ts` 的 `FEEDBACK_LABELS` 还有别的消费者，
 * 所以映射放在这里（协议值 → MessageKey），不改类型层。
 */
const FEEDBACK_LABEL_KEYS: Record<FeedbackPolicy, MessageKey> = {
  deferred: "drill.startPanel.feedback.deferred",
  immediate: "drill.startPanel.feedback.immediate",
};

export function StartPanel({ onStarted }: { onStarted: (session: DrillSession) => void }) {
  // 本组件用模块级 t()，必须订阅语言变化，否则切语言后弹窗里的文案不跟着变。
  useLocale();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [claimIds, setClaimIds] = useState<number[]>([]);
  const [jobId, setJobId] = useState<number | null>(null);
  const [maxQuestions, setMaxQuestions] = useState(6);
  const [policy, setPolicy] = useState<FeedbackPolicy>("deferred");
  // 开场也要现场调大模型（第一题的评分契约在这一步定下来）：等着的时候可以停。
  const startRequest = useAbortableRequest();
  const busy = startRequest.loading;
  // 关联岗位下拉改为远程搜索（P0-1）：不再预拉"前 100 条"当全量。
  const jobSelect = useJobSearchSelect();

  // 只有「已确认」的主张能挖——待确认的本来就还没定稿。
  // i18n-ok: 「已确认」是提交给后端的协议值（listClaims 的 status 过滤），不是展示文案。
  const claims = useApi<Claim[]>(
    () => listClaims({ status: "已确认" }).then((page) => page.items),
    [],
  );

  useEffect(() => {
    if (!open) return;
    // 打开弹窗时回查已选岗位并预拉第一页候选（P0-1）。
    void jobSelect.ensure(jobId);
    void jobSelect.reload();
    // hook 的回调引用稳定，只跟随弹窗开关与已选值变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, jobId]);

  const available = claims.data ?? [];

  const start = async () => {
    const outcome = await startRequest.run((signal) =>
      createDrillSession(
        {
          claim_ids: claimIds,
          job_id: jobId,
          max_questions: maxQuestions,
          feedback_policy: policy,
        },
        signal,
      ),
    );
    if (outcome.status === "ok") {
      message.success(t("drill.startPanel.toast.started"));
      setOpen(false);
      onStarted(outcome.data);
      return;
    }
    if (outcome.status === "error") {
      message.error(errorText(outcome.error, t("drill.startPanel.error.startFailed")));
    }
    // aborted：用户自己按了停止——界面上什么都不用说，弹窗保持打开可再点。
  };

  return (
    <>
      <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => setOpen(true)}>
        {t("drill.startPanel.action.open")}
      </Button>
      <Modal
        open={open}
        title={t("drill.startPanel.title")}
        width={640}
        onCancel={() => setOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setOpen(false)}>{t("common.action.cancel")}</Button>
            {busy && <AbortButton onClick={() => startRequest.cancel()} />}
            <Button type="primary" loading={busy} onClick={() => void start()}>
              {t("drill.startPanel.action.start")}
            </Button>
          </Space>
        }
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            title={t("drill.startPanel.intro.title")}
            description={t("drill.startPanel.intro.description")}
          />
          <div>
            <Typography.Text strong>{t("drill.startPanel.claims.label")}</Typography.Text>
            <Typography.Text type="secondary">{t("drill.startPanel.claims.hint")}</Typography.Text>
            {claims.loading ? (
              <PageSkeleton rows={2} card={false} />
            ) : available.length === 0 ? (
              <EmptyState inline description={t("drill.startPanel.claims.empty")} />
            ) : (
              <Select
                mode="multiple"
                allowClear
                style={{ width: "100%", marginTop: 6 }}
                placeholder={t("drill.startPanel.claims.placeholder")}
                value={claimIds}
                onChange={setClaimIds}
                options={available.map((claim) => ({
                  value: claim.id,
                  label: t("drill.startPanel.claims.option", {
                    title: claim.title || claim.subject,
                    level: claim.responsibility_level,
                  }),
                }))}
              />
            )}
          </div>
          <Space size={12} wrap>
            <div>
              <Typography.Text strong>{t("drill.startPanel.maxQuestions.label")}</Typography.Text>
              <Select
                style={{ width: 120, marginLeft: 8 }}
                value={maxQuestions}
                onChange={setMaxQuestions}
                options={DRILL_QUESTION_OPTIONS.map((value) => ({
                  value,
                  label: t("drill.startPanel.maxQuestions.option", { count: value }),
                }))}
              />
            </div>
            <div>
              <Typography.Text strong>{t("drill.startPanel.feedback.label")}</Typography.Text>
              <Select
                style={{ width: 240, marginLeft: 8 }}
                value={policy}
                onChange={setPolicy}
                options={(["deferred", "immediate"] as FeedbackPolicy[]).map((value) => ({
                  value,
                  label: t(FEEDBACK_LABEL_KEYS[value]),
                }))}
              />
            </div>
          </Space>
          <div>
            <Typography.Text strong>{t("drill.startPanel.job.label")}</Typography.Text>
            <Typography.Text type="secondary">{t("drill.startPanel.job.hint")}</Typography.Text>
            <Select
              allowClear
              style={{ width: "100%", marginTop: 6 }}
              placeholder={t("drill.startPanel.job.placeholder")}
              value={jobId}
              onChange={setJobId}
              {...jobSelect.selectProps}
            />
          </div>
        </Space>
      </Modal>
    </>
  );
}
