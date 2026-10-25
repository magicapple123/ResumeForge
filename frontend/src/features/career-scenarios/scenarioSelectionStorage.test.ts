// SPDX-License-Identifier: Apache-2.0
/** 当前窗口场景选择：sessionStorage 按数据集隔离，只存 id / "unset"，零业务写入。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadScenarioSelection,
  saveScenarioSelection,
  scenarioSelectionStorageKey,
  UNSET_SCENARIO_VALUE,
} from "./scenarioSelectionStorage";

const ACTIVE_DATASET_KEY = "resumeforge:active-dataset";

describe("职业场景选择的 sessionStorage 落脚点", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("按数据集拼 key；无数据集时回落 main", () => {
    expect(scenarioSelectionStorageKey("dataset-a")).toBe(
      "resumeforge:career-scenario:v1:dataset-a",
    );
    expect(scenarioSelectionStorageKey("")).toBe("resumeforge:career-scenario:v1:main");
    expect(scenarioSelectionStorageKey(null)).toBe("resumeforge:career-scenario:v1:main");
  });

  it("只存 id 或 unset：写入/读出往返，非法值当作未选择", () => {
    saveScenarioSelection(12, "dataset-a");
    expect(window.sessionStorage.getItem("resumeforge:career-scenario:v1:dataset-a")).toBe("12");
    expect(loadScenarioSelection("dataset-a")).toBe(12);

    saveScenarioSelection(null, "dataset-a");
    expect(window.sessionStorage.getItem("resumeforge:career-scenario:v1:dataset-a")).toBe(
      UNSET_SCENARIO_VALUE,
    );
    expect(loadScenarioSelection("dataset-a")).toBeNull();

    window.sessionStorage.setItem("resumeforge:career-scenario:v1:dataset-a", "not-a-number");
    expect(loadScenarioSelection("dataset-a")).toBeNull();
    window.sessionStorage.setItem("resumeforge:career-scenario:v1:dataset-a", "-3");
    expect(loadScenarioSelection("dataset-a")).toBeNull();
  });

  it("数据集 A 的选择不会出现在数据集 B（隔离由 key 保证）", () => {
    saveScenarioSelection(5, "dataset-a");
    expect(loadScenarioSelection("dataset-b")).toBeNull();
  });

  it("缺省作用域跟随 readActiveDatasetId()", () => {
    window.localStorage.setItem(ACTIVE_DATASET_KEY, "dataset-b");
    saveScenarioSelection(9);
    expect(window.sessionStorage.getItem("resumeforge:career-scenario:v1:dataset-b")).toBe("9");
    expect(loadScenarioSelection()).toBe(9);
    expect(loadScenarioSelection("dataset-a")).toBeNull();
  });

  it("sessionStorage 不可用时静默降级，不影响页面内状态", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveScenarioSelection(3, "dataset-a")).not.toThrow();
    expect(loadScenarioSelection("dataset-a")).toBeNull();
  });
});
