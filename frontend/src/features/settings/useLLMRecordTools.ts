/** 配置记录的卡上动作与新增/编辑共用弹窗（同名 upsert 保存）。
 *
 * 「新增配置」与记录卡「编辑」走同一个 Modal、同一份表单（RecordFormValues）：
 * 新增保存后**不自动生效**（仅供切换），编辑保存只改记录本身——若编辑的是使用中的
 * 那条，由调用方（SettingsPage）在拿到返回值后同步当前生效配置。
 */
import { App, Form } from "antd";
import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { checkLLMThinking, saveLLMConfigRecord, testLLM, listLLMModels } from "../../api/settings";
import { LLM_PRESETS } from "../../config";
import type {
  LLMConfig,
  LLMConfigRecord,
  LLMModelsResult,
  LLMTestResult,
  LLMThinkingResult,
} from "../../types";
import type { LLMApiStyle } from "../../types/settings";
import { CUSTOM_EFFORT_OPTION } from "../../types/assistant";
import {
  CUSTOM_PRESET,
  MANUAL_PRESET,
  UNLIMITED_MAX_TOKENS,
  configFromRecord,
  matchingPreset,
} from "../../components/settings/SettingsConfig";
import { EFFORT_LABELS, FALLBACK_EFFORTS } from "../../components/settings/llm/thinkingMeta";

/** 新增/编辑共用弹窗的表单值。api_key 留空 = 保持原密钥（原样回传脱敏引用）。
 *
 * 高级/思考字段与旧页面表单同一套：「留空 = 不发送」（null），弹窗里只是换了容器，
 * 交互与校验语义原样保留。extra_body 刻意**不在**表单里——它一直是长尾参数出口，
 * 编辑时从原记录展开原样带过（见 mergedConfigFromForm）。
 */
export interface RecordFormValues {
  /** 仅新增态可填；编辑态用记录自身的 name（同名 upsert 的键）。 */
  name: string;
  /** 前端专用：快速预设选择项，选中后由 applyRecordPreset 填充接口字段。 */
  preset: string;
  provider: string;
  api_style: LLMApiStyle;
  base_url: string;
  model: string;
  api_key: string;
  temperature: number;
  timeout_seconds: number;
  max_tokens: number;
  top_p: number | null;
  frequency_penalty: number | null;
  presence_penalty: number | null;
  seed: number | null;
  top_k: number | null;
  repetition_penalty: number | null;
  stop: string[];
  thinking_budget: number | null;
  thinking_enabled: boolean;
  thinking_effort: string;
  thinking_style: LLMConfig["thinking_style"];
}

/** 新增时的表单默认值：与后端 LLMConfig 默认一致（高级参数 null = 不发送）。 */
function createDefaults(): RecordFormValues {
  return {
    name: "",
    preset: CUSTOM_PRESET,
    provider: "custom",
    api_style: "openai",
    base_url: "",
    model: "",
    api_key: "",
    temperature: 0.1,
    timeout_seconds: 120,
    max_tokens: UNLIMITED_MAX_TOKENS,
    top_p: null,
    frequency_penalty: null,
    presence_penalty: null,
    seed: null,
    top_k: null,
    repetition_penalty: null,
    stop: [],
    thinking_budget: null,
    thinking_enabled: false,
    thinking_effort: "",
    thinking_style: "auto",
  };
}

/** 新增时落在记录里的完整 LLMConfig：高级/思考字段全部取「不发送」默认。 */
function createDefaultConfig(): LLMConfig {
  return {
    provider: "custom",
    base_url: "",
    api_key: "",
    model: "",
    temperature: 0.1,
    timeout_seconds: 120,
    max_tokens: UNLIMITED_MAX_TOKENS,
    api_style: "openai",
    top_p: null,
    frequency_penalty: null,
    presence_penalty: null,
    seed: null,
    top_k: null,
    repetition_penalty: null,
    stop: [],
    thinking_budget: null,
    thinking_enabled: false,
    thinking_effort: "",
    thinking_style: "auto",
    extra_body: {},
  };
}

/**
 * 表单值合并成完整 LLMConfig。编辑时从原记录展开（保证 extra_body 等弹窗里没有的字段
 * 原样保留——记录接口同样是整份替换语义），api_key 留空则沿用原记录的脱敏引用。
 */
function mergedConfigFromForm(values: RecordFormValues, record: LLMConfigRecord | null): LLMConfig {
  const base = record ? configFromRecord(record) : createDefaultConfig();
  const typedKey = values.api_key.trim();
  return {
    ...base,
    provider: values.provider || base.provider,
    api_style: values.api_style,
    base_url: values.base_url.trim(),
    model: values.model.trim(),
    temperature: values.temperature,
    timeout_seconds: values.timeout_seconds,
    max_tokens: values.max_tokens,
    api_key: record && typedKey === "" ? record.api_key : typedKey,
    // 高级/思考字段按「表单里有没有真的返回」逐个覆盖：折叠态下高级区的 Form.Item
    // 不挂载，validateFields 不会返回这些键——不能拿「不发送」默认值覆盖原记录。
    ...pickRegistered(values),
  };
}

/** 高级/思考字段的表单归一化（InputNumber 留空 = undefined → 不发送）。 */
function normalizedAdvanced(values: RecordFormValues): Record<string, unknown> {
  return {
    top_p: values.top_p ?? null,
    frequency_penalty: values.frequency_penalty ?? null,
    presence_penalty: values.presence_penalty ?? null,
    seed: values.seed ?? null,
    top_k: values.top_k ?? null,
    repetition_penalty: values.repetition_penalty ?? null,
    stop: values.stop ?? [],
    thinking_budget: values.thinking_budget ?? null,
    thinking_enabled: values.thinking_enabled ?? false,
    thinking_effort: values.thinking_effort ?? "",
    thinking_style: values.thinking_style || "auto",
  };
}

/** validateFields 只返回已注册（已挂载）的字段；只挑返回了的键参与覆盖。 */
function pickRegistered(values: RecordFormValues): Record<string, unknown> {
  const normalized = normalizedAdvanced(values);
  return Object.fromEntries(
    Object.entries(normalized).filter(([key]) => key in (values as object)),
  );
}

export function useLLMRecordTools(setRecords: Dispatch<SetStateAction<LLMConfigRecord[]>>) {
  const { message } = App.useApp();
  const [recordTestingId, setRecordTestingId] = useState<string | null>(null);
  const [recordTestResults, setRecordTestResults] = useState<Record<string, LLMTestResult>>({});
  const [recordForm] = Form.useForm<RecordFormValues>();
  /** null = 弹窗关闭；非 null = 编辑该记录；配合 modalOpen 区分新增态。 */
  const [editingRecord, setEditingRecord] = useState<LLMConfigRecord | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [recordSaving, setRecordSaving] = useState(false);
  const [draftTesting, setDraftTesting] = useState(false);
  const [draftTestResult, setDraftTestResult] = useState<LLMTestResult | null>(null);
  // 思考模式检测（弹窗内）：thinkingResult 存最近一次检测结果，customEffort 标记
  // 「自定义…」输入框分支。openCreate/openRecordEdit 打开时统一重置。
  const [checkingThinking, setCheckingThinking] = useState(false);
  const [thinkingResult, setThinkingResult] = useState<LLMThinkingResult | null>(null);
  const [customEffort, setCustomEffort] = useState(false);

  /** 思考强度下拉选项：检测前用兜底档位，检测结果一到就被替换。 */
  const effortOptions = [
    { value: "", label: "默认档位（不指定）" },
    ...(thinkingResult?.efforts?.length ? thinkingResult.efforts : FALLBACK_EFFORTS).map(
      (effort) => ({
        value: effort,
        label: EFFORT_LABELS[effort] ? `${EFFORT_LABELS[effort]}（${effort}）` : effort,
      }),
    ),
  ];

  /** 换了端点/模型/协议，上一次的检测结论就不再适用——清掉比留着误导好。 */
  const clearThinkingResult = useCallback(() => setThinkingResult(null), []);

  /** 下拉里选了「自定义…」：把哨兵值从字段里清掉，换成输入框。 */
  const handleEffortCustom = useCallback(
    (effort: string) => {
      if (effort !== CUSTOM_EFFORT_OPTION) return false;
      setCustomEffort(true);
      recordForm.setFieldValue("thinking_effort", "");
      return true;
    },
    [recordForm],
  );

  /** 回到预设档位：清输入框分支，档位归「默认（不指定）」。 */
  const backToEffortPresets = useCallback(() => {
    setCustomEffort(false);
    recordForm.setFieldValue("thinking_effort", "");
  }, [recordForm]);

  /**
   * 查思考支持：probe=false 只读后端内置能力表（零上游调用，用来出选项）；
   * probe=true 会**真的发一次最小请求**——界面上写明了这一点。错误折算成一条
   * 未探测的结果展示，不让弹窗静默失败。
   */
  const checkThinking = useCallback(
    async (probe: boolean): Promise<LLMThinkingResult> => {
      const values = recordForm.getFieldsValue(true) as RecordFormValues;
      try {
        const result = await checkLLMThinking(mergedConfigFromForm(values, editingRecord), probe);
        setThinkingResult(result);
        return result;
      } catch (err) {
        const failed: LLMThinkingResult = {
          style: "auto",
          efforts: [],
          supported: true,
          note: "",
          probed: false,
          accepted: null,
          reasoning_seen: false,
          message: err instanceof Error ? err.message : "检测思考支持失败",
        };
        setThinkingResult(failed);
        return failed;
      }
    },
    [editingRecord, recordForm],
  );

  /** 实测：会真的发一次最小请求，按钮旁边写明了这一点。 */
  const probeThinking = useCallback(async () => {
    if (checkingThinking) return;
    setCheckingThinking(true);
    try {
      await checkThinking(true);
    } finally {
      setCheckingThinking(false);
    }
  }, [checkThinking, checkingThinking]);

  /** 当前表单里的思考档位值（弹窗两分支共用同一字段名）。 */
  const thinkingEffort: string = Form.useWatch("thinking_effort", recordForm) ?? "";

  /**
   * 是否显示「自定义输入框」。
   *
   * **派生**而不是用 state 同步：编辑预填的档位若是一个不在选项里的值（自定义值，或换过
   * 模型后留下的词），它就该直接落在输入框里——用 effect 去追这个状态会在预填时
   * 慢一拍，用户先看到的是一个显示不出来的未知值。
   */
  const showingCustomEffort =
    customEffort ||
    (thinkingEffort.trim() !== "" &&
      thinkingEffort.trim() !== CUSTOM_EFFORT_OPTION &&
      !effortOptions.some((option) => option.value === thinkingEffort.trim()));

  /** 卡上「测试连接」：用该记录自己的配置发探针，结果只显示在这张卡上。 */
  const testRecord = useCallback(
    async (record: LLMConfigRecord) => {
      if (recordTestingId !== null) return;
      setRecordTestingId(record.id);
      try {
        const result = await testLLM(configFromRecord(record));
        setRecordTestResults((current) => ({ ...current, [record.id]: result }));
      } catch (err) {
        setRecordTestResults((current) => ({
          ...current,
          [record.id]: {
            ok: false,
            latency_ms: null,
            message: err instanceof Error ? err.message : "测试失败",
          },
        }));
      } finally {
        setRecordTestingId(null);
      }
    },
    [recordTestingId],
  );

  /** 打开新增弹窗：从与后端一致的默认值开始填；保存后不自动抢占「使用中」。 */
  const openCreate = useCallback(() => {
    recordForm.resetFields();
    recordForm.setFieldsValue(createDefaults());
    setDraftTestResult(null);
    setThinkingResult(null);
    setCustomEffort(false);
    setEditingRecord(null);
    setModalOpen(true);
  }, [recordForm]);

  /** 打开编辑弹窗：api_key 刻意留空（占位符说明"留空保持不变"），避免把脱敏引用当明文摆出来。
   *  高级/思考字段从原记录整份预填——弹窗只是换了容器，不留空缺省覆盖。 */
  const openRecordEdit = useCallback(
    (record: LLMConfigRecord) => {
      recordForm.setFieldsValue({
        ...createDefaults(),
        ...configFromRecord(record),
        name: record.name,
        preset:
          matchingPreset(record)?.provider ??
          (record.provider === MANUAL_PRESET ? MANUAL_PRESET : CUSTOM_PRESET),
        api_key: "",
      });
      setDraftTestResult(null);
      setThinkingResult(null);
      // 预填的自定义档位（不在兜底/检测结果里的值）由弹窗内的派生逻辑直接落到输入框。
      setCustomEffort(false);
      setEditingRecord(record);
      setModalOpen(true);
    },
    [recordForm],
  );

  const closeRecordModal = useCallback(() => {
    if (!recordSaving) setModalOpen(false);
  }, [recordSaving]);

  /** 快速预设（弹窗内）：自定义保留内容、纯手动清空接口字段，其余按预设填充。 */
  const applyRecordPreset = useCallback(
    (provider: string) => {
      if (provider === CUSTOM_PRESET) {
        // 自定义模式保留当前内容，避免用户误点后丢失已经填写的接口信息。
        recordForm.setFieldValue("provider", CUSTOM_PRESET);
        return;
      }
      // 纯手动配置则是要一套空表单：清掉预设会填的那两项，自己从头填。
      // 不动 API Key——预设本来就不碰它，顺手清掉等于替用户删密钥。
      if (provider === MANUAL_PRESET) {
        recordForm.setFieldsValue({ provider: MANUAL_PRESET, base_url: "", model: "" });
        return;
      }
      const preset = LLM_PRESETS.find((item) => item.provider === provider);
      if (!preset) return;
      // 协议跟着预设走：拿着 Messages 的地址发 Chat Completions 会 404，反之亦然。
      recordForm.setFieldsValue({
        provider: preset.provider,
        base_url: preset.base_url,
        model: preset.model,
        api_style: preset.api_style ?? "openai",
      });
    },
    [recordForm],
  );

  /** 弹窗内「测试连接」：用表单当前值发探针（api_key 留空沿用原记录的脱敏引用）。 */
  const testDraft = useCallback(async () => {
    if (draftTesting) return;
    let values: RecordFormValues;
    try {
      values = await recordForm.validateFields();
    } catch {
      return;
    }
    setDraftTesting(true);
    setDraftTestResult(null);
    try {
      setDraftTestResult(await testLLM(mergedConfigFromForm(values, editingRecord)));
    } catch (err) {
      setDraftTestResult({
        ok: false,
        latency_ms: null,
        message: err instanceof Error ? err.message : "测试失败",
      });
    } finally {
      setDraftTesting(false);
    }
  }, [draftTesting, editingRecord, recordForm]);

  /** 保存弹窗（同名 upsert）：返回保存后的记录，调用方据此决定是否同步生效配置。 */
  const submitRecord = useCallback(async (): Promise<LLMConfigRecord | null> => {
    if (recordSaving) return null;
    let values: RecordFormValues;
    try {
      values = await recordForm.validateFields();
    } catch {
      return null;
    }
    setRecordSaving(true);
    try {
      const name = editingRecord ? editingRecord.name : values.name.trim();
      const saved = await saveLLMConfigRecord({
        name,
        ...mergedConfigFromForm(values, editingRecord),
      });
      setRecords((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setModalOpen(false);
      message.success(
        editingRecord
          ? `配置记录「${saved.name}」已保存`
          : `新配置「${saved.name}」已保存，点记录卡上的「使用」即可生效`,
      );
      return saved;
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存配置记录失败");
      return null;
    } finally {
      setRecordSaving(false);
    }
  }, [editingRecord, message, recordForm, recordSaving, setRecords]);

  /** 留空时携带正在编辑的记录引用，由后端还原密钥；不借用其他生效配置。 */
  const fetchDraftModels = useCallback(async (): Promise<LLMModelsResult> => {
    const values = recordForm.getFieldsValue(true) as RecordFormValues;
    try {
      return await listLLMModels({
        base_url: (values.base_url ?? "").trim(),
        api_key: (values.api_key ?? "").trim() || editingRecord?.api_key || "",
      });
    } catch (err) {
      return {
        models: [],
        message: err instanceof Error ? err.message : "获取模型列表失败",
      };
    }
  }, [editingRecord, recordForm]);

  return {
    recordTestingId,
    recordTestResults,
    testRecord,
    recordForm,
    modalOpen,
    editingRecord,
    recordSaving,
    draftTesting,
    draftTestResult,
    openCreate,
    openRecordEdit,
    closeRecordModal,
    applyRecordPreset,
    testDraft,
    submitRecord,
    fetchDraftModels,
    checkingThinking,
    thinkingResult,
    effortOptions,
    showingCustomEffort,
    clearThinkingResult,
    handleEffortCustom,
    backToEffortPresets,
    probeThinking,
    checkThinking,
  };
}
