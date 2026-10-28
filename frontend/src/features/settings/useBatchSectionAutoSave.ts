// SPDX-License-Identifier: Apache-2.0
/**
 * 批量操作某一节的「改动即保存」。
 *
 * 设置卡不再有保存按钮：Select / Switch 这类离散改动 500ms 合并一次后自动 PUT，
 * 文本输入也走同一条（连续打字不会每键一次请求）。
 *
 * **首次打开且该节未配置**时用当前默认值启用一次：否则"只想用默认值"的用户会被守卫
 * 反复引导去设置，却永远没有可点的保存按钮。启用后状态显示"已自动保存"。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  saveBatchExportConfig,
  saveBatchGenerationConfig,
  type BatchExportConfig,
  type BatchGenerationConfig,
  type BatchSection,
  type SectionMeta,
} from "../../api/settingsBatch";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

type SectionConfig = BatchGenerationConfig | BatchExportConfig;
type ConfigFields<T> = Omit<T, keyof SectionMeta>;

const SAVE_DELAY_MS = 500;

export function useBatchSectionAutoSave<T extends SectionConfig & SectionMeta>(
  kind: BatchSection,
  initial: T,
) {
  const [draft, setDraft] = useState<T>(initial);
  const [status, setStatus] = useState<AutoSaveStatus>(initial.configured ? "saved" : "idle");
  const timer = useRef<number | null>(null);
  const alive = useRef(true);

  const persist = useCallback(
    async (value: T) => {
      // 只把可配置字段发回服务端（configured / updated_at 是服务端元信息）。
      const payload = { ...value } as Record<string, unknown>;
      delete payload.configured;
      delete payload.updated_at;
      setStatus("saving");
      try {
        const saved =
          kind === "generation"
            ? await saveBatchGenerationConfig(payload as unknown as BatchGenerationConfig)
            : await saveBatchExportConfig(payload as unknown as BatchExportConfig);
        if (!alive.current) return;
        setDraft(saved as T);
        setStatus("saved");
      } catch {
        if (alive.current) setStatus("error");
      }
    },
    [kind],
  );

  const schedule = useCallback(
    (value: T) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void persist(value);
      }, SAVE_DELAY_MS);
    },
    [persist],
  );

  const update = useCallback(
    <K extends keyof ConfigFields<T>>(key: K, value: ConfigFields<T>[K]) => {
      setDraft((previous) => {
        const next = { ...previous, [key]: value } as T;
        schedule(next);
        return next;
      });
    },
    [schedule],
  );

  // 首次进入：未配置就用默认值启用（只跑一次，`initial` 是父层读到的稳定快照）。
  useEffect(() => {
    alive.current = true;
    // 放到下一拍再发请求：mount 阶段同步 setState 会触发一次级联渲染（也是 lint 规则
    // `set-state-in-effect` 的判据），而这批请求不急着在首帧之前发出。
    const kickoff = window.setTimeout(() => {
      if (alive.current && !initial.configured) void persist(initial);
    }, 0);
    return () => {
      alive.current = false;
      window.clearTimeout(kickoff);
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [initial, persist]);

  return { draft, status, update };
}
