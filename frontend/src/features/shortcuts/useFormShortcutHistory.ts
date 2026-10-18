/**
 * 把表单历史接到三个快捷键上（R5）：撤回、恢复、保存。
 *
 * 单独成文件而不是塞进 `hooks/useFormHistory`，是为了保持那支 hook 与快捷键体系
 * 互不依赖（它只该关心快照栈）；页面侧则只需要一行就能拿到"可撤回 + 快捷键已接好"
 * 的完整能力——我的资料页与简历微调弹窗各自只有十几行预算，容不下三条注册式调用。
 */
import type { FormInstance } from "antd";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useFormHistory,
  type FormHistory,
  type UseFormHistoryOptions,
} from "../../hooks/useFormHistory";
import { useShortcut } from "./useShortcutKeymap";

export interface UseFormShortcutHistoryOptions extends UseFormHistoryOptions {
  /** 保存动作的落点：页面**既有的**保存入口（不要在这里新造一条保存路径）。 */
  onSave?: () => void;
  /** 表单值变化时的附加动作（通常是"置脏"）。历史点由本 hook 自己记。 */
  onChange?: () => void;
  /** 撤回/恢复是否可用（通常绑"编辑态/弹窗是否打开"）。 */
  historyEnabled?: boolean;
  /** 保存是否可用。 */
  saveEnabled?: boolean;
}

export interface FormShortcutHistory extends FormHistory {
  /** 直接交给 `<Form onValuesChange>`：置脏与记历史点一次做完。 */
  handleValuesChange: () => void;
}

export function useFormShortcutHistory<Values extends object>(
  form: FormInstance<Values>,
  options: UseFormShortcutHistoryOptions = {},
): FormShortcutHistory {
  const {
    onSave,
    onChange,
    historyEnabled = true,
    saveEnabled = true,
    limit,
    debounceMs,
    resetKey,
  } = options;
  const history = useFormHistory(form, { limit, debounceMs, resetKey });
  // onSave / onChange 每次渲染都可能是新闭包（依赖当前草稿/编辑态）：经 ref 取最新实现。
  const saveRef = useRef(onSave);
  const changeRef = useRef(onChange);
  useEffect(() => {
    saveRef.current = onSave;
    changeRef.current = onChange;
  });

  useShortcut("undo", () => history.undo(), historyEnabled);
  useShortcut("redo", () => history.redo(), historyEnabled);
  useShortcut(
    "save",
    () => {
      saveRef.current?.();
    },
    saveEnabled,
  );

  const handleValuesChange = useCallback(() => {
    changeRef.current?.();
    history.push();
  }, [history]);

  return useMemo(() => ({ ...history, handleValuesChange }), [handleValuesChange, history]);
}
