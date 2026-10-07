/**
 * 助手技能状态。
 *
 * 技能会在服务端改变助手的作答方式，但界面上本来完全看不到这件事——用户只会觉得
 * "今天的助手有点不一样"。这里既提供只读的启用列表（页头提示），也提供开关能力
 * （助手页的「技能」下拉可以直接启停，不必跳去设置页）。
 */

import { useCallback, useEffect, useState } from "react";
import { listSkills, setSkillEnabled } from "../../../api/skill";
import type { AssistantSkill } from "../../../types";

export function useAssistantSkills() {
  const [skills, setSkills] = useState<AssistantSkill[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  // 纯取数（不含 setState）：effect 内联调用时 Compiler 才能验证非同步更新。
  const fetchSkills = useCallback(async (): Promise<AssistantSkill[] | null> => {
    try {
      return await listSkills();
    } catch {
      // 取不到技能列表不影响对话本身，静默退回"没有技能"。
      return null;
    }
  }, []);

  // Compiler 规范：初始加载的 setState 放 .then 回调（外部数据到达时应用）。
  useEffect(() => {
    let cancelled = false;
    void fetchSkills().then((items) => {
      if (cancelled) return;
      if (items !== null) setSkills(items);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchSkills]);

  // 事件路径（开关技能后的整表重拉）。
  const reloadSkills = useCallback(async () => {
    const items = await fetchSkills();
    if (items !== null) setSkills(items);
    setLoaded(true);
  }, [fetchSkills]);

  const toggleSkill = useCallback(async (skill: AssistantSkill, enabled: boolean) => {
    setTogglingId(skill.id);
    try {
      const updated = await setSkillEnabled(skill.id, enabled);
      setSkills((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } finally {
      setTogglingId(null);
    }
  }, []);

  return {
    skills,
    enabledSkills: skills.filter((skill) => skill.enabled),
    skillsLoaded: loaded,
    togglingSkillId: togglingId,
    reloadSkills,
    toggleSkill,
  };
}
