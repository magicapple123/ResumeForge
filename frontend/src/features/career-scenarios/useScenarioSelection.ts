// SPDX-License-Identifier: Apache-2.0
/**
 * 当前窗口（标签页）选中的职业场景（A2）。
 *
 * 职责边界——**切换场景只改本窗口状态**：
 * - 不触发任何业务写请求（不 PATCH 场景、不碰简历/岗位/资料）；
 * - 不重置页面筛选、分页、表单或后台任务；
 * - 选择的唯一持久化是 sessionStorage 里的 scenario id（见 scenarioSelectionStorage）。
 *
 * 场景列表加载失败只暴露 error，调用方继续旧流程（例如生成弹窗照常可用）。
 */
import { useCallback, useState } from "react";
import { useApi } from "../../hooks/useApi";
import { readActiveDatasetId } from "../../utils/datasetScope";
import { listCareerScenarios } from "./api";
import { loadScenarioSelection, saveScenarioSelection } from "./scenarioSelectionStorage";
import type { CareerScenario } from "./types";

export interface ScenarioSelection {
  /** 当前数据集的已保存场景（按后端顺序）。 */
  scenarios: CareerScenario[];
  loading: boolean;
  /** 加载失败的原始文案；空串 = 没有错误。 */
  error: string;
  selectedScenarioId: number | null;
  /** 选择的对象；选中的 id 不在列表里（已归档/已删除）时为 null。 */
  selectedScenario: CareerScenario | null;
  /** 切换本窗口选择：零业务写请求。 */
  selectScenario: (scenarioId: number | null) => void;
  /** 创建/编辑后刷新列表（不会重置当前选择）。 */
  reload: () => Promise<void>;
}

export function useScenarioSelection(): ScenarioSelection {
  // 数据集在本次挂载内不变（切数据集 = 整页 reload）：作用域只解析一次。
  const [datasetId] = useState<string>(() => readActiveDatasetId());
  const { data, loading, error, reload } = useApi(() => listCareerScenarios(), [datasetId]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<number | null>(() =>
    loadScenarioSelection(datasetId),
  );

  const scenarios = data?.items ?? [];
  const selectedScenario = scenarios.find((item) => item.id === selectedScenarioId) ?? null;

  const selectScenario = useCallback(
    (scenarioId: number | null) => {
      setSelectedScenarioId(scenarioId);
      // 只写本窗口的 sessionStorage（按数据集隔离）；不发任何请求。
      saveScenarioSelection(scenarioId, datasetId);
    },
    [datasetId],
  );

  return {
    scenarios,
    loading,
    error,
    selectedScenarioId,
    selectedScenario,
    selectScenario,
    reload,
  };
}
