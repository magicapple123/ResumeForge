// SPDX-License-Identifier: Apache-2.0
/**
 * 中断预算的 React 壳（#27D）：把 `touTouIntervention` 的纯状态机接到界面上。
 *
 * 职责只有三件：
 * 1. 过滤掉已静音的 kind（静音 = 这类别再提示，连 pulse 也不再为它出现）；
 * 2. 选出**允许出气泡**的那一条（`announce !== false` + 周上限 + 未降级）；
 * 3. 管气泡的显示生命周期：延迟出现 → 自动隐藏 = 记一次忽略；点「处理一下」= 记一次
 *    采用（连续忽略清零）；点「这类别再提示」= 静音该 kind。
 *
 * 状态持久化在 `localStorage`（见 `touTouIntervention.ts` 的取舍说明）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { TouTouSignal } from "./touTouPageContext";
import {
  canAnnounce,
  isKindMuted,
  muteKind,
  readInterventionState,
  recordAnnounced,
  recordEngaged,
  recordIgnored,
  restoreIntervention,
  writeInterventionState,
  type TouTouInterventionState,
} from "./touTouIntervention";

/** 信号出现后等一帧再说话：让 pulse 先被看到，也避免页面刚挂载就弹。 */
export const TIP_DELAY_MS = 1_200;
/** 气泡自动隐藏时间：8s 与旧标语一致，用户来得及读完。 */
export const TIP_VISIBLE_MS = 8_000;

export interface TouTouInterventionApi {
  /** 未静音的当前信号（pulse 的判据）。 */
  signals: readonly TouTouSignal[];
  /** 当前允许出气泡的那一条；null = 只 pulse / 静默。 */
  announce: TouTouSignal | null;
  /** 气泡是否可见（signal 消失即视为不可见，不需要再 setState）。 */
  tipVisible: boolean;
  mutedCount: number;
  /** 用户关掉/等它自动消失：记一次忽略（连续 3 次降级）。 */
  onTipDismiss: () => void;
  /** 用户点了建议的动作：记一次采用（连续忽略清零）。 */
  onTipEngage: () => void;
  /** 这类别再提示。 */
  onMute: (kind: string) => void;
  /** 恢复所有被静音的类别（面板里的可撤销入口）。 */
  onRestoreMuted: () => void;
}

function loadInitialState(): TouTouInterventionState {
  return readInterventionState();
}

export function useTouTouIntervention(signals: readonly TouTouSignal[]): TouTouInterventionApi {
  const [state, setState] = useState<TouTouInterventionState>(loadInitialState);
  const [tipVisible, setTipVisible] = useState(false);

  const update = useCallback(
    (updater: (current: TouTouInterventionState) => TouTouInterventionState) => {
      setState((current) => {
        const next = updater(current);
        writeInterventionState(next);
        return next;
      });
    },
    [],
  );

  const visibleSignals = useMemo(
    () => signals.filter((signal) => !isKindMuted(state, signal.kind)),
    [signals, state],
  );

  const announce =
    visibleSignals.find((signal) => signal.announce !== false && canAnnounce(state, signal.kind)) ??
    null;

  const announceId = announce?.id ?? "";
  const announceKind = announce?.kind ?? "";

  // 新的一条可播信号出现：延迟 TIP_DELAY_MS 后出气泡并记一次"已播"。
  useEffect(() => {
    if (!announceId || !announceKind) return;
    const kind = announceKind;
    const timer = window.setTimeout(() => {
      setTipVisible(true);
      update((current) => recordAnnounced(current, kind));
    }, TIP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [announceId, announceKind, update]);

  // 气泡自动隐藏 = 用户没理它：记一次忽略（连续忽略 3 次后降级为只 pulse）。
  useEffect(() => {
    if (!tipVisible) return;
    const timer = window.setTimeout(() => {
      setTipVisible(false);
      update(recordIgnored);
    }, TIP_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [tipVisible, update]);

  const onTipDismiss = useCallback(() => {
    setTipVisible(false);
    update(recordIgnored);
  }, [update]);

  const onTipEngage = useCallback(() => {
    setTipVisible(false);
    update(recordEngaged);
  }, [update]);

  const onMute = useCallback(
    (kind: string) => {
      setTipVisible(false);
      update((current) => muteKind(current, kind));
    },
    [update],
  );

  const onRestoreMuted = useCallback(() => {
    update(restoreIntervention);
  }, [update]);

  return {
    signals: visibleSignals,
    announce,
    tipVisible: tipVisible && announce !== null,
    mutedCount: Object.keys(state.mutedKinds).length,
    onTipDismiss,
    onTipEngage,
    onMute,
    onRestoreMuted,
  };
}
