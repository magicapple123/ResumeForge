// SPDX-License-Identifier: Apache-2.0
/**
 * 对话技能（T14）：按会话读取 / 切换"这个对话启用了哪些技能"。
 *
 * 与旧的 useAssistantSkills 的关键区别：**技能没有全局开关**。已建会话走
 * `GET/PUT /api/assistant/conversations/{id}/skills`（一次拿全已选 + 预算）；
 * 还没建会话（草稿）时先把选择暂存在本机 pendingSkillIds，发第一条消息建会话时
 * 一起带上（服务端在同一事务里写入），成功后清空暂存并重取。
 *
 * 状态按 `conversationId` 归位（`dataFor`/`loadedFor`）：切换会话时不会把上一段的
 * chip 或预算短暂显示成新会话的，也不需要"先清空再请求"这种级联 setState。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_CONVERSATION_SKILLS,
  getConversationSkills,
  setConversationSkills,
  type ConversationSkillBudget,
  type ConversationSkillItem,
} from "../../../api/conversationSkills";
import { listSkills } from "../../../api/skill";
import { t } from "../../../i18n";
import type { AssistantSkill, AssistantSurface } from "../../../types";

function draftItems(catalog: AssistantSkill[], ids: number[]): ConversationSkillItem[] {
  return ids.flatMap((id) => {
    const skill = catalog.find((item) => item.id === id);
    return skill ? [{ id: skill.id, name: skill.name, description: skill.description }] : [];
  });
}

export function useConversationSkills(
  conversationId: number | null,
  surface: AssistantSurface = "page",
) {
  const [catalog, setCatalog] = useState<AssistantSkill[]>([]);
  const [selected, setSelected] = useState<ConversationSkillItem[]>([]);
  const [budget, setBudget] = useState<ConversationSkillBudget | null>(null);
  // 上面两份数据属于哪个会话 / 哪个会话已经加载完：切换会话时据此只展示"对得上"的数据。
  const [dataFor, setDataFor] = useState<number | null>(null);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [pendingSkillIds, setPendingSkillIds] = useState<number[]>([]);
  // 建会话的闭包在 useAssistantStream 里，要读**最新**的暂存值；同时留一份 ref。
  const pendingSkillIdsRef = useRef<number[]>(pendingSkillIds);
  // 快速切换会话时丢弃迟到响应（否则 A 的响应会覆盖 B 的列表）。
  const requestRef = useRef(0);

  // ref 只在渲染之外更新（React Compiler 规范：渲染期读写 ref 会导致不可预期行为）。
  useEffect(() => {
    pendingSkillIdsRef.current = pendingSkillIds;
  }, [pendingSkillIds]);

  // 技能库（菜单候选）挂载时取一次：新建/删除技能后回到助手页会重新挂载。
  useEffect(() => {
    let cancelled = false;
    void listSkills()
      .then((items) => {
        if (!cancelled) setCatalog(items);
      })
      .catch(() => {
        // 取不到技能库不影响对话本身：菜单退回"没有技能"，发送照常。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchConversationSkills = useCallback(
    async (id: number) => {
      const requestId = ++requestRef.current;
      try {
        const payload = await getConversationSkills(id, surface);
        if (requestId !== requestRef.current) return;
        setSelected(payload.skills);
        setBudget(payload.budget);
        setDataFor(id);
        // 会话已经建好（或已切换）：暂存的选择变成了服务端事实，清掉免得串到下一段草稿。
        setPendingSkillIds([]);
      } catch {
        // 取不到就保持空行：菜单仍可打开（技能库单独取过），发送不受影响。
      } finally {
        if (requestId === requestRef.current) setLoadedFor(id);
      }
    },
    [surface],
  );

  useEffect(() => {
    // 草稿不请求服务端：chip 展示本机暂存，预算等建会话后由服务端给。
    if (conversationId !== null) void fetchConversationSkills(conversationId);
  }, [conversationId, fetchConversationSkills]);

  const toggleSkill = useCallback(
    async (skill: AssistantSkill, enabled: boolean) => {
      const currentIds =
        conversationId === null ? pendingSkillIds : selected.map((item) => item.id);
      const nextIds = enabled
        ? [...currentIds.filter((id) => id !== skill.id), skill.id]
        : currentIds.filter((id) => id !== skill.id);
      if (nextIds.length > MAX_CONVERSATION_SKILLS) {
        // 入口就挡住并把"为什么"说清楚；服务端仍会再校验一次（422 同一句话）。
        throw new Error(t("conversationSkills.error.tooMany"));
      }
      if (conversationId === null) {
        setPendingSkillIds(nextIds);
        return;
      }
      setTogglingId(skill.id);
      try {
        const payload = await setConversationSkills(conversationId, nextIds, surface);
        setSelected(payload.skills);
        setBudget(payload.budget);
        setDataFor(conversationId);
      } finally {
        setTogglingId(null);
      }
    },
    [conversationId, pendingSkillIds, selected, surface],
  );

  // 事件路径（错误后重拉 / fork 后刷新）：静默与服务端对齐。
  const reload = useCallback(async () => {
    if (conversationId !== null) await fetchConversationSkills(conversationId);
  }, [conversationId, fetchConversationSkills]);

  const isDraft = conversationId === null;
  const current = !isDraft && dataFor === conversationId;
  // 草稿态展示"技能库里的候选"按暂存顺序拼出来的视图；已建会话直接信服务端。
  const selectedSkills = isDraft ? draftItems(catalog, pendingSkillIds) : current ? selected : [];
  return {
    catalog,
    selectedSkills,
    selectedSkillIds: selectedSkills.map((item) => item.id),
    budget: current ? budget : null,
    loaded: isDraft || loadedFor === conversationId,
    togglingSkillId: togglingId,
    pendingSkillIds,
    pendingSkillIdsRef,
    toggleSkill,
    reload,
  };
}
