// SPDX-License-Identifier: Apache-2.0
/**
 * 「上下文用量」弹层（需求 #6 + #10）：五段占比条 + 五行图例 + 上下文窗口 + 压缩状态。
 *
 * 口径三件事，界面上分得很开，因为它们**不能合并**：
 *
 * 1. 主指标（大号占比、`已使用 x / y`、五段条、图例百分比）全部是**估算**
 *    （`estimate_tokens`，CJK 1 token/字、ASCII 4 字符/token），所以标题右侧标「估算」；
 * 2. 底栏单独一行是**实测**：服务商上一轮报告的 `prompt_tokens`，未报告就写「本次未报告」；
 * 3. 图例百分比的分母是**窗口**（不是已用），这样"五行相加 = 顶部总占比"才对。
 *
 * 窗口未设置（0）时不算占比：显示「未设置上下文窗口」+「去设置」，而不是 0%。
 *
 * 压缩（#10）分两层动作，界面必须让用户看懂：
 *
 * - 「压缩上下文」**先 dry-run** 出预估再确认——真跑要消耗一次全量输入的模型调用，
 *   这是成本确认，不是不可逆确认；
 * - 「还原原文」是**无损**的（压缩只改"发给模型的视图"，原文从来没被删除），
 *   但仍然确认一次：清空摘要后重新压一次又要花钱。
 */

import { CloseOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, Modal } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "../../../../i18n";
import type { MessageKey } from "../../../../i18n";
import { useLocale } from "../../../../i18n/i18nContext";
import {
  bucketColor,
  formatExactTokens,
  formatPercent,
  formatTokenCount,
  savedPercent,
} from "../../contextUsageFormat";
import {
  compactAssistantConversation,
  restoreAssistantConversation,
} from "../../../../api/assistant";
import type {
  AssistantCompactionResult,
  ContextCompactionState,
  ContextUsage,
} from "../../../../types";
import ContextWindowSelect from "./ContextWindowSelect";

/** 桶 key → 语言包 key（协议值不翻译，显示名按这张表取）。 */
const BUCKET_LABEL_KEYS: Record<string, MessageKey> = {
  system: "contextUsage.bucket.system",
  tools: "contextUsage.bucket.tools",
  conversation: "contextUsage.bucket.conversation",
  connectors: "contextUsage.bucket.connectors",
  skills: "contextUsage.bucket.skills",
};

/** 弹层里可能打开的两个确认框：压缩（先 dry-run）与还原。 */
type CompactionDialog = "compact" | "restore" | null;

export interface ContextUsagePopoverProps {
  usage: ContextUsage | null;
  onClose: () => void;
  /** 窗口写回成功后本地重算（返回给 chip 的上层）。 */
  onWindowSaved?: (windowTokens: number) => void;
  /**
   * 压缩 / 还原要走会话接口。不传（浅测试、或在没有会话的空态里）时压缩动作整体禁用：
   * 与其发一个必然 404 的请求，不如诚实地不可点。
   */
  conversationId?: number | null;
  /** 压缩或还原成功后让上层重取用量（面板上的数字必须跟着变）。 */
  onContextChanged?: () => void;
}

/** 压缩状态那段正文（有状态说状态，没状态说「尚未压缩」）。 */
function CompactionStatus({
  compaction,
  usage,
}: {
  compaction: ContextCompactionState;
  usage: ContextUsage | null;
}) {
  const current = formatPercent(usage?.window ? (usage.percent ?? null) : null);
  return (
    <>
      <p className="assistant-context-compaction-line">
        {t("contextUsage.compaction.status", {
          masked: compaction.masked_tool_results,
          turns: compaction.turns,
        })}
      </p>
      <p className="assistant-context-compaction-line">
        {t("contextUsage.compaction.range", {
          before: formatTokenCount(compaction.tokens_before),
          after: formatTokenCount(compaction.tokens_after),
        })}
        {usage?.window ? ` · ${current}` : ""}
      </p>
      <p className="assistant-context-compaction-hint">
        {t("contextUsage.compaction.keepOriginal")}
      </p>
    </>
  );
}

export default function ContextUsagePopover({
  usage,
  onClose,
  onWindowSaved,
  conversationId = null,
  onContextChanged,
}: ContextUsagePopoverProps) {
  useLocale();
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const windowTokens = usage?.window ?? 0;
  const hasWindow = windowTokens > 0;
  const percentText = formatPercent(hasWindow ? (usage?.percent ?? null) : null);
  const compaction = usage?.compaction ?? null;
  const [dialog, setDialog] = useState<CompactionDialog>(null);
  const [preview, setPreview] = useState<AssistantCompactionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const canAct = conversationId !== null && !busy;

  const closeDialog = () => {
    setDialog(null);
    setPreview(null);
  };

  /** 第一步：只问预估（不写库、不调模型），拿到数字再让用户决定要不要花这次调用。 */
  const openCompact = async () => {
    if (conversationId === null) return;
    setBusy(true);
    try {
      setPreview(await compactAssistantConversation(conversationId, true));
      setDialog("compact");
    } catch {
      message.error(t("contextUsage.compaction.toast.failed"));
    } finally {
      setBusy(false);
    }
  };

  /** 第二步：真跑。成功后让上层重取用量——摘要变了，面板上的数字必须跟着变。 */
  const confirmCompact = async () => {
    if (conversationId === null) return;
    setBusy(true);
    try {
      const result = await compactAssistantConversation(conversationId, false);
      message.success(
        t("contextUsage.compaction.toast.compacted", { turns: result.turns_covered }),
      );
      closeDialog();
      onContextChanged?.();
    } catch {
      message.error(t("contextUsage.compaction.toast.failed"));
    } finally {
      setBusy(false);
    }
  };

  const confirmRestore = async () => {
    if (conversationId === null) return;
    setBusy(true);
    try {
      await restoreAssistantConversation(conversationId);
      message.success(t("contextUsage.compaction.toast.restored"));
      closeDialog();
      onContextChanged?.();
    } catch {
      message.error(t("contextUsage.compaction.toast.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="assistant-context-usage-panel">
      <div className="assistant-context-usage-head">
        <span className="assistant-context-usage-title">
          {t("contextUsage.title")}
          <span className="assistant-context-usage-estimate">{t("contextUsage.estimate")}</span>
          {usage?.partial ? (
            <span className="assistant-context-usage-partial">{t("contextUsage.partial")}</span>
          ) : null}
        </span>
        <Button
          type="text"
          size="small"
          aria-label={t("contextUsage.aria.close")}
          icon={<CloseOutlined />}
          onClick={onClose}
        />
      </div>

      {hasWindow ? (
        <>
          <div className="assistant-context-usage-figure">
            <span className="assistant-context-usage-percent">{percentText}</span>
            <span className="assistant-context-usage-used">
              {t("contextUsage.used", {
                used: formatTokenCount(usage?.total ?? 0),
                window: formatTokenCount(windowTokens),
              })}
            </span>
          </div>
          {/* 五段条：0 的段不画（画了会留一条看不见的缝），段间白缝靠 CSS gap。 */}
          <div className="assistant-context-usage-bar">
            {(usage?.buckets ?? [])
              .filter((bucket) => bucket.tokens > 0)
              .map((bucket) => (
                <span
                  key={bucket.key}
                  className={`assistant-context-usage-seg assistant-context-usage-seg-${bucketColor(bucket.key)}`}
                  style={{ flex: `${bucket.percent ?? 0} 0 0` }}
                />
              ))}
          </div>
          <ul className="assistant-context-usage-legend">
            {(usage?.buckets ?? []).map((bucket) => (
              <li key={bucket.key} className="assistant-context-usage-legend-row">
                <span
                  className={`assistant-context-usage-dot assistant-context-usage-seg-${bucketColor(bucket.key)}`}
                  aria-hidden="true"
                />
                <span className="assistant-context-usage-legend-name">
                  {t(BUCKET_LABEL_KEYS[bucket.key] ?? "contextUsage.bucket.system")}
                </span>
                <span className="assistant-context-usage-legend-percent">
                  {formatPercent(bucket.percent)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        /* 没有分母就不算百分比：给一句实话 + 一个能直接去的入口。 */
        <div className="assistant-context-usage-nowindow">
          <span>{t("contextUsage.noWindow")}</span>
          <Button type="link" size="small" onClick={() => navigate("/settings?tab=model")}>
            {t("contextUsage.goSettings")}
          </Button>
        </div>
      )}

      <div className="assistant-context-usage-divider" />
      <ContextWindowSelect windowTokens={windowTokens} onSaved={onWindowSaved ?? (() => {})} />

      {/* 压缩状态（#10）：先说"压过什么"，再给两个动作。 */}
      <div className="assistant-context-usage-divider" />
      <section
        className="assistant-context-compaction"
        aria-label={t("contextUsage.compaction.title")}
      >
        <div className="assistant-context-compaction-head">
          <span>{t("contextUsage.compaction.title")}</span>
          {compaction ? (
            <span className="assistant-context-compaction-badge">
              {t("contextUsage.compaction.saved", {
                percent: savedPercent(compaction.tokens_before, compaction.tokens_after),
              })}
            </span>
          ) : null}
        </div>
        {compaction ? (
          <CompactionStatus compaction={compaction} usage={usage} />
        ) : (
          <p className="assistant-context-compaction-line">{t("contextUsage.compaction.none")}</p>
        )}
        <div className="assistant-context-compaction-actions">
          <Button size="small" disabled={!canAct} onClick={() => void openCompact()}>
            {t("contextUsage.compaction.action.compact")}
          </Button>
          {compaction ? (
            <Button size="small" disabled={!canAct} onClick={() => setDialog("restore")}>
              {t("contextUsage.compaction.action.restore")}
            </Button>
          ) : null}
        </div>
      </section>

      {/* 实测值单独一行：与上面的估算不合并、不换算。 */}
      <p className="assistant-context-usage-actual">
        {usage?.usage_actual == null
          ? t("contextUsage.actualUnknown")
          : t("contextUsage.actual", { tokens: formatExactTokens(usage.usage_actual) })}
      </p>

      {/* 压缩确认：先摆预估（从多少到多少、覆盖几轮），再让用户决定要不要花这次调用。 */}
      <Modal
        open={dialog === "compact"}
        title={t("contextUsage.compaction.action.compact")}
        okText={t("contextUsage.compaction.action.compact")}
        cancelText={t("common.action.cancel")}
        confirmLoading={busy}
        mask={{ closable: false }}
        okButtonProps={{ disabled: !preview || preview.turns_covered === 0 }}
        onOk={() => void confirmCompact()}
        onCancel={closeDialog}
        width={380}
      >
        {preview && preview.turns_covered > 0 ? (
          <>
            <p className="assistant-context-compaction-line">
              {t("contextUsage.compaction.preview", {
                before: formatPercent(preview.percent_before),
                after: formatPercent(preview.percent_after),
                turns: preview.turns_covered,
              })}
            </p>
            <p className="assistant-context-compaction-hint">
              {t("contextUsage.compaction.keepOriginal")}
            </p>
            <p className="assistant-context-compaction-hint">
              {t("contextUsage.compaction.confirmHint")}
            </p>
          </>
        ) : (
          <p className="assistant-context-compaction-line">
            {t("contextUsage.compaction.nothing")}
          </p>
        )}
      </Modal>

      {/* 还原确认：动作会清掉摘要（原文不受影响），重压一次又要花钱，所以问一次。 */}
      <Modal
        open={dialog === "restore"}
        title={t("contextUsage.compaction.action.restore")}
        okText={t("contextUsage.compaction.action.restore")}
        cancelText={t("common.action.cancel")}
        confirmLoading={busy}
        mask={{ closable: false }}
        onOk={() => void confirmRestore()}
        onCancel={closeDialog}
        width={380}
      >
        <p className="assistant-context-compaction-line">
          {t("contextUsage.compaction.restoreBody")}
        </p>
      </Modal>
    </div>
  );
}
