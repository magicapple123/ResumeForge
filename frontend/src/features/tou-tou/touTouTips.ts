// SPDX-License-Identifier: Apache-2.0
/** 投投主动提示：短、可执行，不替代助手对具体简历的判断。 */

import type { MessageKey } from "../../i18n";

/**
 * 标语表只存 key：模块作用域不能求值 `t()`（求值一次就定死，切语言不会更新），
 * 文案由渲染方在渲染期按当前语言取（`t(TOU_TOU_TIPS[index])`）。
 */
export const TOU_TOU_TIPS: readonly MessageKey[] = [
  "touTou.tips.results",
  "touTou.tips.verbs",
  "touTou.tips.numbers",
  "touTou.tips.applyMatch",
  "touTou.tips.star",
  "touTou.tips.facts",
  "touTou.tips.context",
  "touTou.tips.verify",
];
