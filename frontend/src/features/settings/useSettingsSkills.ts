// SPDX-License-Identifier: Apache-2.0
import { App } from "antd";
import { useCallback, useEffect, useState } from "react";
import { listSkills } from "../../api/skill";
import { t } from "../../i18n";
import type { AssistantSkill } from "../../types";

/**
 * 设置页「AI 模型」页里技能列表的**只读摘要**（A2 收权）。
 *
 * 设置页不再有技能写入口：导入 / 启停 / 删除统一在「工作台 → 助手技能」。
 * 两个可写入口写同一份数据时，用户会遇到"在这里关了、那里还开着"，比命名不一致严重得多
 * （`docs/ui-copy-guide.md` §2.5 N1 的裁决 ③）。所以这里只保留读路径：
 * `skills` / `skillsLoading` / `loadSkillList`。
 */
export function useSettingsSkills() {
  const { message } = App.useApp();
  const [skills, setSkills] = useState<AssistantSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);

  // 纯取数（不含 setState）：effect 初始加载与事件路径重拉共用同一实现。
  const fetchSkillList = useCallback(async (): Promise<AssistantSkill[] | null> => {
    try {
      return await listSkills();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : t("featuresMisc.settingsSkills.loadFailed"),
      );
      return null;
    }
  }, [message]);

  // Compiler 规范：初始加载的 setState 放在 .then 回调（外部数据到达时应用）。
  useEffect(() => {
    let cancelled = false;
    void fetchSkillList().then((items) => {
      if (cancelled) return;
      if (items !== null) setSkills(items);
      setSkillsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchSkillList]);

  // 事件路径（读完技能详情后的整表重拉，含 loading 翻动）。
  const loadSkillList = useCallback(async () => {
    setSkillsLoading(true);
    const items = await fetchSkillList();
    if (items !== null) setSkills(items);
    setSkillsLoading(false);
  }, [fetchSkillList]);

  return { skills, skillsLoading, loadSkillList };
}
