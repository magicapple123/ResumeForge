// SPDX-License-Identifier: Apache-2.0
/** 进行中的会话：当前这一问、契约、逐轮记录。 */
import { Alert, App, Button, Card, Input, Listy, Popconfirm, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { answerDrill, finishDrill } from "../../api/drill";
import { ListyItem } from "../../components/common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../../components/common/listyPadding";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { DrillSession, EvidenceStatus } from "../../types";
import { EVIDENCE_LABEL_KEYS, FOLLOWUP_LABEL_KEYS } from "./drillLabels";
import { evidenceTag } from "./evidenceTag";

/**
 * 追问方向是后端给的自由字符串（类型上是 `string`），不在已知表里就返回空串——
 * 与原实现 `FOLLOWUP_LABELS[kind] ?? ""` 的行为一致，不认识的取值宁可不显示。
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
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    try {
      const result = await answerDrill(session.id, answer.trim());
      setAnswer("");
      setLastVerdict({
        status: result.status,
        missing: result.missing,
        contradictions: result.contradictions,
        feedback: result.feedback,
      });
      onUpdate(result.session);
      if (result.finished) message.success(t("drillSession.finishedScan"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("drillSession.submitFailed"));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      onUpdate(await finishDrill(session.id));
      message.success(t("drillSession.stoppedScan"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("drillSession.stopFailed"));
    } finally {
      setBusy(false);
    }
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
            <Button size="small" loading={busy} onClick={() => void stop()}>
              {t("drillSession.stopEarly")}
            </Button>
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
