/** 设置页的大模型配置域 hook：当前配置/记录的加载、「使用」切换与删除。
 *
 * 设置页合并为单区块后，表单与新增/编辑弹窗归 useLLMRecordTools，本 hook 只管
 * 「哪条记录正在生效」：activeRecordId 由当前配置与记录的逐字段比对得出，
 * configSummary 仅在生效配置未来自任何记录时用于引导文案。
 */
import { App } from "antd";
import { useEffect, useState } from "react";
import {
  deleteLLMConfigRecord,
  getLLMConfig,
  listLLMConfigRecords,
  saveLLMConfig,
} from "../../api/settings";
import {
  configFromRecord,
  sameConfig,
  summaryFromConfig,
  type LLMConfigSummary,
} from "../../components/settings/SettingsConfig";
import type { LLMConfigRecord } from "../../types";

export function useLLMSettings() {
  const { message } = App.useApp();
  const [records, setRecords] = useState<LLMConfigRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [activeRecordId, setActiveRecordId] = useState<number | null>(null);
  const [recordApplyingId, setRecordApplyingId] = useState<number | null>(null);
  const [recordDeletingId, setRecordDeletingId] = useState<number | null>(null);
  /** 当前生效配置的折叠摘要（脱敏：只带"是否配置了密钥"，不带密钥本体）。 */
  const [configSummary, setConfigSummary] = useState<LLMConfigSummary | null>(null);

  // 同时加载当前配置与记录，避免页面先显示一套配置、稍后又跳变到另一套状态。
  // recordsLoading 初始即 true（useState），effect 无需同步置位——Compiler 禁止
  // effect 体内同步 setState。
  useEffect(() => {
    void Promise.all([getLLMConfig(), listLLMConfigRecords()])
      .then(([config, loadedRecords]) => {
        setRecords(loadedRecords);
        setActiveRecordId(loadedRecords.find((record) => sameConfig(record, config))?.id ?? null);
        setConfigSummary(summaryFromConfig(config));
      })
      .catch((err) => message.error(err instanceof Error ? err.message : "加载配置失败"))
      .finally(() => setRecordsLoading(false));
  }, [message]);

  /** 「使用」= 把该记录应用到当前生效配置（整份替换语义的 PUT /settings/llm）。 */
  const applyRecord = async (record: LLMConfigRecord) => {
    if (recordApplyingId !== null) return;
    setRecordApplyingId(record.id);
    try {
      const saved = await saveLLMConfig(configFromRecord(record));
      setActiveRecordId(record.id);
      setConfigSummary(summaryFromConfig(saved));
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
        // 当前生效配置与记录互相独立：删除记录不影响生效内容，但摘要要刷新，
        // 避免继续展示已删除记录的密钥引用形态。
        try {
          const currentConfig = await getLLMConfig();
          setConfigSummary(summaryFromConfig(currentConfig));
        } catch (refreshError) {
          setConfigSummary(null);
          message.warning(
            refreshError instanceof Error
              ? `配置记录已删除，但当前配置刷新失败：${refreshError.message}`
              : "配置记录已删除，但当前配置刷新失败",
          );
        }
        setActiveRecordId(null);
      }
      message.success("配置记录已删除");
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
