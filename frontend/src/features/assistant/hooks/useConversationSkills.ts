// SPDX-License-Identifier: Apache-2.0
/**
 * 待发送技能（T24）：技能从「按对话启用」改成「只作用于下一条消息」。
 *
 * 因此这里**不再有服务端读写**：勾选只是本地 state（chip 文案 = 「下一条消息将使用」），
 * 发送时把 `selectedSkillIds` 随请求带上，发送发起后由 `clearSkills` 清空。
 * 服务端按消息里的 `skill_ids` 解析并拼提示词（`context.skill_prompt`），不再读
 * `assistant_conversation_skill`。
 *
 * 切会话时清空：上一条对话里的待发送选择不该跟到下一条去（技能是按消息的，不是按会话的）。
 * 技能库（候选）仍挂载时取一次；取不到不影响对话本身。
 */

import { useCallback, useEffect, useState } from "react";
import {
  MAX_CONVERSATION_SKILLS,
  type ConversationSkillItem,
} from "../../../api/conversationSkills";
import { listSkills } from "../../../api/skill";
import { t } from "../../../i18n";
import type { AssistantSkill } from "../../../types";

function toItem(skill: AssistantSkill): ConversationSkillItem {
  return { id: skill.id, name: skill.name, description: skill.description };
}

/** 待发送选择 + 它所属的会话：切会话时旧选择自动作废，不做跨会话继承。 */
interface PendingSelection {
  conversationId: number | null;
  items: ConversationSkillItem[];
}

const EMPTY_SELECTION: ConversationSkillItem[] = [];

export function useConversationSkills(conversationId: number | null = null) {
  const [catalog, setCatalog] = useState<AssistantSkill[]>([]);
  // 待发送选择：只在本机，发送后清空；不落服务端、不跨消息保留。
  const [selection, setSelection] = useState<PendingSelection>({
    conversationId,
    items: [],
  });
  const [loaded, setLoaded] = useState(false);

  // 技能库（菜单候选）挂载时取一次：新建/删除技能后回到助手页会重新挂载。
  useEffect(() => {
    let cancelled = false;
    void listSkills()
      .then((items) => {
        if (!cancelled) setCatalog(items);
      })
      .catch(() => {
        // 取不到技能库不影响对话本身：菜单退回"没有技能"，发送照常。
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 切会话即作废（渲染期校正，与 React 的"随 prop 调整 state"范式一致）：
  // 待发送的技能属于"刚刚那条对话的下一条消息"，不能跟着切过去。
  if (selection.conversationId !== conversationId) {
    setSelection({ conversationId, items: [] });
  }
  const selected = selection.conversationId === conversationId ? selection.items : EMPTY_SELECTION;

  const toggleSkill = useCallback(
    (skill: AssistantSkill, enabled: boolean) => {
      const already = selected.some((item) => item.id === skill.id);
      if (!enabled) {
        if (!already) return;
        setSelection({ conversationId, items: selected.filter((item) => item.id !== skill.id) });
        return;
      }
      if (already) return;
      if (selected.length >= MAX_CONVERSATION_SKILLS) {
        // 入口就挡住并把"为什么"说清楚；服务端仍会再校验一次（>8 → 422）。
        throw new Error(t("conversationSkills.error.tooMany"));
      }
      setSelection({ conversationId, items: [...selected, toItem(skill)] });
    },
    [conversationId, selected],
  );

  const clearSkills = useCallback(
    () => setSelection({ conversationId, items: [] }),
    [conversationId],
  );
  // 兼容旧调用点：本地选择没有"与服务端对齐"这一步，保留 async 形状免得调用方改造。
  const reload = useCallback(async () => {}, []);

  return {
    catalog,
    selectedSkills: selected,
    selectedSkillIds: selected.map((item) => item.id),
    // 预算由服务端在发送时按消息算；输入区不再有"本对话预算"这个概念。
    budget: null,
    loaded,
    // 输入区不再有"切换中"的服务端往返；保留字段免得调用方大改。
    togglingSkillId: null,
    toggleSkill,
    clearSkills,
    reload,
  };
}
