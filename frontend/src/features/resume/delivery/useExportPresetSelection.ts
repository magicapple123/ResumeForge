// SPDX-License-Identifier: Apache-2.0
/**
 * Export-preset selection and save/delete actions of the delivery export modal.
 * Split out of `./ExportConfigModal.tsx` to keep both files under the line budget;
 * pure move, no behaviour change.
 */
import { App } from "antd";
import { useState } from "react";
import { t } from "../../../i18n";
import type { useExportBundle } from "./useExportBundle";
import type { useExportPresets } from "./useExportPresets";

interface Options {
  presets: ReturnType<typeof useExportPresets>;
  bundle: ReturnType<typeof useExportBundle>;
  message: ReturnType<typeof App.useApp>["message"];
  /** Whether the config passes `validatePresetConfig` (else saving is refused). */
  issuesOk: boolean;
}

export function useExportPresetSelection({ presets, bundle, message, issuesOk }: Options) {
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null);
  const [presetName, setPresetName] = useState("");
  const [presetDefault, setPresetDefault] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);

  const selectedPreset = presets.presets.find((preset) => preset.id === selectedPresetId) ?? null;

  const choosePreset = (presetId: number | null) => {
    setSelectedPresetId(presetId);
    bundle.applyPreset(presets.presets.find((preset) => preset.id === presetId) ?? null);
  };

  const savePreset = async () => {
    if (savingPreset) return;
    if (!presetName.trim()) {
      message.warning(t("delivery.config.presetNameRequired"));
      return;
    }
    if (!issuesOk) return;
    setSavingPreset(true);
    try {
      const saved = await presets.savePreset(
        {
          name: presetName.trim(),
          // 导出形式是这次操作的开关，不是预设的一部分（读回时也不恢复），不写进预设。
          config: { ...bundle.config, mode: undefined },
          is_default: presetDefault,
        },
        selectedPresetId ?? undefined,
      );
      setSelectedPresetId(saved.id);
      setPresetName("");
      setPresetDefault(false);
      message.success(t("delivery.config.presetSaved"));
    } catch {
      message.error(t("delivery.config.presetSaveFailed"));
    } finally {
      setSavingPreset(false);
    }
  };

  const removePreset = async () => {
    if (selectedPresetId === null) return;
    try {
      await presets.deletePreset(selectedPresetId);
      setSelectedPresetId(null);
      message.success(t("delivery.config.presetDeleted"));
    } catch {
      message.error(t("delivery.config.presetSaveFailed"));
    }
  };

  return {
    selectedPresetId,
    presetName,
    setPresetName,
    presetDefault,
    setPresetDefault,
    savingPreset,
    selectedPreset,
    choosePreset,
    savePreset,
    removePreset,
  };
}
