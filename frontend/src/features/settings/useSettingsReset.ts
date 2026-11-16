// SPDX-License-Identifier: Apache-2.0
/**
 * 设置项的「恢复默认」（I-10）——前端这一侧的唯一实现。
 *
 * ## 为什么分成 hook + 按钮两层
 *
 * - hook 负责**取数与写回**（`GET /settings/reset-targets`、`POST /settings/reset`），
 *   卡片只需要 `resetScope("model")` 或 `resetKeys([...])` 一次调用；
 * - 按钮负责**二次确认**与文案。两者分开，卡片级、字段级、全局快照三种入口复用同一份
 *   逻辑，不会出现"三个地方各拼一次请求体"。
 *
 * ## 红线：密钥不参与
 *
 * 能不能重置由后端 `settings_defaults` 决定（`resettable=False` 的键根本不出现在
 * `/reset-targets` 里）。前端**不做**第二套判断——多一套判断只会多一种不一致。
 */
import { useCallback, useEffect, useState } from "react";
import { request } from "../../api/client";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export interface ResetTarget {
  key: string;
  scope: string;
  kind: string;
  storage: string;
  default: unknown;
  current: unknown;
  is_default: boolean;
}

export interface ResetResult {
  reset: { key: string; scope: string; before: unknown; after: unknown }[];
  skipped: string[];
  dataset_scoped: boolean;
}

export interface SettingsSnapshot {
  version: number;
  values: Record<string, unknown>;
  exported_at?: string;
}

/** 取可重置项（密钥键不在其中）。 */
export async function fetchResetTargets(): Promise<{
  scopes: string[];
  entries: ResetTarget[];
}> {
  return request("/settings/reset-targets");
}

/** 按作用域或按键恢复默认（两者二选一，后端会 422 拒绝同时给）。 */
export async function resetSettings(payload: {
  scope?: string;
  keys?: string[];
}): Promise<ResetResult> {
  return request("/settings/reset", { method: "POST", body: JSON.stringify(payload) });
}

/** 导出快照（**不含密钥**，后端负责过滤）。 */
export async function exportSettingsSnapshot(): Promise<SettingsSnapshot> {
  return request("/settings/snapshot");
}

/** 从快照恢复（白名单校验在后端，前端不做"看起来对就写"）。 */
export async function importSettingsSnapshot(snapshot: SettingsSnapshot): Promise<ResetResult> {
  return request("/settings/snapshot", { method: "POST", body: JSON.stringify(snapshot) });
}

export interface SettingsResetApi {
  /** 可重置项（未加载完是空数组）。 */
  targets: ResetTarget[];
  /** 可用的作用域名（卡片名），用于"按卡片恢复"。 */
  scopes: string[];
  loading: boolean;
  /** 某个作用域下还有多少项不是默认值——决定按钮要不要显示"已改过"。 */
  customizedCount: (scope: string) => number;
  resetScope: (scope: string) => Promise<ResetResult | null>;
  resetKeys: (keys: string[]) => Promise<ResetResult | null>;
  reload: () => Promise<void>;
}

/**
 * 设置项恢复默认。
 *
 * `onDone` 在成功后被调用：让卡片自己重新取数（卡片知道自己该刷什么，hook 不该替它猜）。
 */
export function useSettingsReset(onDone?: (result: ResetResult) => void): SettingsResetApi {
  useLocale();
  const [targets, setTargets] = useState<ResetTarget[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchResetTargets();
      setTargets(data.entries);
      setScopes(data.scopes);
    } catch {
      // 取不到就保持空：按钮据此隐藏，而不是弹一个用户无法处理的错误。
      setTargets([]);
      setScopes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const customizedCount = useCallback(
    (scope: string) => targets.filter((item) => item.scope === scope && !item.is_default).length,
    [targets],
  );

  const run = useCallback(
    async (payload: { scope?: string; keys?: string[] }): Promise<ResetResult | null> => {
      try {
        const result = await resetSettings(payload);
        await reload();
        onDone?.(result);
        return result;
      } catch {
        return null;
      }
    },
    [onDone, reload],
  );

  return {
    targets,
    scopes,
    loading,
    customizedCount,
    resetScope: (scope) => run({ scope }),
    resetKeys: (keys) => run({ keys }),
    reload,
  };
}

/** 成功后的统一提示文案（"已恢复 N 项"），三处入口共用。 */
export function resetDoneMessage(result: ResetResult): string {
  return t("settingsReset.done", { count: result.reset.length });
}
