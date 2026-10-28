// SPDX-License-Identifier: Apache-2.0
/**
 * 展示名工具的守卫：默认名的翻译只对"系统自带、且没被改名"的对象生效。
 *
 * 这三条判据都不是界面细节，而是数据边界：
 * - 主数据集固定叫「主数据」（后端拒绝改名）→ 可以翻译；
 * - 资料组 / 模型配置可以改名 → 只有后端明确说"还是默认名"时才翻译，
 *   否则一律显示用户输入（翻译用户数据等于改数据）。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_DATASET_SCOPE } from "./datasetScope";
import {
  datasetDisplayName,
  datasetSourceLabel,
  llmRecordDisplayName,
  MAIN_DATASET_ID,
  profileGroupDisplayName,
} from "./displayNames";
import { t } from "../i18n";

describe("displayNames", () => {
  it("主数据集 id 与 datasetScope 的默认作用域是同一个值", () => {
    expect(MAIN_DATASET_ID).toBe(DEFAULT_DATASET_SCOPE);
  });

  it("主数据集用固定文案，其余数据集显示自己的名字", () => {
    expect(datasetDisplayName({ id: MAIN_DATASET_ID, name: "主数据" })).toBe(
      t("appHeader.dataset.mainName"),
    );
    expect(datasetDisplayName({ id: "p_abc", name: "工作数据" })).toBe("工作数据");
  });

  it("只有后端标记为默认名时才翻译，改过名的原样显示", () => {
    expect(profileGroupDisplayName({ name: "默认组", name_is_default: true })).toBe(
      t("profileGroups.defaultName"),
    );
    expect(profileGroupDisplayName({ name: "技术岗", name_is_default: false })).toBe("技术岗");
    // 旧后端不下发该字段：宁可露出中文，也不要把用户改过的名字换掉。
    expect(profileGroupDisplayName({ name: "技术岗" })).toBe("技术岗");

    expect(llmRecordDisplayName({ name: "默认配置", name_is_default: true })).toBe(
      t("componentsMisc2.modelProfile.defaultRecordName"),
    );
    expect(llmRecordDisplayName({ name: "公司代理", name_is_default: false })).toBe("公司代理");
    expect(llmRecordDisplayName({ name: "公司代理" })).toBe("公司代理");
  });

  it("数据集来源按稳定代码翻译，未知代码回退落盘原文", () => {
    expect(datasetSourceLabel({ source: "本机", source_code: "machine" })).toBe(
      t("datasets.source.machine"),
    );
    // 导入包里自定义的来源写法：没有代码可映射，原样显示，不猜。
    expect(datasetSourceLabel({ source: "同事分享", source_code: "" })).toBe("同事分享");
    expect(datasetSourceLabel({ source: "同事分享" })).toBe("同事分享");
  });
});
