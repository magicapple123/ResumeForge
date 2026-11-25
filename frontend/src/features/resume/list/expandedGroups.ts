// SPDX-License-Identifier: Apache-2.0
/**
 * 「按岗位折叠」展开状态的持久化（CR-33）。
 *
 * 沿用仓库既有偏好键惯例（`resumeforge.<域>.<名>.v1` + localStorage），
 * 只存**展开的组 key**（`job:<id>` / `resume:<id>`）：默认态是折叠，所以存"折叠的"
 * 会让每次新增岗位默认展开，与"折叠默认态"相反。
 *
 * 读写失败（隐私模式、配额满、JSON 坏）一律按"全部折叠"处理——偏好丢失不该影响列表可用。
 */
export const EXPANDED_GROUPS_KEY = "resumeforge.resumes.expanded-groups.v1";

export function readExpandedGroupKeys(): string[] {
  try {
    const raw = window.localStorage.getItem(EXPANDED_GROUPS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function writeExpandedGroupKeys(keys: readonly string[]): void {
  try {
    window.localStorage.setItem(EXPANDED_GROUPS_KEY, JSON.stringify([...keys]));
  } catch {
    // 写不进去只意味着"这次展开不跨刷新保留"，当前会话的展开状态仍在 React state 里。
  }
}
