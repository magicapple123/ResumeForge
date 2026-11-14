// SPDX-License-Identifier: Apache-2.0
/**
 * 「上下文用量」第二层：窗口与压缩的设置项（默认收起）。
 *
 * 从 `ContextUsagePopover` 整块抽出来的原因：那一层回答"现在用了多少"，这一层回答
 * "能改什么"。读数每轮都变、配置几个月才动一次，挤在同一屏会把读数挤没。
 *
 * 这里的每一条都会落到**模型级配置**或**会话级状态**，所以放在折叠区：它们是动作，
 * 不是读数；误点要花一次模型调用（压缩）或改掉所有同模型对话的分母（窗口）。
 */

import { Button, Collapse } from "antd";
import { t } from "../../../../i18n";
import { useLocale } from "../../../../i18n/i18nContext";
import { formatTokenCount, savedPercent } from "../../contextUsageFormat";
import type { ContextCompactionState, ContextUsage } from "../../../../types";
import { useConversationContextState } from "../../conversationContextState";
import ModelWindowReferenceButton from "../../../settings/ModelWindowReferenceButton";
import CompactionThresholdControl from "./CompactionThresholdControl";
import ContextWindowSelect from "./ContextWindowSelect";

export interface ContextUsageSettingsSectionProps {
  usage: ContextUsage | null;
  conversationId: number | null;
  /** 窗口写回成功后本地重算（返回给 chip 的上层）。 */
  onWindowSaved?: (windowTokens: number) => void;
  compaction: ContextCompactionState | null;
  /** 没有会话 id 或正在请求时动作不可点（不发必然 404 的请求）。 */
  canAct: boolean;
  onRestore: () => void;
}

export default function ContextUsageSettingsSection({
  usage,
  conversationId,
  onWindowSaved,
  compaction,
  canAct,
  onRestore,
}: ContextUsageSettingsSectionProps) {
  useLocale();
  const windowTokens = usage?.window ?? 0;
  // 连续两次上下文超长才标红：一次可能是请求本身太大，不代表窗口填错了。
  const { contextErrors } = useConversationContextState(conversationId);
  const source = usage?.window_source;

  return (
    <Collapse
      ghost
      size="small"
      className="assistant-context-usage-settings"
      items={[
        {
          key: "settings",
          label: t("contextUsage.settings.title"),
          children: (
            <div className="assistant-context-window">
              {/* 窗口表只读参考：看完知道该填多少，写入仍走下面的选择器。 */}
              <ModelWindowReferenceButton />
              <ContextWindowSelect
                key={windowTokens}
                windowTokens={windowTokens}
                onSaved={onWindowSaved ?? (() => {})}
                contextMismatch={contextErrors >= 2}
              />
              {/* 只留来源名：窗口数字在上面的「已使用 x / y」里已经有了，不再重复一遍。 */}
              {/* F31：来源与「只影响使用这个模型的对话」合成一行（中文约 200px，英文允许折行）。 */}
              {source ? (
                <p className="assistant-context-window-hint">
                  {t("contextUsage.window.sourceLine", {
                    source: t(
                      source === "manual"
                        ? "contextUsage.window.source.manual"
                        : source === "reference"
                          ? "contextUsage.window.source.reference"
                          : "contextUsage.window.source.fallback",
                    ),
                  })}
                </p>
              ) : null}
              <CompactionThresholdControl usage={usage} conversationId={conversationId} />
              {compaction ? (
                <>
                  <p className="assistant-context-compaction-line">
                    {t("contextUsage.compaction.range", {
                      before: formatTokenCount(compaction.tokens_before),
                      after: formatTokenCount(compaction.tokens_after),
                    })}
                  </p>
                  <p className="assistant-context-compaction-line">
                    {t("contextUsage.compaction.saved", {
                      percent: savedPercent(compaction.tokens_before, compaction.tokens_after),
                    })}
                  </p>
                  {/* 「原文仍在本地」这条不能省：否则用户以为压缩删了聊天记录。 */}
                  <p className="assistant-context-compaction-hint">
                    {t("contextUsage.compaction.keepOriginal")}
                  </p>
                  <div className="assistant-context-compaction-actions">
                    <Button size="small" disabled={!canAct || undefined} onClick={onRestore}>
                      {t("contextUsage.compaction.action.restore")}
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          ),
        },
      ]}
    />
  );
}
