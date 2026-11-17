// SPDX-License-Identifier: Apache-2.0
/**
 * 旧数据提示（T24）：这段对话在「技能按对话启用」的时代挂过技能。
 *
 * 只提示**一次**：技能现在只作用于下一条消息，旧关联不再影响任何请求。关闭后记在
 * localStorage（key 含会话 id，不同会话各记一条）；存储不可用时退化为"本次会话内关掉"，
 * 绝不因为读写 localStorage 抛错让消息流白屏。
 */

import { Alert } from "antd";
import { useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { AssistantLegacySkill } from "../../../types";

function storageKey(conversationId: number): string {
  return `resumeforge.assistant.legacySkillsDismissed.${conversationId}`;
}

function readDismissed(conversationId: number): boolean {
  try {
    return window.localStorage.getItem(storageKey(conversationId)) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(conversationId: number): void {
  try {
    window.localStorage.setItem(storageKey(conversationId), "1");
  } catch {
    // 隐私模式 / 存储被禁用：只关掉本次提示，不影响对话。
  }
}

interface Props {
  conversationId: number;
  skills: AssistantLegacySkill[];
}

export default function LegacySkillsNotice({ conversationId, skills }: Props) {
  useLocale();
  const [dismissed, setDismissed] = useState(() => readDismissed(conversationId));
  if (dismissed || skills.length === 0) return null;
  const names = skills.map((skill) => skill.name).join(t("assistantUi.skillNames.separator"));
  return (
    <Alert
      type="info"
      showIcon
      closable
      className="assistant-legacy-skills"
      title={t("conversationSkills.legacy.notice", { names })}
      closeText={t("conversationSkills.legacy.dismiss")}
      onClose={() => {
        setDismissed(true);
        writeDismissed(conversationId);
      }}
    />
  );
}
