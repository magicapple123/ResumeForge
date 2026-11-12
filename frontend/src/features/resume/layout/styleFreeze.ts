// SPDX-License-Identifier: Apache-2.0
/**
 * 「固定这条的当前样式」的规则层（原 `stylePainter.ts` 的一半，审计 R-19 拆分出来）。
 *
 * ## 为什么会从格式刷模块里拆出来
 *
 * 2026-10-31 的审计把**格式刷**整个功能删掉了（用户口径：复制样式这条路与"多选批量调整"
 * 重复，而且它复制的是"差异"，用户很难预期会粘上哪几个键）。但同一个模块里还有两件事
 * 与本功能无关、且仍在使用：把"当前生效值"固化成局部覆盖。删格式刷时把它们一起删掉
 * 会连带删掉「固定这条的当前样式」——清单的坑里明确写了 `typography.painter.freeze*`
 * 属于另一个功能，**不要删**。所以这里只搬实现，语义一个字没改。
 *
 * ## 与格式刷的本质区别（也是它被保留的原因）
 *
 * 格式刷搬的是"源对象**显式设过**的键"（复制差异）；固定写的是"**当前生效**的段落级值"
 * （固化现状）。前者会丢失目标自己的继承，后者是明确宣告"这条以后不跟随正文样式"，
 * 界面必须写清这个代价（`typography.painter.freezeHint`）。
 */
import type { ResumeFormatConfig } from "../../../types/resumeFormat";
import { OBJECT_STYLE_PROPS, ROLE_STYLE_PROPS, type ResumeRoleKey } from "./styleCatalog";
import {
  storedStyleValue,
  withObjectProps,
  withObjectRoleProps,
  type ResumeRoleStyle,
} from "./styleOverrides";

/**
 * 「把当前生效值固化为局部调整」：把对象当前生效的段落级值全部写成显式覆盖。
 *
 * 代价：这一条以后**不再跟随**角色样式（界面用 `typography.painter.freezeHint` 说明）。
 * 只写 `OBJECT_STYLE_PROPS` 里的段落级属性，不写字号等角色级属性。
 */
export function freezeObjectStyle(
  config: ResumeFormatConfig | undefined | null,
  objectId: string,
  resolvedStyle: ResumeRoleStyle,
  /** 对象字号基准（后端 entry_style_css 的 base_ratios 对对象恒为 1，保留参数以便对拍）。 */
  baseRatio = 1,
): ResumeFormatConfig {
  const patch: ResumeRoleStyle = {};
  for (const prop of OBJECT_STYLE_PROPS) {
    const displayed = resolvedStyle[prop];
    if (displayed === undefined) continue;
    // 传入的是**显示值**（字号 = 系数 × 基准）；落库要转回系数，否则后端会再乘一次。
    const stored = storedStyleValue(prop, displayed, baseRatio);
    if (stored !== null) patch[prop] = stored;
  }
  return withObjectProps(config, [objectId], patch);
}

/**
 * 「把当前生效值固定为局部调整」的**子范围**版本（Q12/Q14：条目头 / 正文 / 灰字）。
 *
 * 与整条版（freezeObjectStyle → objects）只差落点：这里写
 * `object_roles["<object_id>:<role>"]`，只固定该范围的角色属性，不影响同一条的其它范围。
 * 只收该角色**允许**的属性（与后端 ROLE_PROPS 同一白名单；写进去也会被 validate 丢掉）。
 */
export function freezeObjectRoleStyle(
  config: ResumeFormatConfig | undefined | null,
  objectId: string,
  role: ResumeRoleKey,
  resolvedStyle: ResumeRoleStyle,
  baseRatio = 1,
): ResumeFormatConfig {
  const patch: ResumeRoleStyle = {};
  for (const prop of ROLE_STYLE_PROPS[role]) {
    const displayed = resolvedStyle[prop];
    if (displayed === undefined) continue;
    // 传入的是显示值（字号 = 系数 × 基准）；落库要转回系数，否则后端会再乘一次。
    const stored = storedStyleValue(prop, displayed, baseRatio);
    if (stored !== null) patch[prop] = stored;
  }
  return withObjectRoleProps(config, [objectId], role, patch);
}
