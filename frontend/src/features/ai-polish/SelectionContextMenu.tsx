// SPDX-License-Identifier: Apache-2.0
/**
 * 选中文字后右键弹出的上下文菜单：剪切 / 复制 / 粘贴 / 全选，选区在可编辑元素里时
 * 再追加「AI 润色」。
 *
 * 为什么不直接放行浏览器原生菜单：原生菜单里没有「AI 润色」，而用户此刻的意图
 * 就是「把这段文字改一改」。所以这里自己画一份最小可用的菜单——只做文本操作，
 * 不做开发者工具、不做「检查元素」，不假装自己是一个完整的右键菜单。
 *
 * 两条容易踩的细节：
 * 1. 菜单容器与每个按钮都拦掉 `mousedown` 的默认行为，否则点击会让选区先消失，
 *    「要改的那段文字」就没了。
 * 2. 关闭时机交给 document 级监听（菜单外按下、Esc、滚动/缩放、窗口失焦），
 *    而不是 `onBlur`——焦点会移到被操作的输入框上，那不代表用户想关菜单。
 */
import { useCallback, useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { layer } from "../../theme/tokens";
import { replaceSelection } from "./replaceSelection";
import { elementRect, getCaretInsertion, type SelectionTarget } from "./selectionTarget";

export interface SelectionContextMenuProps {
  /** 菜单左上角（相对视口），由浮层按指针位置算好并已夹进可视区。 */
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
   * 摆出来也点不动，不如不显示（见 `features/resume-writing/activeResume`）。
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
  useLocale();
  const menuRef = useRef<HTMLDivElement | null>(null);

  // 打开即接管焦点：Esc 与方向键才有落点。
  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const node = event.target;
      if (node instanceof Node && menuRef.current?.contains(node)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    const onViewportChange = () => onClose();

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    // 捕获阶段：卡片、输入框自己的滚动同样会挪走菜单，不能只监听 window。
    document.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("blur", onViewportChange);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("blur", onViewportChange);
    };
  }, [onClose]);

  const copyText = useCallback(async () => {
    if (!text) return;
    await writeClipboard(text);
  }, [text]);

  const handleCut = useCallback(() => {
    if (!target) return;
    onClose();
    void (async () => {
      // 先写剪贴板再删：万一复制被拒，用户至少还有原文。
      await writeClipboard(text);
      replaceSelection(target, "");
    })();
  }, [onClose, target, text]);

  const handlePaste = useCallback(() => {
    if (!target) return;
    onClose();
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
  }, [onClose, target]);

  const handleSelectAll = useCallback(() => {
    onClose();
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
  }, [onClose, target]);

  // 点按钮同样不许动选区：`preventDefault` 把「按下鼠标 → 清选区」这一步堵掉。
  const keepSelection = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
  }, []);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next =
      current < 0
        ? step > 0
          ? 0
          : items.length - 1
        : (current + step + items.length) % items.length;
    items[next].focus();
  }, []);

  return (
    <div
      ref={menuRef}
      className="rf-ai-polish-menu"
      role="menu"
      aria-label={t("writing.contextMenu.ariaLabel")}
      tabIndex={-1}
      style={{ left: x, top: y, zIndex: layer.aiPolish }}
      onMouseDown={keepSelection}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        role="menuitem"
        className="rf-ai-polish-menu-item"
        disabled={!target}
        onMouseDown={keepSelection}
        onClick={handleCut}
      >
        {t("writing.contextMenu.cut")}
      </button>
      <button
        type="button"
        role="menuitem"
        className="rf-ai-polish-menu-item"
        disabled={!text.trim()}
        onMouseDown={keepSelection}
        onClick={() => {
          onClose();
          void copyText();
        }}
      >
        {t("writing.contextMenu.copy")}
      </button>
      <button
        type="button"
        role="menuitem"
        className="rf-ai-polish-menu-item"
        disabled={!target}
        onMouseDown={keepSelection}
        onClick={handlePaste}
      >
        {t("writing.contextMenu.paste")}
      </button>
      <button
        type="button"
        role="menuitem"
        className="rf-ai-polish-menu-item"
        onMouseDown={keepSelection}
        onClick={handleSelectAll}
      >
        {t("writing.contextMenu.selectAll")}
      </button>
      {target && (
        <>
          <div className="rf-ai-polish-menu-separator" role="separator" />
          {/* 写作增强排在 AI 润色前面：它是一组**有明确产物**的动作（STAR / 话术 /
              风格 / 翻译），用户更常来点它；AI 润色是"按一句话要求随便改改"。 */}
          {onWriting && (
            <button
              type="button"
              role="menuitem"
              className="rf-ai-polish-menu-item"
              onMouseDown={keepSelection}
              onClick={() => {
                onClose();
                onWriting();
              }}
            >
              {t("writing.menu.entry")}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="rf-ai-polish-menu-item"
            onMouseDown={keepSelection}
            onClick={() => {
              onClose();
              onAiPolish();
            }}
          >
            {t("writing.contextMenu.aiPolish")}
          </button>
        </>
      )}
    </div>
  );
}
