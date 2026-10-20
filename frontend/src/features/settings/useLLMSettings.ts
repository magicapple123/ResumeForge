// SPDX-License-Identifier: Apache-2.0
/** 设置页的大模型配置域 hook：当前配置/记录的加载、「使用」切换与删除。
 *
 * C（全局化）之后，记录与生效配置是**同一份**：`config.record_id` 就是「使用中」的
 * 记录 id，不再靠逐字段比对得出（比对在"只差一个可选参数"时会失配，用户会看到
 * 两条都不高亮）。因此：
 *
 * - `activeRecordId` 直接取 `config.record_id`；
 * - 「使用」调用 `activate`，记录与生效项始终同 id；
 * - `configSummary` 只在 scope=dataset（还没升级为全局）时用于引导文案。
 */
import { App } from "antd";
import { useEffect, useState } from "react";
import { bumpLLMConfig } from "./llmConfigEvents";
import {
  activateLLMRecord,
  deleteLLMConfigRecord,
  getLLMConfig,
  listLLMConfigRecords,
} from "../../api/settings";
import {
  configFromRecord,
  summaryFromConfig,
  type LLMConfigSummary,
} from "../../components/settings/SettingsConfig";
import type { LLMConfigRecord } from "../../types";

export function useLLMSettings() {
  const { message } = App.useApp();
  const [records, setRecords] = useState<LLMConfigRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [recordApplyingId, setRecordApplyingId] = useState<string | null>(null);
  const [recordDeletingId, setRecordDeletingId] = useState<string | null>(null);
  /** 当前生效配置的折叠摘要（脱敏：只带"是否配置了密钥"，不带密钥本体）。 */
  const [configSummary, setConfigSummary] = useState<LLMConfigSummary | null>(null);

  // 同时加载当前配置与记录，避免页面先显示一套配置、稍后又跳变到另一套状态。
  // recordsLoading 初始即 true（useState），effect 无需同步置位——Compiler 禁止
  // effect 体内同步 setState。
  useEffect(() => {
    void Promise.all([getLLMConfig(), listLLMConfigRecords()])
      .then(([config, loadedRecords]) => {
        setRecords(loadedRecords);
        setActiveRecordId(config.record_id ?? null);
        setConfigSummary(summaryFromConfig(config));
      })
      .catch((err) => message.error(err instanceof Error ? err.message : "加载配置失败"))
      .finally(() => setRecordsLoading(false));
  }, [message]);

  /** 「使用」= 把该记录设为全局生效项（后端 activate；所有数据集立刻用它）。 */
  const applyRecord = async (record: LLMConfigRecord) => {
    if (recordApplyingId !== null) return;
    setRecordApplyingId(record.id);
    try {
      const activated = await activateLLMRecord(record.id);
      setActiveRecordId(activated.id);
      setRecords((current) =>
        current.map((item) => ({ ...item, is_active: item.id === activated.id })),
      );
      setConfigSummary(summaryFromConfig(configFromRecord(record)));
      // 页头下拉与这里是两棵独立的子树：不广播的话它要等下一次路由变化才更新。
      bumpLLMConfig();
      message.success(`已切换到配置「${record.name}」`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "切换配置失败");
    } finally {
      setRecordApplyingId(null);
    }
  };

  const removeRecord = async (record: LLMConfigRecord) => {
    if (recordDeletingId !== null || recordApplyingId !== null) return;
    const wasActive = activeRecordId === record.id;
    setRecordDeletingId(record.id);
    try {
      await deleteLLMConfigRecord(record.id);
      setRecords((current) => current.filter((item) => item.id !== record.id));
      if (wasActive) {
        // 删掉使用中的记录：后端会把 active 切到剩下的第一条（或清空）。
        // 重新读一次，让摘要与「使用中」高亮与后端状态一致。
        try {
          const currentConfig = await getLLMConfig();
          setActiveRecordId(currentConfig.record_id ?? null);
          setConfigSummary(summaryFromConfig(currentConfig));
        } catch (refreshError) {
          setConfigSummary(null);
          setActiveRecordId(null);
          message.warning(
            refreshError instanceof Error
              ? `配置记录已删除，但当前配置刷新失败：${refreshError.message}`
              : "配置记录已删除，但当前配置刷新失败",
          );
        }
      }
      message.success("配置记录已删除");
      bumpLLMConfig();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除配置记录失败");
    } finally {
      setRecordDeletingId(null);
    }
  };

  return {
    records,
    setRecords,
    recordsLoading,
    activeRecordId,
    configSummary,
    recordApplyingId,
    recordDeletingId,
    applyRecord,
    removeRecord,
  };
}
