// SPDX-License-Identifier: Apache-2.0
/**
 * 「输入区四档权限」的唯一前端口径（T11）。
 *
 * 两层结构（D20）：设置页保存**全局默认**（后端键 assistant_permission），输入框旁的下拉
 * 按会话覆盖，覆盖只存本机 `localStorage["rf.assistant.permission.<id>"]`——刷新与切页仍在，
 * 换设备不同步，也不随会话数据一起走。
 *
 * 两条硬约束：
 * 1. 请求体永远发**解算后的两轴布尔**（relaxed_mode / allow_write），不发 "follow" 这种
 *    中间态——后端只认布尔。解算的唯一入口是 resolvePermissionAxes。
 * 2. 四档 → 两轴的映射表只此一份（PERMISSION_AXES），下拉、设置页、发送路径都从它取。
 */
import { useEffect, useState } from "react";
import {
  getAssistantPermission,
  type AssistantPermissionLevel,
} from "../../api/assistantPermission";
import type { MessageKey } from "../../i18n";

export type { AssistantPermissionLevel } from "../../api/assistantPermission";

/** UI 层的第五个值：跟随全局。协议层/请求体里不会出现它。 */
export const FOLLOW_GLOBAL = "follow" as const;
export type AssistantPermissionChoice = AssistantPermissionLevel | typeof FOLLOW_GLOBAL;

/** 四档的展示顺序（与设置页、菜单一致）。 */
export const ASSISTANT_PERMISSION_LEVELS: readonly AssistantPermissionLevel[] = [
  "read_only",
  "read_full",
  "write_confirm",
  "write_full",
];

/** 默认档位：仅查看。任何读不到设置的路径都退回它（保守优先）。 */
export const DEFAULT_ASSISTANT_PERMISSION: AssistantPermissionLevel = "read_only";

/** 四档 → 两轴（唯一映射表）。relaxed = 读真实资料，allowWrite = 直接写库。 */
export const PERMISSION_AXES: Record<
  AssistantPermissionLevel,
  { relaxed: boolean; allowWrite: boolean }
> = {
  read_only: { relaxed: false, allowWrite: false },
  read_full: { relaxed: true, allowWrite: false },
  write_confirm: { relaxed: false, allowWrite: true },
  write_full: { relaxed: true, allowWrite: true },
};

/** 档位显示名 / 一句话说明的语言包 key（渲染处再 t()，模块作用域不求值）。 */
export const ASSISTANT_PERMISSION_LABEL_KEYS: Record<AssistantPermissionLevel, MessageKey> = {
  read_only: "assistantPermission.level.read_only",
  read_full: "assistantPermission.level.read_full",
  write_confirm: "assistantPermission.level.write_confirm",
  write_full: "assistantPermission.level.write_full",
};

export const ASSISTANT_PERMISSION_DESC_KEYS: Record<AssistantPermissionLevel, MessageKey> = {
  read_only: "assistantPermission.level.read_only.desc",
  read_full: "assistantPermission.level.read_full.desc",
  write_confirm: "assistantPermission.level.write_confirm.desc",
  write_full: "assistantPermission.level.write_full.desc",
};

/** 写档位（可修改 / 完全权限）：首次选中要弹一次确认。 */
export function isWriteLevel(level: AssistantPermissionLevel): boolean {
  return PERMISSION_AXES[level].allowWrite;
}

/** 读档位中的放宽两档要显示琥珀提示条。 */
export function showsRelaxedNotice(level: AssistantPermissionLevel): boolean {
  return PERMISSION_AXES[level].relaxed;
}

/** 解算后的请求体两轴。 */
export interface AssistantPermissionAxes {
  relaxed: boolean;
  allowWrite: boolean;
}

export function permissionAxes(level: AssistantPermissionLevel): AssistantPermissionAxes {
  const axes = PERMISSION_AXES[level];
  return { relaxed: axes.relaxed, allowWrite: axes.allowWrite };
}

const PERMISSION_STORAGE_PREFIX = "rf.assistant.permission.";
const ACK_STORAGE_PREFIX = "rf.assistant.permissionAck.";

export function permissionStorageKey(conversationId: number): string {
  return `${PERMISSION_STORAGE_PREFIX}${conversationId}`;
}

function permissionAckStorageKey(conversationId: number): string {
  return `${ACK_STORAGE_PREFIX}${conversationId}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // 隐私模式/被策略禁用时访问 localStorage 会抛：按"没有覆盖"处理即可。
    return null;
  }
}

function isPermissionLevel(value: string): value is AssistantPermissionLevel {
  return (ASSISTANT_PERMISSION_LEVELS as readonly string[]).includes(value);
}

/** 读当前会话的覆盖值；没存过或值损坏 → 跟随全局（损坏的值顺手丢掉）。 */
export function readPermissionChoice(
  conversationId: number | null | undefined,
): AssistantPermissionChoice {
  if (conversationId == null) return FOLLOW_GLOBAL;
  const store = storage();
  if (!store) return FOLLOW_GLOBAL;
  const raw = store.getItem(permissionStorageKey(conversationId));
  if (raw !== null && isPermissionLevel(raw)) return raw;
  if (raw !== null) store.removeItem(permissionStorageKey(conversationId));
  return FOLLOW_GLOBAL;
}

/** 写覆盖值；选「跟随全局」= 删 key，走全局默认。 */
export function writePermissionChoice(
  conversationId: number | null | undefined,
  choice: AssistantPermissionChoice,
): void {
  if (conversationId == null) return;
  const store = storage();
  if (!store) return;
  if (choice === FOLLOW_GLOBAL) {
    store.removeItem(permissionStorageKey(conversationId));
    return;
  }
  store.setItem(permissionStorageKey(conversationId), choice);
}

/** 该会话是否已经确认过「写档位会直接改数据」。 */
export function hasAcknowledgedWritePermission(conversationId: number | null | undefined): boolean {
  if (conversationId == null) return false;
  const store = storage();
  if (!store) return false;
  return store.getItem(permissionAckStorageKey(conversationId)) === "1";
}

export function acknowledgeWritePermission(conversationId: number | null | undefined): void {
  if (conversationId == null) return;
  const store = storage();
  if (!store) return;
  store.setItem(permissionAckStorageKey(conversationId), "1");
}

// ===== 全局默认：模块级缓存 + 广播（与 llmConfigEvents 同构） =====

let cachedGlobalPermission: AssistantPermissionLevel | null = null;
let globalRequest: Promise<AssistantPermissionLevel> | null = null;
const listeners = new Set<() => void>();

export function getCachedGlobalPermission(): AssistantPermissionLevel | null {
  return cachedGlobalPermission;
}

export function subscribeAssistantPermission(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitPermissionChange(): void {
  for (const listener of listeners) listener();
}

/**
 * 取全局默认档位（带进程内缓存）。
 *
 * 失败时**不缓存**失败结果：下次发送会再试一次；在此之前解算退回「仅查看」（保守）。
 */
export async function loadGlobalPermission(force = false): Promise<AssistantPermissionLevel> {
  if (!force && cachedGlobalPermission) return cachedGlobalPermission;
  if (!force && globalRequest) return globalRequest;
  const request = getAssistantPermission()
    .then((setting) => {
      const level = isPermissionLevel(setting.permission)
        ? setting.permission
        : DEFAULT_ASSISTANT_PERMISSION;
      cachedGlobalPermission = level;
      globalRequest = null;
      return level;
    })
    .catch(() => {
      globalRequest = null;
      return cachedGlobalPermission ?? DEFAULT_ASSISTANT_PERMISSION;
    });
  globalRequest = request;
  return request;
}

/** 全局默认被写入后调用：清缓存并通知所有订阅方重取。 */
export function bumpAssistantPermission(): void {
  cachedGlobalPermission = null;
  globalRequest = null;
  emitPermissionChange();
}

/** 测试用：清空缓存与订阅。 */
export function resetAssistantPermissionForTests(): void {
  cachedGlobalPermission = null;
  globalRequest = null;
  listeners.clear();
}

/** 按会话覆盖 + 全局默认解算两轴（同步版；调用方已确保全局默认在手上）。 */
export function resolvePermissionAxesSync(
  conversationId: number | null | undefined,
  globalLevel: AssistantPermissionLevel,
): AssistantPermissionAxes {
  const choice = readPermissionChoice(conversationId);
  return permissionAxes(choice === FOLLOW_GLOBAL ? globalLevel : choice);
}

/**
 * 发送路径专用：按会话解算两轴（必要时先取一次全局默认）。
 *
 * 取不到全局默认时按「仅查看」处理——少发敏感资料比多发安全。
 */
export async function resolvePermissionAxes(
  conversationId: number | null | undefined,
): Promise<AssistantPermissionAxes> {
  const choice = readPermissionChoice(conversationId);
  if (choice !== FOLLOW_GLOBAL) return permissionAxes(choice);
  const globalLevel = await loadGlobalPermission();
  return permissionAxes(globalLevel);
}

/** 输入区用的权限状态：覆盖值、全局默认、解算结果与提示条关闭态。 */
export function useAssistantPermission(conversationId: number | null | undefined) {
  const [globalLevel, setGlobalLevel] = useState<AssistantPermissionLevel | null>(
    cachedGlobalPermission,
  );
  const [choice, setChoiceState] = useState<AssistantPermissionChoice>(() =>
    readPermissionChoice(conversationId),
  );
  // 提示条关闭态记「在哪个档位上关的」而不是一个布尔：换档位/换会话后自动重新出现，
  // 不需要 effect 里再 setState（那会多一轮级联渲染）。
  const [noticeDismissedLevel, setNoticeDismissedLevel] = useState<AssistantPermissionLevel | null>(
    null,
  );

  // 会话切换：重新读该会话的覆盖值（新会话回到「跟随全局」）。这是"把外部存储里的
  // 当前值同步进组件状态"的显式同步点：localStorage 不是可响应数据源，无法靠推导拿到。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部存储同步点
    setChoiceState(readPermissionChoice(conversationId));
    setNoticeDismissedLevel(null);
  }, [conversationId]);

  // 全局默认：挂载取一次 + 设置页保存后重取（切页不会重建模块级缓存）。
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void loadGlobalPermission(true).then((level) => {
        if (!cancelled) setGlobalLevel(level);
      });
    };
    refresh();
    const unsubscribe = subscribeAssistantPermission(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const effectiveLevel: AssistantPermissionLevel =
    choice === FOLLOW_GLOBAL ? (globalLevel ?? DEFAULT_ASSISTANT_PERMISSION) : choice;

  const requestChoice = (next: AssistantPermissionChoice) => {
    writePermissionChoice(conversationId, next);
    setChoiceState(next);
  };

  return {
    choice,
    effectiveLevel,
    globalLevel,
    editable: conversationId != null,
    noticeVisible: showsRelaxedNotice(effectiveLevel) && noticeDismissedLevel !== effectiveLevel,
    dismissNotice: () => setNoticeDismissedLevel(effectiveLevel),
    requestChoice,
  };
}
