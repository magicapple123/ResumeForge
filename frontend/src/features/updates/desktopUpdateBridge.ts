// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { getDesktopUpdateBridge } from "../settings/updateCardHelpers";

export interface DesktopUpdateState {
  phase:
    | "idle"
    | "checking"
    | "available"
    | "current"
    | "downloading"
    | "verifying"
    | "installing"
    | "failed";
  current: string;
  latest: string;
  notes: string;
  published: string;
  size: number | null;
  received: number;
  total: number | null;
  request: number;
  sequence: number;
  manual: boolean;
  error: "" | "incomplete" | "stall" | "interrupted" | "download" | "check";
  /**
   * 失败的技术原文（主进程截断 300 字），例如 `releases/latest returned 403
   * (x-ratelimit-remaining: 0)`。
   *
   * `error` 是阶段码（兼容契约，渲染层按它选固定文案），**原因只能从这里读**：
   * 以前主进程把 `err.message` 丢了，弹窗里只剩「检查更新失败」五个字（第 11 条）。
   * 归因（中文 + 原文括注）在 `updateErrorText.ts`，本字段原样展示、不吞掉。
   */
  errorDetail: string;
}

export interface InAppUpdateBridge {
  /**
   * 发起一次检查。`ok:false` 表示这次 IPC 本身没走通（非信任发送方 / 主进程同步抛出），
   * `error` 是主进程给的原文——两者都要能显示出来，不能让用户只看到「检查更新失败」。
   */
  checkUpdate(): Promise<{ ok: boolean; error?: string }>;
  startUpdate(version: string): Promise<boolean>;
  getUpdateState(): Promise<DesktopUpdateState | null>;
  onUpdateState(listener: (state: DesktopUpdateState) => void): () => void;
}

export function getInAppUpdateBridge(): InAppUpdateBridge | null {
  const bridge = getDesktopUpdateBridge() as Partial<InAppUpdateBridge> | null;
  return bridge &&
    typeof bridge.startUpdate === "function" &&
    typeof bridge.onUpdateState === "function" &&
    typeof bridge.getUpdateState === "function"
    ? (bridge as InAppUpdateBridge)
    : null;
}

export function useDesktopUpdateState(bridge: InAppUpdateBridge) {
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  useEffect(() => {
    let active = true;
    const receive = (next: DesktopUpdateState | null) => {
      if (active && next)
        setState((previous) => (!previous || next.sequence > previous.sequence ? next : previous));
    };
    const unsubscribe = bridge.onUpdateState(receive);
    void bridge
      .getUpdateState()
      .then(receive)
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);
  return state;
}
