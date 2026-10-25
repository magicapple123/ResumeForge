// SPDX-License-Identifier: Apache-2.0
/**
 * 职业场景接口（契约 §2.4）：catalog / list / create / update（archive 是 update 的
 * 语义化包装，不新增端点）。错误统一走 `api/client` 的 request() → ApiError：
 * 409 用 `businessCode === "career_scenario_revision_conflict"` 判别。
 */
import { request } from "../../api/client";
import type { CareerScenario, CareerScenarioCatalog, CareerScenarioConfig } from "./types";

/** 内置目录（8 个快捷场景 + 限额）。失败不阻断旧生成流程。 */
export function fetchCareerScenarioCatalog(): Promise<CareerScenarioCatalog> {
  return request("/career-scenarios/catalog");
}

/** 当前数据集的已保存场景（后端默认不含已归档）。 */
export function listCareerScenarios(): Promise<{ items: CareerScenario[]; total: number }> {
  return request("/career-scenarios");
}

export function createCareerScenario(payload: {
  name: string;
  config: CareerScenarioConfig;
}): Promise<CareerScenario> {
  return request("/career-scenarios", { method: "POST", body: JSON.stringify(payload) });
}

export interface CareerScenarioUpdatePayload {
  name?: string;
  config?: CareerScenarioConfig;
  archived?: boolean;
  /** 条件写：必须等于服务端当前 revision，否则 409。 */
  expected_revision: number;
}

export function updateCareerScenario(
  scenarioId: number,
  payload: CareerScenarioUpdatePayload,
): Promise<CareerScenario> {
  return request(`/career-scenarios/${scenarioId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/** 归档（不删除行；GET 列表默认隐藏）。 */
export function archiveCareerScenario(
  scenarioId: number,
  expectedRevision: number,
): Promise<CareerScenario> {
  return updateCareerScenario(scenarioId, { archived: true, expected_revision: expectedRevision });
}

/** 409 冲突：场景已被其他窗口修改（必须刷新比较，不能静默用新版）。 */
export const CAREER_SCENARIO_REVISION_CONFLICT = "career_scenario_revision_conflict";

export function isCareerScenarioRevisionConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "businessCode" in error &&
    (error as { businessCode?: string }).businessCode === CAREER_SCENARIO_REVISION_CONFLICT
  );
}
