// SPDX-License-Identifier: Apache-2.0
/**
 * W07 格式刷的**规则层**（wave2 契约 §2.5 的"格式刷口径"）。
 *
 * ## 复制的是"差异"，不是"绝对值"
 *
 * 格式刷拷贝源对象 `objects[srcId]` 里**用户显式设过的键**。若拷贝解析后的绝对值，
 * 目标条目会把"当时的角色样式"固化成局部覆盖——以后改全局角色样式对它永久失效。
 * 那正是 plan P1-02 要避免的静默丢继承。
 *
 * ## 第二个动作是显式的
 *
 * 有时用户**就是要**把当前生效值固化下来（"这条以后不跟随正文样式"）。这不是格式刷的
 * 默认语义，所以单独一个按钮 `freezeObjectStyle`，并且界面必须写清代价。
 *
 * ## 本模块不碰 UI
 *
 * 三个纯函数 + 一条"可复制差异"判定；按钮组件只负责把状态与文案摆出来。
 */
import type { ResumeFormatConfig } from "../../types/resumeFormat";
import { OBJECT_STYLE_PROPS, ROLE_STYLE_PROPS, type ResumeRoleKey } from "./styleCatalog";
import {
  readObjectStyle,
  storedStyleValue,
  withObjectProps,
  withObjectRoleProps,
  type ResumeRoleStyle,
  type ResumeStyleDomains,
} from "./styleOverrides";

/**
 * 格式刷：取出源对象的显式差异。
 *
 * 没有显式覆盖时返回 `null`——界面据此置灰并给 Tooltip（"先改一处再复制"），
 * 而不是让用户点一下之后什么都没发生。
 */
export function painterPatch(
  domains: ResumeStyleDomains,
  sourceObjectId: string | null | undefined,
): ResumeRoleStyle | null {
  if (!sourceObjectId) return null;
  const style = readObjectStyle(domains, sourceObjectId);
  const props = OBJECT_STYLE_PROPS.filter((prop) => style[prop] !== undefined);
  if (props.length === 0) return null;
  const patch: ResumeRoleStyle = {};
  for (const prop of props) patch[prop] = style[prop];
  return patch;
}

/** 应用格式刷：把差异补丁写到每个目标对象的显式覆盖上（逐条保留各自其它覆盖）。 */
export function applyPainterPatch(
  config: ResumeFormatConfig | undefined | null,
  targetObjectIds: readonly string[],
  patch: ResumeRoleStyle | null,
): ResumeFormatConfig {
  if (!patch || Object.keys(patch).length === 0) return (config ?? {}) as ResumeFormatConfig;
  return withObjectProps(config, targetObjectIds, patch);
}

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
