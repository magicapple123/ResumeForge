// SPDX-License-Identifier: Apache-2.0
/**
 * 专业视图的**查看类偏好**（D05/D10）：辅助线开关、灰度校样。
 *
 * 为什么允许进 localStorage：它们与文档内容无关，丢了最多是"重新勾一次"；
 * 而正文/裁剪参数这类**文档数据**一律不写 localStorage（AGENTS「偏好可以落
 * localStorage，正文只进 sessionStorage」）。键名带 \`v1\`，形状变化时旧值由
 * `normalizePreferences` 丢弃而不是让界面崩。
 */
import { useCallback, useState } from "react";
import { NO_GUIDES, type GuideFlags, type ProviewPreferences } from "./types";

/** 偏好键（与 `resume.preview.clickEdit` 同一类：只有 UI 偏好）。 */
export const PROVIEW_PREFERENCES_KEY = "resume.proview.preferences.v1";

/** 默认值：辅助线全关、灰度校样关——不打扰"只想改一句话"的用户。 */
export const DEFAULT_PROVIEW_PREFERENCES: ProviewPreferences = {
  guides: NO_GUIDES,
  proof: false,
};

/** 读写 `localStorage` 的最小接口：测试可注入内存实现，不依赖 jsdom 配额。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // 隐私模式 / 配额满：偏好存不下不是功能错误，整段降级为内存态。
    return null;
  }
}

function readFlag(source: Record<string, unknown>, key: string): boolean {
  return source[key] === true;
}

/** 把任意解析结果收口成合法偏好：缺字段取默认、非布尔取 false。 */
export function normalizePreferences(raw: unknown): ProviewPreferences {
  if (!raw || typeof raw !== "object") return DEFAULT_PROVIEW_PREFERENCES;
  const record = raw as Record<string, unknown>;
  const guidesRaw =
    record.guides && typeof record.guides === "object"
      ? (record.guides as Record<string, unknown>)
      : {};
  const guides: GuideFlags = {
    margins: readFlag(guidesRaw, "margins"),
    columns: readFlag(guidesRaw, "columns"),
    baselines: readFlag(guidesRaw, "baselines"),
    paragraphs: readFlag(guidesRaw, "paragraphs"),
  };
  return { guides, proof: record.proof === true };
}

/** 读一次持久化偏好；坏 JSON / 无存储时返回默认值。 */
export function readPreferences(
  storage: StorageLike | null = browserStorage(),
): ProviewPreferences {
  if (!storage) return DEFAULT_PROVIEW_PREFERENCES;
  try {
    const raw = storage.getItem(PROVIEW_PREFERENCES_KEY);
    if (!raw) return DEFAULT_PROVIEW_PREFERENCES;
    return normalizePreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_PROVIEW_PREFERENCES;
  }
}

/** 写一次偏好；落盘失败不影响本次会话（调用方仍拿到新 state）。 */
export function writePreferences(
  preferences: ProviewPreferences,
  storage: StorageLike | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(PROVIEW_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // 忽略：存不下不是功能错误。
  }
}

/**
 * 偏好状态。**只在这一层做 localStorage**：消费方（工具条）不碰存储，
 * 测试可以传 `storage` 注入内存实现。
 */
export function useProviewPreferences(storage: StorageLike | null = browserStorage()) {
  const [preferences, setPreferences] = useState<ProviewPreferences>(() =>
    readPreferences(storage),
  );

  const update = useCallback(
    (next: ProviewPreferences) => {
      setPreferences(next);
      writePreferences(next, storage);
    },
    [storage],
  );

  const setGuides = useCallback(
    (guides: GuideFlags) => {
      update({ ...preferences, guides });
    },
    [preferences, update],
  );

  const setProof = useCallback(
    (proof: boolean) => {
      update({ ...preferences, proof });
    },
    [preferences, update],
  );

  const reset = useCallback(() => {
    update(DEFAULT_PROVIEW_PREFERENCES);
  }, [update]);

  return { preferences, setGuides, setProof, reset };
}
