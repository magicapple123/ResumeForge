// SPDX-License-Identifier: Apache-2.0
/**
 * 「当前窗口选择的职业场景」的 sessionStorage 落脚点（契约 §5.4 / A2）。
 *
 * 三条硬约束：
 * 1. **只存 scenario id 或 "unset"**——不存场景正文、就业状态、简历或资料内容；
 * 2. key 按数据集隔离（模式同 `features/webform/webFormSessionStorage.ts`），
 *    数据集切换后 A 的选择不会残留在 B；
 * 3. 只在 sessionStorage（每个标签页各自一份）：A/B 两窗口可以选不同场景，
 *    互不覆盖；也不写 localStorage（那是跨重启的偏好，本批不做）。
 */
import { DEFAULT_DATASET_SCOPE, readActiveDatasetId } from "../../utils/datasetScope";

const SCENARIO_SELECTION_PREFIX = "resumeforge:career-scenario:v1";

/** 明确"不指定场景"的存储值（与"从未选择过"同义，但写下来让清理可诊断）。 */
export const UNSET_SCENARIO_VALUE = "unset";

export function scenarioSelectionStorageKey(datasetId?: string | null): string {
  const scope = (datasetId ?? "").trim() || DEFAULT_DATASET_SCOPE;
  return `${SCENARIO_SELECTION_PREFIX}:${scope}`;
}

function resolveScope(datasetId?: string | null): string {
  return datasetId ?? readActiveDatasetId();
}

/** 读当前窗口选择的场景 id；未选择 / 非法值 / 存储不可用都返回 null（= 未指定）。 */
export function loadScenarioSelection(datasetId?: string | null): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(scenarioSelectionStorageKey(resolveScope(datasetId)));
    if (!raw || raw === UNSET_SCENARIO_VALUE) return null;
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

/** 写当前窗口选择：id 或 "unset"。存储被禁用时静默失败（页面内状态不受影响）。 */
export function saveScenarioSelection(scenarioId: number | null, datasetId?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      scenarioSelectionStorageKey(resolveScope(datasetId)),
      scenarioId == null ? UNSET_SCENARIO_VALUE : String(scenarioId),
    );
  } catch {
    // sessionStorage 满或被浏览器策略禁用：本窗口仍按内存里的选择工作。
  }
}
