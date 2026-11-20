// SPDX-License-Identifier: Apache-2.0
/**
 * 「复制到剪贴板」子菜单的通用工厂（2026-11-19）。
 *
 * ## 为什么要有这个文件
 *
 * 简历中心原来自己写了一份「复制」子菜单（字段表 + 剪贴板 + Toast）。岗位广场要加
 * 同类菜单时如果照抄一份，第三处（收藏夹、备选岗位…）出现时必然再抄第三份，三份实现
 * 迟早在"空串要不要拦""失败说什么""Toast 会不会堆成一列"上分叉。这里把**机制**收成
 * 一处，两侧（简历 / 岗位）只各自维护一张字段表。
 *
 * ## 工厂负责什么
 *
 * - 子菜单壳（`复制 ▸`）与图标；
 * - 异步 pick：JD 全文要打一次 `getJob(id)`，同步字段直接返回字符串；
 * - 剪贴板（复用 `utils/clipboard` 的 Clipboard API + execCommand 兜底）；
 * - Toast：成功 / 失败 / 取内容失败，**统一用同一个 message key**——连续复制几个字段
 *   只覆盖上一条，不在右侧堆成一列；
 * - 空串保护：拿到空内容不发"已复制"，而是报失败（复制一个空串等于什么都没做）。
 *
 * ## 工厂不负责什么
 *
 * 字段文案与"哪些字段有内容才出现"由调用方的字段表决定：本文件不 import 任何领域
 * 语言包，也不认识 `ResumeBrief` / `JobList`。这样将来给第三张列表加复制，只需要写
 * 一张 `CopyField[]`。
 */
import { CopyOutlined } from "@ant-design/icons";
import type { RowActionItem } from "./RowActions";
import { copyText } from "../../utils/clipboard";

/**
 * Toast 的去重键：同 key 的 message 就地更新而不是新开一条。
 *
 * 复制是一次性取数动作，用户连点五个字段时关心的是"最后那次成不成"，
 * 不是把五条"已复制…"排队读完。
 */
export const COPY_TOAST_KEY = "rf-copy-toast";

/** 一条可复制的字段。`noun` 是提示语里的字段名（"已复制**标题**"）。 */
export interface CopyField {
  /** 菜单项 key，同一子菜单内唯一。 */
  key: string;
  /** 菜单文案（如「复制公司名」）。 */
  label: string;
  /** 提示语里的字段名（如「公司名」）。 */
  noun: string;
  /** 取值。异步字段（JD 全文）返回 Promise；抛错或给空串都会走失败提示。 */
  pick: () => string | Promise<string>;
}

/**
 * 只要求"能弹一句结果"的最小接口。
 *
 * 与 `hooks/useToast` 的 `ToastApi` 结构兼容（它多出来的字段是可选参数），
 * 但这里不 import 那个 hook：工厂是纯函数，测试里塞一个哑对象就够。
 */
export interface CopyNotifier {
  success: (text: string, options?: { key?: string }) => void;
  warning: (text: string, options?: { key?: string }) => void;
}

/** 两侧各自用 `t()` 组好再传进来：工厂不碰语言包。 */
export interface CopyTexts {
  /** 子菜单标题（「复制」）。 */
  menu: string;
  /** 成功提示；`noun` 是字段名。 */
  success: (noun: string) => string;
  /** 剪贴板被拒时的提示：要说清下一步（手动选中后按快捷键）。 */
  failed: string;
  /**
   * 异步取内容失败 / 取回空串时的提示（如 JD 没取到）。
   * 缺省回落到 `failed`——同步字段永远不会走到这条。
   */
  pickupFailed?: string;
}

/**
 * 执行一次复制：取值 → 剪贴板 → Toast。
 *
 * `pick` 先于剪贴板执行，所以 JD 这类需要请求的字段，菜单已经关掉、界面不阻塞。
 * 失败一律 warning：静默失败会让用户以为复制成功了，粘出来才发现是上一次的内容。
 */
export async function runCopy(
  field: CopyField,
  notify: CopyNotifier,
  texts: CopyTexts,
): Promise<void> {
  const pickupFailed = texts.pickupFailed ?? texts.failed;
  let value: string;
  try {
    value = await field.pick();
  } catch {
    notify.warning(pickupFailed, { key: COPY_TOAST_KEY });
    return;
  }
  if (!value.trim()) {
    // 空串不是"复制成功"：粘贴时用户会以为剪贴板坏了。
    notify.warning(pickupFailed, { key: COPY_TOAST_KEY });
    return;
  }
  const ok = await copyText(value);
  if (ok) {
    notify.success(texts.success(field.noun), { key: COPY_TOAST_KEY });
  } else {
    notify.warning(texts.failed, { key: COPY_TOAST_KEY });
  }
}

/** 把字段表摊平成菜单项（子菜单内容；测试也直接验这一层）。 */
export function copyItemsFor(
  fields: CopyField[],
  notify: CopyNotifier,
  texts: CopyTexts,
): RowActionItem[] {
  return fields.map((field) => ({
    key: field.key,
    label: field.label,
    onClick: () => {
      void runCopy(field, notify, texts);
    },
  }));
}

/**
 * 构造「复制」子菜单。
 *
 * 调用方的字段表恒有「名称 / 整行」两项，所以这里不返回 `null`：空子菜单不可达，
 * 多一个判空分支只会让四个调用点各写一遍 `...(menu ? [menu] : [])`。
 */
export function buildCopyMenu(
  fields: CopyField[],
  notify: CopyNotifier,
  texts: CopyTexts,
): RowActionItem {
  return {
    key: "copy",
    label: texts.menu,
    icon: <CopyOutlined />,
    children: copyItemsFor(fields, notify, texts),
  };
}
