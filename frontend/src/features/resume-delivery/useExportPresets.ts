// SPDX-License-Identifier: Apache-2.0
/** 命名导出预设的 CRUD 状态（W19 / D18）。列表/错误态与写操作都在这里，组件不直接调 API。 */
import { useCallback, useEffect, useState } from "react";
import type { ExportDeliveryApi, ExportPresetInput } from "./exportApi";
import { normalizePresetConfig } from "./presets";
import type { ExportPreset, ExportPresetConfig } from "./types";

export interface ExportPresetsState {
  presets: ExportPreset[];
  status: "loading" | "ready" | "error";
  reload: () => void;
  savePreset: (input: ExportPresetInput, id?: number) => Promise<ExportPreset>;
  deletePreset: (id: number) => Promise<void>;
}

export function useExportPresets(api: ExportDeliveryApi): ExportPresetsState {
  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const items = await api.listPresets();
        if (cancelled) return;
        setPresets(items);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [api, reloadToken]);

  const reload = useCallback(() => {
    setStatus("loading");
    setReloadToken((value) => value + 1);
  }, []);

  const savePreset = useCallback(
    async (input: ExportPresetInput, id?: number) => {
      const saved = id ? await api.updatePreset(id, input) : await api.createPreset(input);
      setPresets((previous) => {
        const exists = previous.some((preset) => preset.id === saved.id);
        const next = exists
          ? previous.map((preset) => (preset.id === saved.id ? saved : preset))
          : [...previous, saved];
        // 默认预设全局唯一：服务端保证，这里同步本地列表，避免界面出现两个"默认"。
        return saved.is_default
          ? next.map((preset) =>
              preset.id === saved.id ? preset : { ...preset, is_default: false },
            )
          : next;
      });
      return saved;
    },
    [api],
  );

  const deletePreset = useCallback(
    async (id: number) => {
      await api.deletePreset(id);
      setPresets((previous) => previous.filter((preset) => preset.id !== id));
    },
    [api],
  );

  return { presets, status, reload, savePreset, deletePreset };
}

/** 预设 → 可编辑配置（缺字段按默认补齐；无预设给默认配置）。 */
export function configFromPreset(preset: ExportPreset | null | undefined): ExportPresetConfig {
  return preset ? normalizePresetConfig(preset.config) : normalizePresetConfig(null);
}
