// SPDX-License-Identifier: Apache-2.0
/**
 * 数据集与资料组的**展示名**。
 *
 * 两处名字都来自后端、而且都是"默认值由后端写死"的那一类：
 * - 主数据集（`MAIN_DATASET_ID`）创建时就叫「主数据」，后端拒绝改名 → 可以翻译；
 * - 默认组的名字可以改，所以只在 `name_is_default` 为真时翻译，改名后原样显示。
 *
 * 用户自建/导入的数据集、自建组一律显示它们自己的名字：那是用户数据，翻译它等于改数据。
 */
import { t } from "../i18n";
import type { MessageKey } from "../i18n";

/**
 * 主数据集的 id（后端 `dataset_registry.MAIN_DATASET_ID`）。
 *
 * 这里**不**从 `datasetScope` 取值：那个模块在页头的测试里被整块 mock 掉（只留
 * `saveActiveDatasetId`），再从这里读它的常量会让组件在测试里直接抛错。值是协议常量，
 * `utils/displayNames.test.ts` 钉住它与 `DEFAULT_DATASET_SCOPE` 相等。
 */
export const MAIN_DATASET_ID = "main";

/** 主数据集的展示名；其余数据集返回原名。 */
export function datasetDisplayName(item: { id: string; name: string }): string {
  return item.id === MAIN_DATASET_ID ? t("appHeader.dataset.mainName") : item.name;
}

/**
 * 资料组的展示名：`name_is_default` 为真（默认组且没被改过名）时走语言包。
 *
 * 旧后端不下发这个字段（`undefined`）时按原名显示——宁可露出中文，也不要把用户改过的
 * 组名替换成"默认方案"。
 */
export function profileGroupDisplayName(item: { name: string; name_is_default?: boolean }): string {
  return item.name_is_default ? t("profileGroups.defaultName") : item.name;
}

/** 全局模型配置记录的展示名：默认名（用户没改过）走语言包，其余原样显示。 */
export function llmRecordDisplayName(item: { name: string; name_is_default?: boolean }): string {
  return item.name_is_default ? t("componentsMisc2.modelProfile.defaultRecordName") : item.name;
}

/**
 * 数据集来源的展示名。
 *
 * 后端 `source` 是**落盘的中文**（"本机" / "导入" / "随备份包导入" …），导入包里还可能带
 * 用户自定义的写法；`source_code` 是按前者映射出的稳定代码，英文界面靠它取文案，
 * 映射不到就显示 `source` 原文——宁可露出中文，也不要凭空造一个来源。
 */
export function datasetSourceLabel(item: { source?: string; source_code?: string }): string {
  const keys: Record<string, MessageKey> = {
    machine: "datasets.source.machine",
    created: "datasets.source.created",
    imported: "datasets.source.imported",
    restored: "datasets.source.restored",
    sample: "datasets.source.sample",
  };
  const key = item.source_code ? keys[item.source_code] : undefined;
  return key ? t(key) : (item.source ?? "");
}
