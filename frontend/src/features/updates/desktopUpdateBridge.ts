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
}

export interface InAppUpdateBridge {
  checkUpdate(): Promise<{ ok: boolean }>;
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
