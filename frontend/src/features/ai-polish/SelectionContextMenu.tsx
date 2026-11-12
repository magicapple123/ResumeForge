// SPDX-License-Identifier: Apache-2.0
/**
 * 选中文字后右键弹出的上下文菜单：剪切 / 复制 / 粘贴 / 全选，选区在可编辑元素里时
 * 再追加「AI 润色」。
 *
 * 为什么不直接放行浏览器原生菜单：原生菜单里没有「AI 润色」，而用户此刻的意图
 * 就是「把这段文字改一改」。所以这里自己画一份最小可用的菜单——只做文本操作，
 * 不做开发者工具、不做「检查元素」，不假装自己是一个完整的右键菜单。
 *
 * 渲染、定位、键盘、焦点与关闭全部交给全局唯一宿主 `ContextMenuHost`（问题 25）：
 * 原来 Bold / Selection 两个菜单各渲染一份 `ContextMenuSurface`，同一次右键会叠出
 * 两张卡片。现在这里**只声明"这份菜单有哪些项、每项做什么"**，交给 `openContextMenu`；
 * 后开的那份直接替换前一份，天然只有一层。
 *
 * `keepSelection` 必须开：否则按下按钮的一瞬间选区消失，"要改的那段文字"就没了。
 */
import { useCallback, useEffect, useMemo } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { openContextMenu } from "../context-menu/contextMenuStore";
import type { RowMenuItem } from "../../components/common/rowActionMenu";
import { replaceSelection } from "./replaceSelection";
import { elementRect, getCaretInsertion, type SelectionTarget } from "./selectionTarget";

export interface SelectionContextMenuProps {
  /** 指针位置（视口坐标），浮层会据此贴边落位并夹进视口。 */
  x: number;
  y: number;
  /** 选区落在可编辑元素里时才有；没有它就只能复制/全选。 */
  target: SelectionTarget | null;
  /** 选中的文字。非可编辑区里没有 `target`，只能靠它来复制。 */
  text: string;
  onClose: () => void;
  onAiPolish: () => void;
  /**
   * 打开「写作增强」；`null` = 当前没有归属的简历（不在简历详情里），这一项不渲染。
   *
   * 写作增强的四个动作都要 `resume_id`，而右键菜单是全局的——没有简历作用域时
   * 摆出来也点不动，不如不显示（见 `features/resume/writing/activeResume`）。
   */
  onWriting: (() => void) | null;
}

/** 执行一条编辑命令；环境不支持（jsdom、部分 WebView）时返回 `false`。 */
function execCommand(command: string, value?: string): boolean {
  if (typeof document.execCommand !== "function") return false;
  try {
    return document.execCommand(command, false, value);
  } catch {
    return false;
  }
}

/**
 * 写剪贴板：优先异步 API（需要安全上下文与用户手势），失败退回 `execCommand`。
 * 后者复制的是「当前选区」——调用方必须先保住选区，所以这里不接受任意文本。
 */
async function writeClipboard(text: string): Promise<boolean> {
  const clipboard = navigator.clipboard;
  if (clipboard && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // 权限被拒或非安全上下文：再用老办法试一次，仍失败就当复制没成功。
    }
  }
  return execCommand("copy");
}

/** 读剪贴板；不可用或拒绝授权时返回空串（此时粘贴无事可做）。 */
async function readClipboard(): Promise<string> {
  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.readText !== "function") return "";
  try {
    return await clipboard.readText();
  } catch {
    return "";
  }
}

export default function SelectionContextMenu({
  x,
  y,
  target,
  text,
  onClose,
  onAiPolish,
  onWriting,
}: SelectionContextMenuProps) {
  const locale = useLocale();

  const copyText = useCallback(async () => {
    if (!text) return;
    await writeClipboard(text);
  }, [text]);

  const handleCut = useCallback(() => {
    if (!target) return;
    void (async () => {
      // 先写剪贴板再删：万一复制被拒，用户至少还有原文。
      await writeClipboard(text);
      replaceSelection(target, "");
    })();
  }, [target, text]);

  const handlePaste = useCallback(() => {
    if (!target) return;
    void (async () => {
      const clip = await readClipboard();
      if (!clip) return;
      // 原生插入：撤销栈、输入法状态、`maxLength` 都交给浏览器管。
      if (execCommand("insertText", clip)) return;
      // 插入失败（不支持或不可编辑）：按光标偏移自己写回。读不到光标偏移
      // （如 `type="email"`）就退化成「替换掉当前选中的那段」。
      const insertion = getCaretInsertion(target.element);
      const caretTarget: SelectionTarget = insertion
        ? { ...insertion, text: "", rect: elementRect(insertion.element) }
        : target;
      replaceSelection(caretTarget, clip);
    })();
  }, [target]);

  const handleSelectAll = useCallback(() => {
    const element = target?.element ?? null;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.focus();
      element.select();
      return;
    }
    if (element) {
      element.focus();
      window.getSelection()?.selectAllChildren(element);
      return;
    }
    execCommand("selectAll");
  }, [target]);

  const items = useMemo<RowMenuItem[]>(() => {
    const base: RowMenuItem[] = [
      {
        key: "cut",
        label: t("writing.contextMenu.cut"),
        disabled: !target,
        onClick: handleCut,
      },
      {
        key: "copy",
        label: t("writing.contextMenu.copy"),
        disabled: !text.trim(),
        onClick: () => void copyText(),
      },
      {
        key: "paste",
        label: t("writing.contextMenu.paste"),
        disabled: !target,
        onClick: handlePaste,
      },
      { key: "selectAll", label: t("writing.contextMenu.selectAll"), onClick: handleSelectAll },
    ];

    if (target) {
      base.push({ key: "divider", type: "divider" });
      // 写作增强排在 AI 润色前面：它是一组**有明确产物**的动作（STAR / 话术 /
      // 风格 / 翻译），用户更常来点它；AI 润色是"按一句话要求随便改改"。
      if (onWriting) {
        base.push({ key: "writing", label: t("writing.menu.entry"), onClick: onWriting });
      }
      base.push({
        key: "aiPolish",
        label: t("writing.contextMenu.aiPolish"),
        onClick: onAiPolish,
      });
    }
    return base;
    // `locale` 只为在切语言后重建文案；`t()` 本身是模块级的。
  }, [
    target,
    text,
    handleCut,
    copyText,
    handlePaste,
    handleSelectAll,
    onWriting,
    onAiPolish,
    locale,
  ]);

  // 只把菜单交给全局唯一宿主（`ContextMenuHost`）：这里不再渲染浮层，
  // 于是"同一次右键被两个监听都处理"只会得到最后一份，不会叠出两张卡片。
  useEffect(() => {
    openContextMenu({
      x,
      y,
      items,
      ariaLabel: t("writing.contextMenu.ariaLabel"),
      keepSelection: true,
      onClose,
    });
  }, [x, y, items, onClose]);

  return null;
}
