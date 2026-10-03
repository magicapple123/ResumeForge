/** 大模型配置表单：预设、连接测试、获取可用模型、思考模式与高级调整。 */

import { ApiOutlined, CloudDownloadOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Slider,
  Space,
  Tooltip,
} from "antd";
import type { FormInstance } from "antd/es/form";
import { useState } from "react";
import type { LLMModelsResult, LLMTestResult, LLMThinkingResult } from "../../types";
import { CUSTOM_EFFORT_OPTION } from "../../types/assistant";
import ApiKeyInput from "./ApiKeyInput";
import { AdvancedParamsSection } from "./llm/AdvancedParamsSection";
import { ModelPickerModal } from "./llm/ModelPickerModal";
import { EFFORT_LABELS, FALLBACK_EFFORTS } from "./llm/thinkingMeta";
import { ThinkingSection } from "./llm/ThinkingSection";
import { useUnlimitedTokens } from "./llm/useUnlimitedTokens";
import {
  MAX_MAX_TOKENS,
  MIN_MAX_TOKENS,
  PRESET_OPTIONS,
  type SettingsFormValues,
} from "./SettingsConfig";

interface Props {
  form: FormInstance<SettingsFormValues>;
  editing: boolean;
  saving: boolean;
  testing: boolean;
  testResult: LLMTestResult | null;
  apiKeyResetToken: number;
  onPresetChange: (provider: string) => void;
  onResetApiKey: () => void;
  onRevealApiKey: () => Promise<string>;
  onRevealError: (message: string) => void;
  onTest: () => void;
  /** 拉取服务商当前可用的模型列表（失败时由 result.message 说明原因）。 */
  onFetchModels: () => Promise<LLMModelsResult>;
  /** 查思考支持：probe=true 会真的发一次最小请求，用来分辨"生效/被忽略/被拒绝"。 */
  onCheckThinking: (probe: boolean) => Promise<LLMThinkingResult>;
}

export default function LLMConfigCard({
  form,
  editing,
  saving,
  testing,
  testResult,
  apiKeyResetToken,
  onPresetChange,
  onResetApiKey,
  onRevealApiKey,
  onRevealError,
  onTest,
  onFetchModels,
  onCheckThinking,
}: Props) {
  const thinkingEnabled = Form.useWatch("thinking_enabled", form);
  const thinkingEffort: string = Form.useWatch("thinking_effort", form) ?? "";
  const { unlimitedTokens, setUnlimitedTokens } = useUnlimitedTokens(form);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelsMessage, setModelsMessage] = useState("");
  const [thinkingResult, setThinkingResult] = useState<LLMThinkingResult | null>(null);
  const [checkingThinking, setCheckingThinking] = useState(false);
  const [customEffort, setCustomEffort] = useState(false);

  const thinkingEfforts = thinkingResult?.efforts?.length
    ? thinkingResult.efforts
    : FALLBACK_EFFORTS;
  const effortOptions = [
    { value: "", label: "默认档位（不指定）" },
    ...thinkingEfforts.map((effort) => ({
      value: effort,
      label: EFFORT_LABELS[effort] ? `${EFFORT_LABELS[effort]}（${effort}）` : effort,
    })),
  ];

  /**
   * 是否显示"自定义输入框"。
   *
   * **派生**而不是用 state 同步：载入的配置里若是一个不在选项里的档位（自定义值，或换过
   * 模型后留下的词），它就该直接落在输入框里——用 effect 去追这个状态会在异步载入时
   * 慢一拍，用户先看到的是一个显示不出来的未知值。
   */
  const showingCustomEffort =
    customEffort ||
    (thinkingEffort.trim() !== "" &&
      thinkingEffort.trim() !== CUSTOM_EFFORT_OPTION &&
      !effortOptions.some((option) => option.value === thinkingEffort.trim()));

  /** 只读后端能力表拿档位选项——**零上游调用**，所以打开开关时就顺手取一次。 */
  const loadThinkingOptions = async () => {
    const result = await onCheckThinking(false);
    setThinkingResult(result);
  };

  /** 实测：会真的发一次最小请求，按钮旁边写明了这一点。 */
  const probeThinking = async () => {
    if (checkingThinking) return;
    setCheckingThinking(true);
    try {
      setThinkingResult(await onCheckThinking(true));
    } finally {
      setCheckingThinking(false);
    }
  };

  const fetchModels = async () => {
    if (fetchingModels) return;
    setFetchingModels(true);
    try {
      const result = await onFetchModels();
      setModelsMessage(result.message);
      if (result.models.length > 0) {
        setModelOptions(result.models);
        setModelPickerOpen(true);
      }
    } finally {
      setFetchingModels(false);
    }
  };

  return (
    <Card title="大模型 API 配置" className="settings-card">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="默认支持所有兼容 OpenAI Chat Completions 协议的模型服务：DeepSeek、豆包（火山方舟）、Kimi、通义千问、智谱、MiniMax、硅基流动、OpenRouter、OpenAI、Gemini、Ollama 等；把「接口协议」切到 Anthropic 原生后也可以直连 Claude。API Key 保存在本地数据库中，仅本机可访问。"
      />
      <Form
        form={form}
        layout="vertical"
        disabled={!editing || saving || testing}
        onValuesChange={(changedValues) => {
          if ("base_url" in changedValues) onResetApiKey();
          // 换了端点/模型/协议，上一次的检测结论就不再适用——清掉比留着误导好。
          if (
            "base_url" in changedValues ||
            "model" in changedValues ||
            "api_style" in changedValues
          ) {
            setThinkingResult(null);
          }
          // 打开开关时顺手取一次档位（只读后端能力表，零上游调用）。
          if ("thinking_enabled" in changedValues && changedValues.thinking_enabled) {
            void loadThinkingOptions();
          }
          // 下拉里选了「自定义…」：把哨兵值从字段里清掉，换成输入框。
          if (changedValues.thinking_effort === CUSTOM_EFFORT_OPTION) {
            setCustomEffort(true);
            form.setFieldValue("thinking_effort", "");
          }
        }}
      >
        <Form.Item name="provider" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="preset" label="快速预设（选择后自动填充 Base URL 与模型名）">
          <Select
            options={PRESET_OPTIONS}
            onChange={onPresetChange}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>
        <Form.Item
          name="api_style"
          label="接口协议"
          tooltip="多数服务商（含 Claude 的 OpenAI 兼容层）走 Chat Completions，选「OpenAI 兼容」。只有要用 Claude 原生 Messages 协议（支持扩展思考、独立 system 字段）时才选 Anthropic 原生——此时 Base URL 填 https://api.anthropic.com/v1（本应用会在后面接 /messages）。"
        >
          <Select
            options={[
              { value: "openai", label: "OpenAI 兼容（Chat Completions）" },
              { value: "anthropic", label: "Anthropic 原生（Messages）" },
            ]}
          />
        </Form.Item>
        <Row gutter={[16, 0]}>
          <Col xs={24} lg={16}>
            <Form.Item
              name="base_url"
              label="Base URL"
              rules={[{ required: true, message: "必填" }]}
              tooltip="服务地址，通常形如 https://api.xxx.com 或 https://api.xxx.com/v1"
            >
              <Input placeholder="https://api.deepseek.com" />
            </Form.Item>
          </Col>
          <Col xs={24} lg={8}>
            {/* addonAfter 已废弃（v6）：按官方指引改为 Space.Compact。拆成外层无 name 的
                Form.Item（只管 label/tooltip）+ 内层 noStyle Form.Item（把 value 与 id="model"
                注回输入框），并用 htmlFor 把 label 重新指回输入框——否则 id 会落在
                Space.Compact 的 div 上，getByLabelText("模型名称") 就找不到输入框了。 */}
            <Form.Item
              label="模型名称"
              htmlFor="model"
              tooltip="各厂商模型名不同：可以点输入框右侧的「获取可用模型」按当前账号拉取，也可以照官方文档手填"
            >
              <Space.Compact block>
                <Form.Item name="model" noStyle>
                  <Input placeholder="deepseek-v4-flash" />
                </Form.Item>
                <Button
                  type="text"
                  size="small"
                  className="llm-fetch-models-button"
                  icon={<CloudDownloadOutlined />}
                  loading={fetchingModels}
                  onClick={() => void fetchModels()}
                >
                  获取可用模型
                </Button>
              </Space.Compact>
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          name="api_key"
          label="API Key（选填）"
          tooltip="多数云模型服务需要填写；Ollama 等无需鉴权的本地兼容服务可留空。点击眼睛时才会从本机后端临时读取已保存密钥，隐藏后立即清除显示值。"
        >
          <ApiKeyInput
            editing={editing}
            disabled={saving || testing}
            resetToken={apiKeyResetToken}
            onReveal={onRevealApiKey}
            onRevealError={onRevealError}
          />
        </Form.Item>
        <Row gutter={[16, 0]}>
          <Col xs={24} md={8}>
            <Form.Item
              name="temperature"
              label="创意度 temperature"
              tooltip="控制输出的随机性。值越低越稳定，适合事实型简历；值越高表达更发散，也会增加内容不一致或虚构风险。"
            >
              <Slider min={0} max={2} step={0.1} marks={{ 0: "严谨", 1: "均衡", 2: "发散" }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name="timeout_seconds"
              label="超时时间（秒）"
              tooltip="等待模型返回响应数据的最长时间；超过后请求会终止。网络较慢或生成内容较长时可适当调大，但调大不会让模型生成得更快。"
            >
              <InputNumber min={10} max={600} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name="max_tokens"
              label="最大输出 Token"
              tooltip="限制模型单次回复的最大输出 Token 数。值越大可能增加费用；过小可能导致内容被截断。它不是模型的上下文长度上限。勾选「不限制」后不再发送该参数，改由服务商决定上限，但并非真的无限——部分服务商的默认值可能比手动设置的值更小。"
            >
              <InputNumber
                min={MIN_MAX_TOKENS}
                max={MAX_MAX_TOKENS}
                step={512}
                // 要传 undefined 而不是 false：antd 只在 prop 为 null/undefined 时
                // 才回退到 Form 的 disabled 上下文，传 false 会让非编辑态也能改。
                disabled={unlimitedTokens ? true : undefined}
                style={{ width: "100%" }}
              />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              {/* 这一条的行为与直觉相反（"不限制"其实取决于服务商默认值，可能比手填的还小），
                  而那段解释原本只挂在上面那个数字输入框的 tooltip 里，勾选框自己不说。 */}
              <Tooltip title="勾选后不再发送 max_tokens，由服务商决定上限。可缓解推理模型把思考过程算进输出预算、正文被挤空的问题；但它不是真的无限——部分服务商的默认值可能比手动设置的值更小。">
                <Checkbox
                  checked={unlimitedTokens}
                  onChange={(event) => setUnlimitedTokens(event.target.checked)}
                >
                  不限制（由服务商决定上限）
                </Checkbox>
              </Tooltip>
            </Form.Item>
          </Col>
        </Row>

        <ThinkingSection
          thinkingEnabled={thinkingEnabled}
          thinkingEffort={thinkingEffort}
          showingCustomEffort={showingCustomEffort}
          effortOptions={effortOptions}
          checkingThinking={checkingThinking}
          thinkingResult={thinkingResult}
          saving={saving}
          testing={testing}
          onProbe={probeThinking}
          onBackToPresets={() => {
            setCustomEffort(false);
            form.setFieldValue("thinking_effort", "");
          }}
        />

        <Button
          type="link"
          className="llm-advanced-toggle"
          onClick={() => setAdvancedOpen((current) => !current)}
        >
          {advancedOpen
            ? "收起高级调整"
            : "高级调整（Top P / Top K、惩罚项、随机种子、停止词、思考参数形态）"}
        </Button>
        {advancedOpen && <AdvancedParamsSection />}
      </Form>
      <Button icon={<ApiOutlined />} loading={testing} disabled={saving} onClick={onTest}>
        测试连接
      </Button>
      {testResult && (
        <Alert
          style={{ marginTop: 16 }}
          type={testResult.ok ? "success" : "error"}
          showIcon
          title={
            testResult.ok
              ? `${testResult.message}（耗时 ${testResult.latency_ms}ms）`
              : `连接失败：${testResult.message}`
          }
        />
      )}
      <ModelPickerModal
        open={modelPickerOpen}
        modelsMessage={modelsMessage}
        modelOptions={modelOptions}
        onPick={(model) => {
          form.setFieldValue("model", model);
        }}
        onClose={() => setModelPickerOpen(false)}
      />
    </Card>
  );
}
