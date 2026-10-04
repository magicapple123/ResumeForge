/** 设置页的大模型配置域 hook：form 实例、保存/测试/编辑态、配置记录增删改查与预设联动。
 *
 * 从 SettingsPage.tsx 的 :51-356 段**整体搬家（不重排）**：依赖数组逐字照抄，
 * collectValues 的 getFieldsValue(true) 折叠字段契约、applyPreset 的 api_style 跟随
 * 注释契约原样保留。form 实例由本 hook 创建并返回，LLMConfigCard 与各 handler
 * 拿到的是同一实例。hook 内的 App.useApp() 处于测试渲染树的 <AntdApp> 之下，
 * 不属于新增调用点。
 */
import { App, Form } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkLLMThinking,
  deleteLLMConfigRecord,
  getLLMConfig,
  listLLMConfigRecords,
  listLLMModels,
  revealLLMApiKey,
  saveLLMConfig,
  saveLLMConfigRecord,
  testLLM,
} from "../../api/settings";
import { LLM_PRESETS } from "../../config";
import {
  API_KEY_MASK,
  CUSTOM_PRESET,
  MANUAL_PRESET,
  configFromFormValues,
  configFromRecord,
  formValuesFromConfig,
  isMaskedApiKey,
  sameConfig,
  type SettingsFormValues,
} from "../../components/settings/SettingsConfig";
import type {
  LLMConfig,
  LLMConfigRecord,
  LLMModelsResult,
  LLMTestResult,
  LLMThinkingResult,
} from "../../types";

export function useLLMSettings() {
  const [form] = Form.useForm<SettingsFormValues>();
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [testResult, setTestResult] = useState<LLMTestResult | null>(null);
  const savedValues = useRef<SettingsFormValues | null>(null);
  const [records, setRecords] = useState<LLMConfigRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [activeRecordId, setActiveRecordId] = useState<number | null>(null);
  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [recordName, setRecordName] = useState("");
  const [recordSaving, setRecordSaving] = useState(false);
  const [recordApplyingId, setRecordApplyingId] = useState<number | null>(null);
  const [recordDeletingId, setRecordDeletingId] = useState<number | null>(null);
  const [apiKeyResetToken, setApiKeyResetToken] = useState(0);

  const resetRevealedApiKey = useCallback(() => setApiKeyResetToken((current) => current + 1), []);

  // 同时加载当前配置与记录，避免页面先显示一套配置、稍后又跳变到另一套状态。
  useEffect(() => {
    setRecordsLoading(true);
    void Promise.all([getLLMConfig(), listLLMConfigRecords()])
      .then(([config, loadedRecords]) => {
        const values = formValuesFromConfig(config);
        form.setFieldsValue(values);
        savedValues.current = values;
        setRecords(loadedRecords);
        setActiveRecordId(loadedRecords.find((record) => sameConfig(record, config))?.id ?? null);
      })
      .catch((err) => message.error(err instanceof Error ? err.message : "加载配置失败"))
      .finally(() => setRecordsLoading(false));
  }, [form, message]);

  const applyPreset = (provider: string) => {
    if (!editing) return;
    // 自定义模式保留当前内容，避免用户误点后丢失已经填写的接口信息。
    if (provider === CUSTOM_PRESET) {
      resetRevealedApiKey();
      form.setFieldValue("provider", CUSTOM_PRESET);
      return;
    }
    // 纯手动配置则是要一套空表单：清掉预设会填的那两项，自己从头填。
    // 不动 API Key——预设本来就不碰它，顺手清掉等于替用户删密钥。
    if (provider === MANUAL_PRESET) {
      resetRevealedApiKey();
      form.setFieldsValue({ provider: MANUAL_PRESET, base_url: "", model: "" });
      return;
    }
    const preset = LLM_PRESETS.find((item) => item.provider === provider);
    if (!preset) return;
    resetRevealedApiKey();
    // 协议跟着预设走。不写这一行的话，从 Claude 原生切到 DeepSeek 会留下
    // `api_style: anthropic` + DeepSeek 地址的组合，请求必失败；反过来选 Claude
    // 预设却不切协议，则会拿 Messages 的地址发 Chat Completions。
    form.setFieldsValue({
      provider: preset.provider,
      base_url: preset.base_url,
      model: preset.model,
      api_style: preset.api_style ?? "openai",
    });
  };

  const revealSavedApiKey = async () => (await revealLLMApiKey()).api_key;

  /** 收集表单值并剔除前端专用的 preset 字段 */
  const collectValues = async (): Promise<LLMConfig | null> => {
    try {
      await form.validateFields();
    } catch {
      return null;
    }
    // 取值用 getFieldsValue(true) 而不是 validateFields() 的返回值：validateFields 只
    // 返回**已注册**的字段，而高级参数所在的区块默认折叠、那些 Form.Item 根本没挂载，
    // extra_body 更是连控件都没有。用它的结果去保存会把用户已经配好的 top_k / 停止词 /
    // extra_body 等一并清空（接口是整份替换语义）。
    const values = form.getFieldsValue(true) as SettingsFormValues;
    return configFromFormValues(values);
  };

  const save = async () => {
    if (!editing || saving || testing) return;
    const values = await collectValues();
    if (!values) return;
    setSaving(true);
    try {
      const saved = await saveLLMConfig(values);
      const nextValues = formValuesFromConfig(saved);
      form.setFieldsValue(nextValues);
      savedValues.current = nextValues;
      setActiveRecordId(records.find((record) => sameConfig(record, saved))?.id ?? null);
      resetRevealedApiKey();
      setEditing(false);
      setTestResult(null);
      message.success("配置已保存，可在下方保存为记录");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  /** 按表单里当前填的 Base URL / API Key 拉取可用模型（失败原因由后端给出）。 */
  const fetchModels = async (): Promise<LLMModelsResult> => {
    const values = form.getFieldsValue(true) as SettingsFormValues;
    try {
      return await listLLMModels({
        base_url: values.base_url ?? "",
        api_key: values.api_key ?? "",
      });
    } catch (err) {
      return {
        models: [],
        message: err instanceof Error ? err.message : "获取模型列表失败",
      };
    }
  };

  /**
   * 查这个模型支持哪种思考形态与哪些强度档位。
   *
   * `probe=false` 只读后端的内置能力表（零上游调用，用来出选项）；`probe=true` 会**真的
   * 发一次最小请求**——上游没有"查询思考能力"的接口，很多服务商对不认识的参数又是静默
   * 忽略的，只有实发一次才能分辨"生效"与"没效果"。
   */
  const checkThinking = async (probe: boolean): Promise<LLMThinkingResult> => {
    const values = form.getFieldsValue(true) as SettingsFormValues;
    try {
      return await checkLLMThinking(configFromFormValues(values), probe);
    } catch (err) {
      return {
        style: "auto",
        efforts: [],
        supported: true,
        note: "",
        probed: false,
        accepted: null,
        reasoning_seen: false,
        message: err instanceof Error ? err.message : "检测思考支持失败",
      };
    }
  };

  const test = async () => {
    if (saving || testing) return;
    const values = await collectValues();
    if (!values) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testLLM(values));
    } catch (err) {
      setTestResult({
        ok: false,
        latency_ms: null,
        message: err instanceof Error ? err.message : "测试失败",
      });
    } finally {
      setTesting(false);
    }
  };

  const openRecordModal = () => {
    if (editing || recordSaving || !savedValues.current) return;
    setRecordName("");
    setRecordModalOpen(true);
  };

  const saveRecord = async () => {
    const name = recordName.trim();
    const saved = savedValues.current;
    if (!name) {
      message.warning("请填写配置记录名称");
      return;
    }
    if (!saved) {
      message.warning("当前配置尚未加载完成");
      return;
    }

    setRecordSaving(true);
    try {
      const record = await saveLLMConfigRecord({ name, ...configFromFormValues(saved) });
      setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
      setActiveRecordId(record.id);
      setRecordModalOpen(false);
      message.success("配置记录已保存");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存配置记录失败");
    } finally {
      setRecordSaving(false);
    }
  };

  const applyRecord = async (record: LLMConfigRecord) => {
    if (editing || saving || testing || recordApplyingId !== null) return;
    resetRevealedApiKey();
    setRecordApplyingId(record.id);
    try {
      const saved = await saveLLMConfig(configFromRecord(record));
      const nextValues = formValuesFromConfig(saved);
      form.setFieldsValue(nextValues);
      savedValues.current = nextValues;
      setActiveRecordId(record.id);
      setTestResult(null);
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
        // The current app setting is independent from its saved record. Reload it
        // so the form no longer keeps a reference to the deleted record's key.
        try {
          const currentConfig = await getLLMConfig();
          const nextValues = formValuesFromConfig(currentConfig);
          form.setFieldsValue(nextValues);
          savedValues.current = nextValues;
        } catch (refreshError) {
          // A failed refresh must still make the stale record reference unusable.
          const currentValues = form.getFieldsValue(true) as SettingsFormValues;
          const nextValues = {
            ...currentValues,
            api_key: isMaskedApiKey(currentValues.api_key) ? API_KEY_MASK : currentValues.api_key,
          };
          form.setFieldsValue(nextValues);
          savedValues.current = nextValues;
          message.warning(
            refreshError instanceof Error
              ? `配置记录已删除，但当前配置刷新失败：${refreshError.message}`
              : "配置记录已删除，但当前配置刷新失败",
          );
        }
        resetRevealedApiKey();
        setActiveRecordId(null);
      }
      message.success("配置记录已删除");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除配置记录失败");
    } finally {
      setRecordDeletingId(null);
    }
  };

  const cancelEditing = () => {
    if (saving || testing) return;
    if (savedValues.current) {
      form.resetFields();
      form.setFieldsValue(savedValues.current);
    }
    setTestResult(null);
    resetRevealedApiKey();
    setEditing(false);
  };

  return {
    form,
    saving,
    testing,
    editing,
    setEditing,
    testResult,
    apiKeyResetToken,
    records,
    recordsLoading,
    activeRecordId,
    recordModalOpen,
    setRecordModalOpen,
    recordName,
    setRecordName,
    recordSaving,
    recordApplyingId,
    recordDeletingId,
    applyPreset,
    revealSavedApiKey,
    save,
    fetchModels,
    checkThinking,
    test,
    openRecordModal,
    saveRecord,
    applyRecord,
    removeRecord,
    cancelEditing,
    resetRevealedApiKey,
  };
}
