// SPDX-License-Identifier: Apache-2.0
/**
 * 助手消息下方的「参考了 N 条记忆」（T23）。
 *
 * 一行小字，默认折起：用户需要能核对"它为什么这么说"，但记忆内容不该常驻在每条
 * 回答下面。展开后按记忆类型列出当时的**内容快照**（后端随消息落库，不是读今天的
 * 那一行）——记忆被改或删之后，历史回答仍然对得上。
 */
import { Button } from "antd";
import { useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { AssistantMessageMemory } from "../../../types";
import { memoryKindLabel } from "../../settings/assistantMemoryLabels";

export default function MemoryReferenceNote({ memories }: { memories?: AssistantMessageMemory[] }) {
  useLocale();
  const [open, setOpen] = useState(false);
  if (!memories || memories.length === 0) return null;

  return (
    <div className="assistant-memory-refs">
      <Button
        type="link"
        size="small"
        className="assistant-memory-refs-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {t("assistantUi.messageList.memory.used", { count: memories.length })}
      </Button>
      {open ? (
        <ul className="assistant-memory-refs-list">
          {memories.map((memory) => (
            <li key={memory.id}>
              <span className="assistant-memory-refs-kind">{memoryKindLabel(memory.kind)}</span>
              <span className="assistant-memory-refs-value">{memory.value}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
