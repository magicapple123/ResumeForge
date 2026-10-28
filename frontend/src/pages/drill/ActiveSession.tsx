// SPDX-License-Identifier: Apache-2.0
/** 进行中的会话：当前这一问、契约、逐轮记录。 */
import { Alert, App, Button, Card, Input, Listy, Popconfirm, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { answerDrill, finishDrill } from "../../api/drill";
import AbortButton from "../../components/common/AbortButton";
import { ListyItem } from "../../components/common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../../components/common/listyPadding";
import { errorText, useAbortableRequest } from "../../hooks/useAbortableRequest";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { DrillSession, EvidenceStatus } from "../../types";
import { EVIDENCE_LABEL_KEYS, FOLLOWUP_LABEL_KEYS } from "./drillLabels";
import { evidenceTag } from "./evidenceTag";

/**
 * 追问方向是后端给的自由字符串（类型上是 `string`），不在已知表里就返回空串——
 * 不认识的取值宁可不显示。
 */
function followupKindLabel(kind: string): string {
  return kind in FOLLOWUP_LABEL_KEYS
    ? t(FOLLOWUP_LABEL_KEYS[kind as keyof typeof FOLLOWUP_LABEL_KEYS])
    : "";
}

export function ActiveSession({
  session,
  onUpdate,
}: {
  session: DrillSession;
  onUpdate: (session: DrillSession) => void;
}) {
  // 本组件用模块级 t()，必须订阅语言变化，否则切语言后判定标签与文案不跟着变。
  useLocale();
  const { message } = App.useApp();
  const [answer, setAnswer] = useState("");
  // 判定与「提前结束出复盘」各是一条长调用，都能单独停。
  const answerRequest = useAbortableRequest();
  const finishRequest = useAbortableRequest();
  const busy = answerRequest.loading || finishRequest.loading;
  const [lastVerdict, setLastVerdict] = useState<{
    status: EvidenceStatus;
    missing: string[];
    contradictions: string[];
    feedback: string;
  } | null>(null);

  const pending = session.pending;
  const deferred = session.feedback_policy === "deferred";

  const submit = async () => {
    if (!answer.trim()) {
      message.warning(t("drillSession.answerRequired"));
      return;
    }
    const outcome = await answerRequest.run((signal) =>
      answerDrill(session.id, answer.trim(), signal),
    );
    if (outcome.status === "error") {
      message.error(errorText(outcome.error, t("drillSession.submitFailed")));
      return;
    }
    // 停止/取消：输入框里的答案**保留**（用户还能接着提交），上一次的判定也不动。
    if (outcome.status === "aborted") return;
    setAnswer("");
    setLastVerdict({
      status: outcome.data.status,
      missing: outcome.data.missing,
      contradictions: outcome.data.contradictions,
      feedback: outcome.data.feedback,
    });
    onUpdate(outcome.data.session);
    if (outcome.data.finished) message.success(t("drillSession.finishedScan"));
  };

  const stop = async () => {
    const outcome = await finishRequest.run((signal) => finishDrill(session.id, signal));
    if (outcome.status === "error") {
      message.error(errorText(outcome.error, t("drillSession.stopFailed")));
      return;
    }
    if (outcome.status === "aborted") return;
    onUpdate(outcome.data);
    message.success(t("drillSession.stoppedScan"));
  };

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      {lastVerdict && (
        <Alert
          type={
            lastVerdict.status === "verified"
              ? "success"
              : lastVerdict.status === "contradictory"
                ? "error"
                : "warning"
          }
          showIcon
          title={t("drillSession.lastVerdict", {
            label: t(EVIDENCE_LABEL_KEYS[lastVerdict.status]),
          })}
          description={
            <Space orientation="vertical" size={2}>
              {/* 真实模拟模式下不展示"还缺什么"——那等于把判分标准念出来。 */}
              {deferred && lastVerdict.feedback === "" ? (
                <Typography.Text type="secondary">
                  {t("drillSession.deferredNotice")}
                </Typography.Text>
              ) : (
                <>
                  {lastVerdict.feedback && <span>{lastVerdict.feedback}</span>}
                  {lastVerdict.missing.length > 0 && (
                    <span>
                      {t("drillSession.missing", {
                        items: lastVerdict.missing.join(t("drillSession.separator.list")),
                      })}
                    </span>
                  )}
                  {lastVerdict.contradictions.length > 0 && (
                    <span>
                      {t("drillSession.contradictions", {
                        items: lastVerdict.contradictions.join(t("drillSession.separator.list")),
                      })}
                    </span>
                  )}
                </>
              )}
            </Space>
          }
        />
      )}

      {pending ? (
        <Card
          size="small"
          title={t("drillSession.questionProgress", {
            current: session.current_index,
            total: session.max_questions,
          })}
        >
          <Space orientation="vertical" size={10} style={{ width: "100%" }}>
            <Typography.Title level={5} style={{ margin: 0 }}>
              {pending.question}
            </Typography.Title>

            {pending.followup_depth > 0 && (
              <Tag color="purple">
                {t("drillSession.followupDepth", { count: pending.followup_depth + 1 })}
              </Tag>
            )}

            {/* 契约对整个会话可见：用户有权知道自己在被怎么衡量。 */}
            <details className="drill-contract">
              <summary>{t("drillSession.contractSummary")}</summary>
              <Space orientation="vertical" size={4} style={{ marginTop: 8 }}>
                {pending.intent && (
                  <Typography.Text type="secondary">
                    {t("drillSession.contractIntent", { intent: pending.intent })}
                  </Typography.Text>
                )}
                <div>
                  <Typography.Text type="secondary">
                    {t("drillSession.contractRequired")}
                  </Typography.Text>
                  <ul className="drill-contract-list">
                    {pending.required_evidence.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                {pending.followup_triggers.length > 0 && (
                  <div>
                    <Typography.Text type="secondary">
                      {t("drillSession.contractTriggers")}
                    </Typography.Text>
                    <ul className="drill-contract-list">
                      {pending.followup_triggers.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {pending.next_followup_kind && (
                  <Typography.Text type="secondary">
                    {t("drillSession.contractNextFollowup", {
                      kind: followupKindLabel(pending.next_followup_kind),
                    })}
                  </Typography.Text>
                )}
              </Space>
            </details>

            <Input.TextArea
              rows={5}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              disabled={busy}
              placeholder={t("drillSession.answerPlaceholder")}
            />
            <Space>
              <Button type="primary" loading={busy} onClick={() => void submit()}>
                {t("drillSession.submit")}
              </Button>
              {answerRequest.loading && <AbortButton onClick={() => answerRequest.cancel()} />}
              <Popconfirm
                title={t("drillSession.stopConfirmTitle")}
                description={t("drillSession.stopConfirmBody")}
                okText={t("drillSession.stopConfirmOk")}
                cancelText={t("drillSession.stopConfirmCancel")}
                onConfirm={() => void stop()}
              >
                <Button disabled={busy}>{t("drillSession.stopEarly")}</Button>
              </Popconfirm>
            </Space>
          </Space>
        </Card>
      ) : (
        <Alert
          type="info"
          showIcon
          title={t("drillSession.generating")}
          description={t("drillSession.generatingHint")}
          action={
            <Space size={6}>
              {finishRequest.loading && (
                <AbortButton size="small" onClick={() => finishRequest.cancel()} />
              )}
              <Button size="small" loading={busy} onClick={() => void stop()}>
                {t("drillSession.stopEarly")}
              </Button>
            </Space>
          }
        />
      )}

      {session.turns.length > 0 && (
        <details className="drill-transcript">
          <summary>{t("drillSession.transcriptSummary", { count: session.turns.length })}</summary>
          <Listy
            style={{ marginTop: 8 }}
            items={session.turns}
            rowKey={(turn) => `${turn.question}|${turn.answer}`}
            styles={{ item: { ...LISTY_ITEM_PADDING_SMALL } }}
            itemRender={(turn) => (
              <ListyItem>
                <Space orientation="vertical" size={4} style={{ width: "100%" }}>
                  <Typography.Text strong>
                    {t("drillSession.turnQuestion", { question: turn.question })}
                  </Typography.Text>
                  <Typography.Text>
                    {t("drillSession.turnAnswer", { answer: turn.answer })}
                  </Typography.Text>
                  {turn.status && (
                    <Space size={6}>
                      {evidenceTag(turn.status as EvidenceStatus)}
                      {turn.feedback && (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {turn.feedback}
                        </Typography.Text>
                      )}
                    </Space>
                  )}
                </Space>
              </ListyItem>
            )}
          />
        </details>
      )}
    </Space>
  );
}
