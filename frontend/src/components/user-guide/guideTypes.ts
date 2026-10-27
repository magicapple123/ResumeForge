// SPDX-License-Identifier: Apache-2.0
/** 使用指南的数据类型：一条要点 = 短标签 + 一句说明；一步 = 标题 + 页面信息 + 要点列表。
 *
 * 数据由 components/user-guide/ 下的分域数据文件提供，components/userGuideSteps.ts 只做
 * 组装与再导出（门面 ≤100 行）。拆分的唯一理由是行数预算，**写作口径不变**：
 * 一条只说一件事、lead 2–8 字、text 一句话。
 *
 * 正文全部在 `userGuide.*` 语言包（zh-CN.userGuide.ts / en-US.userGuide.ts）里，数据文件
 * 只存 key——模块作用域不能求值 `t()`，渲染处（UserGuideModal）才翻译。
 */
import type { ComponentType } from "react";
import type { MessageKey } from "../../i18n";

/** 一条要点 = **一个短标签 + 一句说明**。 */
export interface GuidePoint {
  /** 粗体短标签，2–8 字。用"用户会怎么称呼这件事"，不要用功能内部名。 */
  leadKey: MessageKey;
  /** 一句话说清。**控制在一句**，第二句就该另起一条。 */
  textKey: MessageKey;
}

export interface GuideStep {
  titleKey: MessageKey;
  headingKey: MessageKey;
  descriptionKey: MessageKey;
  points: GuidePoint[];
  path: string;
  actionLabelKey: MessageKey;
  icon: ComponentType;
}
