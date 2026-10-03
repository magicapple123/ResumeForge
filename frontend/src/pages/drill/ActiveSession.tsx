/** 进行中的会话：当前这一问、契约、逐轮记录。 */
import { Alert, App, Button, Card, Input, Listy, Popconfirm, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { answerDrill, finishDrill } from "../../api/drill";
import { ListyItem } from "../../components/common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../../components/common/listyPadding";
import type { DrillSession, EvidenceStatus } from "../../types";
import { EVIDENCE_LABELS, FOLLOWUP_LABELS } from "../../types";
import { evidenceTag } from "./evidenceTag";

export function ActiveSession({
  session,
  onUpdate,
}: {
  session: DrillSession;
  onUpdate: (session: DrillSession) => void;
}) {
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
      message.warning("请先写下你的回答");
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
      if (result.finished) message.success("这一场问完了，复盘已生成");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "提交失败");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      onUpdate(await finishDrill(session.id));
      message.success("已结束，复盘已生成");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "结束失败");
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
          title={`上一轮判定：${EVIDENCE_LABELS[lastVerdict.status]}`}
          description={
            <Space orientation="vertical" size={2}>
              {/* 真实模拟模式下不展示"还缺什么"——那等于把判分标准念出来。 */}
              {deferred && lastVerdict.feedback === "" ? (
                <Typography.Text type="secondary">
                  真实模拟模式：判定已记录，结束后统一复盘。
                </Typography.Text>
              ) : (
                <>
                  {lastVerdict.feedback && <span>{lastVerdict.feedback}</span>}
                  {lastVerdict.missing.length > 0 && (
                    <span>还缺：{lastVerdict.missing.join("；")}</span>
                  )}
                  {lastVerdict.contradictions.length > 0 && (
                    <span>矛盾：{lastVerdict.contradictions.join("；")}</span>
                  )}
                </>
              )}
            </Space>
          }
        />
      )}

      {pending ? (
        <Card size="small" title={`第 ${session.current_index} / ${session.max_questions} 题`}>
          <Space orientation="vertical" size={10} style={{ width: "100%" }}>
            <Typography.Title level={5} style={{ margin: 0 }}>
              {pending.question}
            </Typography.Title>

            {pending.followup_depth > 0 && (
              <Tag color="purple">这是对同一条主张的第 {pending.followup_depth + 1} 次追问</Tag>
            )}

            {/* 契约对整个会话可见：用户有权知道自己在被怎么衡量。 */}
            <details className="drill-contract">
              <summary>这道题的评分标准（提问前已锁定）</summary>
              <Space orientation="vertical" size={4} style={{ marginTop: 8 }}>
                {pending.intent && (
                  <Typography.Text type="secondary">想验证：{pending.intent}</Typography.Text>
                )}
                <div>
                  <Typography.Text type="secondary">必须讲到：</Typography.Text>
                  <ul className="drill-contract-list">
                    {pending.required_evidence.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                {pending.followup_triggers.length > 0 && (
                  <div>
                    <Typography.Text type="secondary">出现这些就该被追问：</Typography.Text>
                    <ul className="drill-contract-list">
                      {pending.followup_triggers.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {pending.next_followup_kind && (
                  <Typography.Text type="secondary">
                    下一问方向：{FOLLOWUP_LABELS[pending.next_followup_kind as never] ?? ""}
                  </Typography.Text>
                )}
              </Space>
            </details>

            <Input.TextArea
              rows={5}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              disabled={busy}
              placeholder="照实说你做过什么。没做到的就说没做到——这里不会替你编，编了也是面试时要还的。"
            />
            <Space>
              <Button type="primary" loading={busy} onClick={() => void submit()}>
                提交回答
              </Button>
              <Popconfirm
                title="结束这一场并出复盘？"
                description="已经答过的判定都会保留。"
                okText="结束并出复盘"
                cancelText="继续答"
                onConfirm={() => void stop()}
              >
                <Button disabled={busy}>提前结束</Button>
              </Popconfirm>
            </Space>
          </Space>
        </Card>
      ) : (
        <Alert
          type="info"
          showIcon
          title="正在生成下一题…"
          description="如果长时间没有变化，可以点「提前结束」先拿现有的判定出复盘。"
          action={
            <Button size="small" loading={busy} onClick={() => void stop()}>
              提前结束
            </Button>
          }
        />
      )}

      {session.turns.length > 0 && (
        <details className="drill-transcript">
          <summary>逐轮记录（{session.turns.length} 轮）</summary>
          <Listy
            style={{ marginTop: 8 }}
            items={session.turns}
            rowKey={(turn) => `${turn.question}|${turn.answer}`}
            styles={{ item: { ...LISTY_ITEM_PADDING_SMALL } }}
            itemRender={(turn) => (
              <ListyItem>
                <Space orientation="vertical" size={4} style={{ width: "100%" }}>
                  <Typography.Text strong>问：{turn.question}</Typography.Text>
                  <Typography.Text>答：{turn.answer}</Typography.Text>
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
