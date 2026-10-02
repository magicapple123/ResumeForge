/** 大模型配置表单：预设、连接测试、获取可用模型、思考模式与高级调整。 */

import { ApiOutlined, CloudDownloadOutlined, ExperimentOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Form,
  Input,
  InputNumber,
  Listy,
  Modal,
  Row,
  Select,
  Slider,
  Space,
  Switch,
  Tooltip,
  Typography,
} from "antd";
import type { FormInstance } from "antd/es/form";
import { useRef, useState } from "react";
import type { LLMModelsResult, LLMTestResult, LLMThinkingResult } from "../../types";
import {
  CUSTOM_EFFORT_OPTION,
  MAX_REASONING_EFFORT_CHARS,
  isValidReasoningEffort,
} from "../../types/assistant";
import ApiKeyInput from "./ApiKeyInput";
import { ListyItem } from "../common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../common/listyPadding";
import {
  DEFAULT_MAX_TOKENS,
  MAX_MAX_TOKENS,
  MIN_MAX_TOKENS,
  PRESET_OPTIONS,
  UNLIMITED_MAX_TOKENS,
  type SettingsFormValues,
} from "./SettingsConfig";

/** 档位的中文名；表里出现的其它取值（各家自定义的）原样显示。 */
const EFFORT_LABELS: Record<string, string> = {
  minimal: "最低",
  low: "低",
  medium: "中",
  high: "高",
};

/**
 * 检测之前先给一份通用档位。
 *
 * 真正的选项来自后端的「检测思考支持」（各家划分不同），这份兜底只是让控件在还没检测时
 * 可用；检测结果一到就被替换。
 */
const FALLBACK_EFFORTS = ["low", "medium", "high"];

/** 「思考强度」的说明：两个分支（下拉 / 自定义输入框）共用同一份文案。 */
const EFFORT_TOOLTIP =
  "档位越高通常越慢也越贵。各家的档位划分不同，选项来自「检测思考支持」；也可以选「自定义…」自己填。" +
  "自定义值原样发给 OpenAI 兼容接口；Claude 原生协议下填写数字＝思考预算 tokens，填其他词按默认档处理。" +
  "留空表示不指定档位。";

const THINKING_STYLE_OPTIONS = [
  { value: "auto", label: "自动（按协议与服务商推断）" },
  { value: "reasoning_effort", label: "reasoning_effort（OpenAI 系）" },
  { value: "thinking_object", label: "thinking 开关（智谱等）" },
  { value: "enable_thinking", label: "enable_thinking（通义 qwen3）" },
  { value: "budget", label: "thinking 预算（Claude 原生）" },
];

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
  const maxTokens = Form.useWatch("max_tokens", form);
  const unlimitedTokens = maxTokens === UNLIMITED_MAX_TOKENS;
  const thinkingEnabled = Form.useWatch("thinking_enabled", form);
  const thinkingEffort: string = Form.useWatch("thinking_effort", form) ?? "";
  // 记住勾选「不限制」之前的值，取消勾选时原样还回去，免得用户重填。
  const lastLimitedTokens = useRef(DEFAULT_MAX_TOKENS);
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

  const thinkingAlertType = () => {
    if (!thinkingResult) return "info" as const;
    if (thinkingResult.reasoning_seen) return "success" as const;
    if (thinkingResult.accepted === false) return "error" as const;
    if (thinkingResult.probed) return "warning" as const;
    return "info" as const;
  };

  const setUnlimitedTokens = (unlimited: boolean) => {
    if (unlimited) {
      // 只在写入 0 之前读取：此时字段里还是用户原本填的有限值。
      const current = form.getFieldValue("max_tokens");
      if (typeof current === "number" && current >= MIN_MAX_TOKENS) {
        lastLimitedTokens.current = current;
      }
    }
    form.setFieldValue("max_tokens", unlimited ? UNLIMITED_MAX_TOKENS : lastLimitedTokens.current);
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

        {/* 思考模式：**只作用于除「求职助手」以外的调用**。助手在它的输入框下方有自己的
            「思考强度」，两者刻意分开——否则"想换个档位试试"会变成一次全局改动。 */}
        <Row gutter={[16, 0]}>
          <Col xs={24} md={8}>
            <Form.Item
              name="thinking_enabled"
              label="思考模式"
              valuePropName="checked"
              tooltip="开启后，除「求职助手」以外的 AI 调用（简历生成、岗位解析、匹配分析等）会请求模型先思考再作答。默认关闭；各家对思考参数的写法与档位都不一样，可以先点右边的按钮检测。"
            >
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            {/* 「下拉 / 自定义输入框」两态共用同一个字段名：**两个分支各自挂 `name`**，
                同一时刻只挂一个。这样字段始终是注册状态——`Form.useWatch` 只会在注册的
                字段上收到"配置异步载入"那次通知，不挂 name 的话载入值永远读不到。 */}
            {showingCustomEffort ? (
              <>
                <Form.Item name="thinking_effort" label="思考强度" tooltip={EFFORT_TOOLTIP}>
                  <Input
                    aria-label="思考强度"
                    maxLength={MAX_REASONING_EFFORT_CHARS}
                    placeholder="如 xhigh / max / 4096"
                    status={isValidReasoningEffort(thinkingEffort) ? undefined : "error"}
                  />
                </Form.Item>
                <Button
                  type="link"
                  size="small"
                  className="llm-thinking-effort-back"
                  onClick={() => {
                    setCustomEffort(false);
                    form.setFieldValue("thinking_effort", "");
                  }}
                >
                  用预设档位
                </Button>
              </>
            ) : (
              <Form.Item name="thinking_effort" label="思考强度" tooltip={EFFORT_TOOLTIP}>
                <Select
                  aria-label="思考强度"
                  options={[...effortOptions, { value: CUSTOM_EFFORT_OPTION, label: "自定义…" }]}
                  disabled={thinkingEnabled ? undefined : true}
                  placeholder="默认档位（不指定）"
                />
              </Form.Item>
            )}
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              label="支持情况"
              tooltip="上游没有「查询思考能力」的接口，所以这里分两步：只读内置表给出候选档位，点按钮则真的发一次最小请求——用来分辨「真的生效 / 被静默忽略 / 被上游拒绝」。"
            >
              <Button
                icon={<ExperimentOutlined />}
                loading={checkingThinking}
                disabled={saving || testing}
                onClick={() => void probeThinking()}
              >
                检测思考支持
              </Button>
            </Form.Item>
          </Col>
        </Row>
        <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          「检测思考支持」会发一次最小请求，计入你的模型用量。思考模式只作用于除「求职助手」以外的
          AI 调用；助手的思考强度在它的输入框下方单独设置。
        </Typography.Text>
        {thinkingResult && (
          <Alert
            type={thinkingAlertType()}
            showIcon
            style={{ marginBottom: 12 }}
            title={thinkingResult.probed ? thinkingResult.message : thinkingResult.note}
            description={
              thinkingResult.probed && thinkingResult.note ? thinkingResult.note : undefined
            }
          />
        )}

        <Button
          type="link"
          className="llm-advanced-toggle"
          onClick={() => setAdvancedOpen((current) => !current)}
        >
          {advancedOpen
            ? "收起高级调整"
            : "高级调整（Top P / Top K、惩罚项、随机种子、停止词、思考参数形态）"}
        </Button>
        {advancedOpen && (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              title="留空的参数不会发送给模型服务，由服务商使用默认值。这些参数并非所有服务商都支持，填写前请先看官方文档。"
            />
            <Row gutter={[16, 0]}>
              <Col xs={24} md={6}>
                <Form.Item
                  name="top_p"
                  label="Top P"
                  tooltip="核采样：只从累计概率达到该值的候选里取词。与 temperature 叠加使用，通常只调其中一个。"
                >
                  <InputNumber
                    min={0}
                    max={1}
                    step={0.05}
                    style={{ width: "100%" }}
                    placeholder="留空 = 不发送"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item
                  name="frequency_penalty"
                  label="频率惩罚"
                  tooltip="-2 到 2。正值降低重复用词，负值鼓励重复。"
                >
                  <InputNumber
                    min={-2}
                    max={2}
                    step={0.1}
                    style={{ width: "100%" }}
                    placeholder="留空 = 不发送"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item
                  name="presence_penalty"
                  label="存在惩罚"
                  tooltip="-2 到 2。正值鼓励谈新话题，负值让模型更贴题。"
                >
                  <InputNumber
                    min={-2}
                    max={2}
                    step={0.1}
                    style={{ width: "100%" }}
                    placeholder="留空 = 不发送"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item
                  name="seed"
                  label="随机种子"
                  tooltip="固定种子后同一请求更容易复现相同输出；是否生效取决于服务商。"
                >
                  <InputNumber
                    min={0}
                    step={1}
                    style={{ width: "100%" }}
                    placeholder="留空 = 不发送"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item
                  name="top_k"
                  label="Top K"
                  tooltip="只在概率最高的 K 个候选里取词。Anthropic 与部分开源模型支持；OpenAI 官方接口会忽略它。"
                >
                  <InputNumber
                    min={0}
                    max={1000}
                    step={1}
                    style={{ width: "100%" }}
                    placeholder="留空 = 不发送"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item
                  name="repetition_penalty"
                  label="重复惩罚"
                  tooltip="大于 1 时抑制重复用词。与「频率惩罚」作用类似但计算方式不同，通常只用其中一个。"
                >
                  <InputNumber
                    min={0}
                    max={2}
                    step={0.05}
                    style={{ width: "100%" }}
                    placeholder="留空 = 不发送"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item
                  name="thinking_budget"
                  label="思考预算"
                  tooltip="Claude 原生协议下的扩展思考 token 预算。填 0 = 明确关闭思考；留空 = 不发送该字段。仅在协议选「Anthropic 原生」时有效。填了它就以上面的「思考模式」开关为准——这是给需要精确控制预算的老用法留的。"
                >
                  <InputNumber
                    min={0}
                    max={100000}
                    step={1024}
                    style={{ width: "100%" }}
                    placeholder="留空 = 不发送"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item
                  name="thinking_style"
                  label="思考参数形态"
                  tooltip="开启思考时请求体里用哪种写法。auto = 按接口协议与服务商自动推断（多数情况选这个）；只有走中转站、自建网关，或「检测思考支持」说参数不被接受时，才需要手动换一种。"
                >
                  <Select options={THINKING_STYLE_OPTIONS} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="stop"
                  label="停止词"
                  tooltip="模型生成到这些词就停下（最多 4 条）。回车确认一条；留空 = 不发送。"
                >
                  <Select
                    mode="tags"
                    open={false}
                    suffixIcon={null}
                    placeholder="输入后回车添加，最多 4 条"
                  />
                </Form.Item>
              </Col>
            </Row>
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 4 }}
              title="协议换成「Anthropic 原生」后，思考预算、Top K 等参数才有意义；换成 OpenAI 兼容时它们会被忽略。思考预算与「思考模式」是同一件事的两代写法：填了预算就以预算为准，留空则由开关与强度决定。"
            />
          </>
        )}
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
      <Modal
        title="选择模型"
        open={modelPickerOpen}
        footer={null}
        onCancel={() => setModelPickerOpen(false)}
      >
        <Typography.Paragraph type="secondary">{modelsMessage}</Typography.Paragraph>
        <Listy
          height={360}
          items={modelOptions}
          rowKey={(model) => model}
          styles={{
            root: { overflowX: "hidden" },
            item: { ...LISTY_ITEM_PADDING_SMALL },
          }}
          itemRender={(model) => (
            <ListyItem
              actions={[
                <Button
                  key="pick"
                  type="link"
                  size="small"
                  onClick={() => {
                    form.setFieldValue("model", model);
                    setModelPickerOpen(false);
                  }}
                >
                  使用
                </Button>,
              ]}
            >
              <Typography.Text code>{model}</Typography.Text>
            </ListyItem>
          )}
        />
      </Modal>
    </Card>
  );
}
