// SPDX-License-Identifier: Apache-2.0
/**
 * 投投写操作提案卡（#27F）：所有投投发起的写操作先出这张卡，执行后可撤销。
 *
 * 数据形状对齐 #13D 的 `preview`：`before / after / version_id / undo_text`。
 * 卡片本身**不发请求**：`apply` / `undo` 由提出提案的链路注入（见
 * `touTouProposalStore`），所以在 #13D 合入前也能独立测试；合入后只补接线。
 *
 * 撤销语义必须写清"整份简历恢复到版本 X，不是只撤这个字段"（详册 #13D 的硬要求），
 * 所以撤销按钮下方常驻一行说明，不靠 tooltip。
 */
import { useState } from "react";
import { Button } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { TouTouProposalDraft } from "./touTouProposalStore";
import "./tou-tou-proposal.css";

type ProposalStatus = "pending" | "applying" | "applied" | "undoing" | "undone" | "failed";

/** 提案卡打开时的初始状态：#13D 已执行的写直接进可撤销态。 */
function initialStatusOf(proposal: TouTouProposalDraft | null): ProposalStatus {
  return proposal?.initialStatus === "applied" ? "applied" : "pending";
}

export interface TouTouProposalCardProps {
  proposal: TouTouProposalDraft | null;
  /** 提案收起（拒绝 / 完成）时通知宿主。 */
  onDismiss?: (outcome: "rejected" | "applied" | "undone") => void;
}

export default function TouTouProposalCard({ proposal, onDismiss }: TouTouProposalCardProps) {
  useLocale();
  const [status, setStatus] = useState<ProposalStatus>(() => initialStatusOf(proposal));
  const [error, setError] = useState<string | null>(null);
  const [trackedId, setTrackedId] = useState<string | null>(proposal?.id ?? null);

  // 换了一份提案就复位状态机。渲染期守卫式调整（与 `useUnsavedLayoutFlag` 同一写法）：
  // 放 effect 里会晚一帧，用户会看到上一份提案的"已修改"闪一下。
  const currentId = proposal?.id ?? null;
  if (trackedId !== currentId) {
    setTrackedId(currentId);
    setStatus(initialStatusOf(proposal));
    setError(null);
  }

  if (!proposal) return null;

  const running = status === "applying" || status === "undoing";
  const canUndo = typeof proposal.undo === "function";
  const version = proposal.versionId === null ? "" : String(proposal.versionId);
  // 空的一侧是"新增 / 删除"（#13D：before 为 null 表示新增），不渲染两个空块。
  const beforeText = proposal.before || t("touTou.proposal.diffAdded");
  const afterText = proposal.after || t("touTou.proposal.diffRemoved");

  const apply = async () => {
    if (!proposal.apply) {
      // #13D 合入前没有真实写链路：如实说"还没接线"，不假装成功。
      setStatus("failed");
      setError(t("touTou.proposal.pending"));
      return;
    }
    setStatus("applying");
    setError(null);
    try {
      await proposal.apply();
      setStatus("applied");
    } catch (cause) {
      setStatus("failed");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const undo = async () => {
    if (!proposal.undo) return;
    setStatus("undoing");
    setError(null);
    try {
      await proposal.undo();
      setStatus("undone");
      onDismiss?.("undone");
    } catch (cause) {
      setStatus("failed");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const reject = () => {
    onDismiss?.("rejected");
  };

  return (
    <section
      className="tt-proposal"
      role="dialog"
      aria-label={t("touTou.proposal.ariaLabel")}
      data-status={status}
    >
      <h3 className="tt-proposal-title">{t(proposal.titleKey)}</h3>
      <div className="tt-proposal-diff">
        <div className="tt-proposal-side">
          <span className="tt-proposal-label">{t("touTou.proposal.before")}</span>
          <p className="tt-proposal-text is-before">{beforeText}</p>
        </div>
        <div className="tt-proposal-side">
          <span className="tt-proposal-label">{t("touTou.proposal.after")}</span>
          <p className="tt-proposal-text is-after">{afterText}</p>
        </div>
      </div>

      {status === "applied" || status === "undone" ? (
        <p className="tt-proposal-status" role="status">
          {status === "applied"
            ? t("touTou.proposal.applied")
            : t("touTou.proposal.undone", { version })}
        </p>
      ) : null}

      {status === "applied" && proposal.undoText ? (
        // #13D 的 undo_text（例如"整份简历恢复到版本「助手修改前」"）原样展示：
        // 它描述的是这次写入留下的撤销点，不是可自由编辑的文案。
        <p className="tt-proposal-undo-text">{proposal.undoText}</p>
      ) : null}

      {status === "failed" && error ? (
        <p className="tt-proposal-error" role="alert">
          {t("touTou.proposal.failed", { reason: error })}
        </p>
      ) : null}

      {status === "applied" ? (
        canUndo ? (
          <div className="tt-proposal-actions">
            {/* key 固定：执行前的「按这个改」与执行后的「撤销」是两只不同的按钮，
                不加 key 时 React 会复用同一个 antd Button 实例，它内部的 loading 延迟
                状态会让刚出现的撤销按钮短时间内忽略点击。 */}
            <Button key="undo" size="small" loading={running} onClick={() => void undo()}>
              {t("touTou.proposal.undo")}
            </Button>
            {/* 撤销语义常驻说明：整份简历回到版本 X，不是只撤这个字段。 */}
            <p className="tt-proposal-hint">{t("touTou.proposal.undoHint", { version })}</p>
          </div>
        ) : (
          <p className="tt-proposal-hint">{t("touTou.proposal.unsupported")}</p>
        )
      ) : status === "undone" ? null : (
        <div className="tt-proposal-actions">
          <Button
            key="apply"
            size="small"
            type="primary"
            loading={running}
            onClick={() => void apply()}
          >
            {t("touTou.proposal.apply")}
          </Button>
          <Button key="reject" size="small" disabled={running || undefined} onClick={reject}>
            {t("touTou.proposal.reject")}
          </Button>
        </div>
      )}
    </section>
  );
}
