// SPDX-License-Identifier: Apache-2.0
/**
 * 按条审阅弹窗（RF-13）：AI 润色 / 手填在落表单前的 diff 审阅。
 *
 * 输入是一组待审变更（path + before/after + 来源 + 预检结论），逐条渲染词级
 * diff（复用 ResumeDiffView 的 DiffToken 渲染与 utils/resumeFieldDiff 的
 * wordDiff），用户逐条接受/拒绝，也可全部接受；确定后把**被接受的**变更集合
 * 回调给调用方——调用方仍走既有的表单回填/保存链，本弹窗绝不直接改简历。
 */
import { Link } from "react-router-dom";
import { Alert, Button, Modal, Space, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import { DiffTokenText } from "../ResumeDiffView";
import { wordDiff } from "../../utils/resumeFieldDiff";
import { describeResumeFieldPath } from "../../utils/resumeFieldPath";
import type { ResumeContent, ResumePendingChange } from "../../types";

interface Props {
  open: boolean;
  pendingChanges: ResumePendingChange[];
  /** 提供后把 path 翻译成人话栏目名；缺省显示原始路径。 */
  content?: ResumeContent | null;
  onCancel: () => void;
  /** 确定按钮：返回被接受的变更子集（保持原顺序）。 */
  onConfirm: (accepted: ResumePendingChange[]) => void;
}

type Decision = "accepted" | "rejected" | "undecided";

const VERDICT_LABELS: Record<string, string> = {
  ok: "预检通过",
  fact_check_needed: "涉及事实，建议回台账核实",
  blocked: "含未完成标记，不能写入",
};

/**
 * 多行文本逐行配对做词级 diff（``before`` / ``after`` 以 \n 分行）。
 * 行数不对齐时，多出的行按整行 removed / added 处理。
 */
function lineDiffs(before: string, after: string) {
  const oldLines = before.length > 0 ? before.split("\n") : [];
  const newLines = after.length > 0 ? after.split("\n") : [];
  const total = Math.max(oldLines.length, newLines.length);
  const rows: {
    oldTokens: ReturnType<typeof wordDiff>["oldTokens"];
    newTokens: ReturnType<typeof wordDiff>["newTokens"];
  }[] = [];
  for (let index = 0; index < total; index++) {
    const oldText = oldLines[index] ?? "";
    const newText = newLines[index] ?? "";
    const { oldTokens, newTokens } = wordDiff(oldText, newText);
    rows.push({ oldTokens, newTokens });
  }
  return rows;
}

export default function ResumeChangeReviewModal({
  open,
  pendingChanges,
  content,
  onCancel,
  onConfirm,
}: Props) {
  // 决定按条目下标记录；弹窗每次打开/换一批变更都重置为未决。
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [decidedFor, setDecidedFor] = useState<ResumePendingChange[] | null>(null);
  if (decidedFor !== pendingChanges) {
    setDecidedFor(pendingChanges);
    setDecisions(pendingChanges.map(() => "undecided"));
  }

  const acceptedCount = decisions.filter((d) => d === "accepted").length;
  const undecided = decisions.filter((d) => d === "undecided").length;

  const labels = useMemo(
    () =>
      pendingChanges.map((change) =>
        content ? describeResumeFieldPath(change.path, content) : change.path,
      ),
    [pendingChanges, content],
  );

  const setDecision = (index: number, decision: Decision) => {
    setDecisions((current) => {
      const next = [...current];
      next[index] = next[index] === decision ? "undecided" : decision;
      return next;
    });
  };

  const acceptAll = () => setDecisions(pendingChanges.map(() => "accepted"));

  const confirm = () => {
    onConfirm(pendingChanges.filter((_, index) => decisions[index] === "accepted"));
  };

  return (
    <Modal
      title="逐条审阅改动"
      open={open}
      width={720}
      destroyOnHidden
      onCancel={onCancel}
      footer={
        <Space>
          <Typography.Text type="secondary" data-testid="review-accept-count">
            已接受 {acceptedCount} 条{undecided > 0 ? `，未决 ${undecided} 条` : ""}
          </Typography.Text>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" onClick={confirm}>
            应用所选{acceptedCount > 0 ? `（${acceptedCount}）` : ""}
          </Button>
        </Space>
      }
      styles={{ body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto" } }}
    >
      <Space style={{ marginBottom: 12 }} wrap>
        <Button size="small" onClick={acceptAll}>
          全部接受
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          只有被接受的改动会填入表单；保存后才会更新简历。
        </Typography.Text>
      </Space>
      <div style={{ display: "grid", gap: 16 }}>
        {pendingChanges.map((change, index) => {
          const rows = lineDiffs(change.before, change.after);
          const decision = decisions[index] ?? "undecided";
          return (
            <div
              key={`${change.path}:${index}`}
              className="resume-change-review-item"
              data-testid="resume-change-review-item"
            >
              <Space size={8} wrap style={{ marginBottom: 6 }}>
                <Typography.Text strong>{labels[index]}</Typography.Text>
                <Tag color={change.origin === "ai_rewrite" ? "gold" : "purple"}>
                  {change.origin === "ai_rewrite" ? "AI 改写" : "用户补充"}
                </Tag>
                {change.verdict === "fact_check_needed" && (
                  <Tag color="volcano">{VERDICT_LABELS.fact_check_needed}</Tag>
                )}
                {change.verdict === "blocked" && <Tag color="red">{VERDICT_LABELS.blocked}</Tag>}
                {change.verdict === "ok" && <Tag color="green">{VERDICT_LABELS.ok}</Tag>}
              </Space>
              {change.instruction && (
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
                  改写要求：{change.instruction}
                </Typography.Paragraph>
              )}
              {change.verdict === "fact_check_needed" && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ margin: "6px 0" }}
                  title={
                    <span>
                      涉及事实，建议回台账核实
                      {(change.reasons ?? []).length > 0 && (
                        <Typography.Paragraph style={{ fontSize: 12, margin: "2px 0 0" }}>
                          {(change.reasons ?? []).join("；")}
                        </Typography.Paragraph>
                      )}
                    </span>
                  }
                  description={
                    <Link
                      to={`/claims${change.subject ? `?keyword=${encodeURIComponent(change.subject)}` : ""}`}
                    >
                      去事实台账核实
                    </Link>
                  }
                />
              )}
              {change.verdict === "blocked" && (
                <Alert
                  type="error"
                  showIcon
                  style={{ margin: "6px 0" }}
                  title={(change.reasons ?? ["内容含未完成标记，请先补全"])[0]}
                />
              )}
              <div
                style={{
                  fontFamily: "monospace",
                  fontSize: 13,
                  lineHeight: 1.7,
                  margin: "6px 0",
                }}
              >
                {rows.length === 0 ? (
                  <Typography.Text type="secondary">（这一栏原来是空的）</Typography.Text>
                ) : (
                  rows.map((row, rowIndex) => (
                    <div key={rowIndex}>
                      {row.oldTokens.length > 0 && (
                        <div data-line-type="removed">
                          <DiffTokenText tokens={row.oldTokens} />
                        </div>
                      )}
                      {row.newTokens.length > 0 && (
                        <div data-line-type="added">
                          <DiffTokenText tokens={row.newTokens} />
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
              <Space size={8}>
                <Button
                  size="small"
                  type={decision === "accepted" ? "primary" : "default"}
                  onClick={() => setDecision(index, "accepted")}
                >
                  接受
                </Button>
                <Button
                  size="small"
                  danger={decision === "rejected"}
                  onClick={() => setDecision(index, "rejected")}
                >
                  拒绝
                </Button>
              </Space>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
