// SPDX-License-Identifier: Apache-2.0
/** 开场面板：选主张、定题数与反馈方式。 */
import { Alert, App, Button, Modal, Select, Space, Typography } from "antd";
import EmptyState from "../../components/common/EmptyState";
import PageSkeleton from "../../components/common/PageSkeleton";
import { ThunderboltOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
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

/**
 * 「已确认」是提交给后端的协议值（`listClaims` 的 status 过滤、Claim.verification_status），
 * 不是展示文案——所以不进语言包。
 */
// i18n-ok: 「已确认」是与后端约定的协议值，不是展示文案。
const CONFIRMED_STATUS = "已确认";

export function StartPanel({
  onStarted,
  /** #42：外部受控（台账页就地弹，不再跳页）；不传则维持自带按钮+弹窗。 */
  externalOpen,
  onExternalClose,
  /** #42：台账页当前勾选的主张 id——打开弹窗时预填；未确认的会被过滤掉并计数。 */
  initialClaimIds,
}: {
  onStarted: (session: DrillSession) => void;
  externalOpen?: boolean;
  onExternalClose?: () => void;
  initialClaimIds?: number[];
}) {
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
  // 弹窗开合：外部受控（台账页）与自带按钮两种形态。必须在下面的 effect 之前定义。
  const modalOpen = externalOpen ?? open;

  // #42：拉全量而不只是「已确认」——候选只放已确认的，但要把"勾了却没被带进来"的
  // 未确认条数算出来告诉用户（否则她勾了 3 条、弹窗里只出现 2 条，会以为丢了一条）。
  const claims = useApi<Claim[]>(() => listClaims({}).then((page) => page.items), []);

  useEffect(() => {
    if (!modalOpen) return;
    // 打开弹窗时回查已选岗位并预拉第一页候选（P0-1）。
    void jobSelect.ensure(jobId);
    void jobSelect.reload();
    // hook 的回调引用稳定，只跟随弹窗开关与已选值变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, jobId]);

  // 只有「已确认」的主张能挖——待确认的本来就还没定稿。
  const available = useMemo(
    () => (claims.data ?? []).filter((claim) => claim.verification_status === CONFIRMED_STATUS),
    [claims.data],
  );
  const confirmedIds = useMemo(() => new Set(available.map((claim) => claim.id)), [available]);

  // 预填台账勾选（#42）：只在数据到位后做一次，避免"先清空再填"的闪动。
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!modalOpen) {
      setSeeded(false);
      return;
    }
    if (seeded || !claims.data) return;
    const wanted = initialClaimIds ?? [];
    setClaimIds(wanted.filter((id) => confirmedIds.has(id)));
    setSeeded(true);
  }, [modalOpen, seeded, claims.data, confirmedIds, initialClaimIds]);

  // 「已忽略 N 条」：勾选里不属于「已确认」的那部分（待确认 / 已过期等）。
  const ignoredCount = claims.data
    ? (initialClaimIds ?? []).filter((id) => !confirmedIds.has(id)).length
    : 0;
  const canStart = claimIds.length > 0;

  const start = async () => {
    // 兜底：按钮已 disabled，这里再拦一次——"一条都没选"不该按全部已确认开场。
    if (claimIds.length === 0) return;
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
      closeModal();
      onStarted(outcome.data);
      return;
    }
    if (outcome.status === "error") {
      message.error(errorText(outcome.error, t("drill.startPanel.error.startFailed")));
    }
    // aborted：用户自己按了停止——界面上什么都不用说，弹窗保持打开可再点。
  };

  const closeModal = () => {
    setOpen(false);
    onExternalClose?.();
  };

  return (
    <>
      {externalOpen === undefined ? (
        <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => setOpen(true)}>
          {t("drill.startPanel.action.open")}
        </Button>
      ) : null}
      <Modal
        open={modalOpen}
        title={t("drill.startPanel.title")}
        width={640}
        onCancel={closeModal}
        footer={
          <Space>
            <Button onClick={closeModal}>{t("common.action.cancel")}</Button>
            {busy && <AbortButton onClick={() => startRequest.cancel()} />}
            {/* #42：主按钮写清"这次要挖几条主张、最多几题"，并在一条没选时禁用。 */}
            <Button type="primary" loading={busy} disabled={!canStart} onClick={() => void start()}>
              {t("drill.startPanel.action.start", {
                claims: claimIds.length,
                questions: maxQuestions,
              })}
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
            <Space size={8} wrap>
              <Typography.Text strong>{t("drill.startPanel.claims.label")}</Typography.Text>
              {/* #42：全选快捷入口——一条条勾 20 条主张很烦，数量写在按钮上。 */}
              {available.length > 0 ? (
                <Button
                  size="small"
                  type="link"
                  onClick={() => setClaimIds(available.map((claim) => claim.id))}
                >
                  {t("drill.startPanel.claims.selectAll", { count: available.length })}
                </Button>
              ) : null}
            </Space>
            {/* 一条都没选时说清"要选"，而不是继续提示"留空表示全部"。 */}
            <Typography.Text type={canStart ? "secondary" : "warning"}>
              {canStart ? t("drill.startPanel.claims.hint") : t("drill.startPanel.claims.required")}
            </Typography.Text>
            {/* #42：勾选里被过滤掉的未确认条目——不解释的话用户会以为丢了一条。 */}
            {ignoredCount > 0 ? (
              <Typography.Text type="secondary">
                {" "}
                {t("drill.startPanel.claims.ignored", { count: ignoredCount })}
              </Typography.Text>
            ) : null}
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
          {/* #42：开场要现场生成第一题的评分契约，说清要等多久，用户才不会以为卡住。 */}
          <Typography.Text type="secondary">{t("drill.startPanel.buffer.hint")}</Typography.Text>
        </Space>
      </Modal>
    </>
  );
}
