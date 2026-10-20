// SPDX-License-Identifier: Apache-2.0
/** 配置记录的新增/编辑共用弹窗：两个模式同一份表单（同名 upsert 保存）。
 *
 * 表单字段与验证规则两模式一致；差异只有三处——新增多一个「配置名称」输入框、
 * api_key 的文案（新增选填 / 编辑留空保持不变）、弹窗标题。编辑保存只改记录本身，
 * 同步当前生效配置由调用方负责（见 SettingsPage 的 handleSaveRecord）。
 *
 * 原页面表单的全部配置能力在这里原样保留（只是换了容器）：思考模式开关 + 强度档位
 * （含「自定义…」输入分支与 probe 检测提示）、「不限制」最大输出勾选框的禁用联动、
 * 高级调整折叠区（Top P / Top K、惩罚项、随机种子、停止词、思考参数形态）。
 */
import { ApiOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Checkbox,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Slider,
  Space,
  Tooltip,
} from "antd";
import type { FormInstance } from "antd";
import { useState } from "react";
import type { LLMModelsResult, LLMTestResult, LLMThinkingResult } from "../../types";
import { MaxLengthHint } from "../common/MaxLengthHint";
import ModelCatalogField from "./llm/ModelCatalogField";
import { AdvancedParamsSection } from "./llm/AdvancedParamsSection";
import { ThinkingSection } from "./llm/ThinkingSection";
import { useUnlimitedTokens } from "./llm/useUnlimitedTokens";
import { MAX_MAX_TOKENS, MIN_MAX_TOKENS, PRESET_OPTIONS } from "./SettingsConfig";
import type { RecordFormValues } from "../../features/settings/useLLMRecordTools";

interface Props {
  open: boolean;
  /** create = 新增配置记录；edit = 编辑已有记录。 */
  mode: "create" | "edit";
  /** 编辑态用于标题展示的记录名。 */
  recordName: string;
  form: FormInstance<RecordFormValues>;
  saving: boolean;
  testing: boolean;
  testResult: LLMTestResult | null;
  /** 思考模式检测（probe）：按钮与结果提示由 ThinkingSection 渲染。 */
  checkingThinking: boolean;
  thinkingResult: LLMThinkingResult | null;
  showingCustomEffort: boolean;
  effortOptions: { value: string; label: string }[];
  onProbe: () => Promise<void>;
  /** 只读后端内置能力表拿档位（零上游调用）：打开思考开关时顺手取一次。 */
  onLoadThinkingOptions: () => Promise<LLMThinkingResult>;
  onBackToEffortPresets: () => void;
  onEffortCustom: (effort: string) => boolean;
  /** 换了端点/模型/协议后上一次的检测结论不再适用，由弹窗清掉。 */
  onClearThinkingResult: () => void;
  onSave: () => void;
  onClose: () => void;
  onTest: () => void;
  onPresetChange: (provider: string) => void;
  /** 按表单当前填的 Base URL / API Key 拉取可用模型。 */
  onFetchModels: () => Promise<LLMModelsResult>;
}

export default function LLMRecordModal({
  open,
  mode,
  recordName,
  form,
  saving,
  testing,
  testResult,
  checkingThinking,
  thinkingResult,
  showingCustomEffort,
  effortOptions,
  onProbe,
  onLoadThinkingOptions,
  onBackToEffortPresets,
  onEffortCustom,
  onClearThinkingResult,
  onSave,
  onClose,
  onTest,
  onPresetChange,
  onFetchModels,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const nameValue = Form.useWatch("name", form);
  const thinkingEnabled = Form.useWatch("thinking_enabled", form);
  const thinkingEffort = Form.useWatch("thinking_effort", form) ?? "";
  const { unlimitedTokens, setUnlimitedTokens } = useUnlimitedTokens(form);

  return (
    <Modal
      title={mode === "create" ? "新增配置记录" : `编辑配置记录「${recordName}」`}
      open={open}
      onCancel={onClose}
      destroyOnHidden
      width={720}
      className="llm-record-modal"
      style={{ top: 0, margin: "auto", paddingBottom: 0 }}
      styles={{
        wrapper: {
          display: "flex",
          alignItems: "center",
          paddingBlock: 24,
          boxSizing: "border-box",
        },
        container: {
          display: "flex",
          flexDirection: "column",
          maxHeight: "min(80dvh, calc(100dvh - 48px))",
          overflow: "hidden",
        },
        body: {
          flex: "1 1 auto",
          minHeight: 0,
          overflowY: "auto",
          // overflowY 非 visible 时 overflowX 计算为 auto——Slider 两端 marks 溢出列宽
          // 就会顶出横向滚动条；内容根源已修（Slider 内缩），这里兜底防其他元素复发。
          overflowX: "hidden",
          overscrollBehavior: "contain",
        },
        header: { flexShrink: 0 },
        footer: { flexShrink: 0 },
      }}
      footer={
        <Space wrap>
          <Button icon={<ApiOutlined />} loading={testing} disabled={saving} onClick={onTest}>
            测试连接
          </Button>
          <Button disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button type="primary" loading={saving} disabled={testing} onClick={onSave}>
            {mode === "create" ? "保存记录" : "保存"}
          </Button>
        </Space>
      }
    >
      <Form
        form={form}
        layout="vertical"
        onValuesChange={(changedValues) => {
          // 换了端点/模型/协议，上一次的检测结论就不再适用——清掉比留着误导好。
          if (
            "base_url" in changedValues ||
            "model" in changedValues ||
            "api_style" in changedValues
          ) {
            onClearThinkingResult();
          }
          // 打开开关时顺手取一次档位（只读后端能力表，零上游调用）。
          if ("thinking_enabled" in changedValues && changedValues.thinking_enabled) {
            void onLoadThinkingOptions();
          }
          // 下拉里选了「自定义…」：把哨兵值从字段里清掉，换成输入框。
          if (typeof changedValues.thinking_effort === "string") {
            onEffortCustom(changedValues.thinking_effort);
          }
        }}
      >
        {/* provider 只由预设/预填驱动（不入 UI）：必须注册成 hidden 字段，
            否则 validateFields 只返回已注册字段，provider 会在保存时丢成默认值。 */}
        <Form.Item name="provider" hidden>
          <Input />
        </Form.Item>
        {mode === "create" && (
          <>
            {/* Form.Item 只挂单个控件子元素：MaxLengthHint 放在外面（值走 useWatch），
                否则 value/onChange 注入会失效。 */}
            <Form.Item
              name="name"
              label="配置名称"
              rules={[
                { required: true, message: "请填写配置名称" },
                { whitespace: true, message: "请填写配置名称" },
              ]}
            >
              <Input autoFocus maxLength={64} placeholder="如：DeepSeek 校招、Ollama 本地模型" />
            </Form.Item>
            <MaxLengthHint value={nameValue} maxLength={64} />
          </>
        )}
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
        <Form.Item
          name="base_url"
          label="Base URL"
          rules={[{ required: true, message: "必填" }]}
          tooltip="服务地址，通常形如 https://api.xxx.com 或 https://api.xxx.com/v1"
        >
          <Input placeholder="https://api.deepseek.com" />
        </Form.Item>
        <ModelCatalogField
          open={open}
          requestScope={`${mode}:${recordName}`}
          disabled={saving || testing}
          form={form}
          onFetchModels={onFetchModels}
          onModelChange={onClearThinkingResult}
        />
        <Form.Item
          name="api_key"
          label={mode === "create" ? "API Key（选填）" : "API Key（留空保持不变）"}
          tooltip={
            mode === "create"
              ? "多数云模型服务需要填写；Ollama 等无需鉴权的本地兼容服务可留空。密钥保存在本地数据库，仅本机可访问。"
              : "出于脱敏考虑，已保存的密钥不会显示出来（记录里只保存脱敏引用）；留空即沿用原密钥，输入新值则整体替换。"
          }
        >
          {/* 显隐开关只作用于本条刚输入的明文；已保存的密钥是脱敏引用，不存在可回显的本体。 */}
          <Input.Password
            placeholder={mode === "create" ? "sk-…" : "已配置，留空保持不变"}
            autoComplete="new-password"
          />
        </Form.Item>
        <Row gutter={[16, 0]}>
          <Col xs={24} md={8}>
            <Form.Item
              name="temperature"
              label="创意度 temperature"
              tooltip="控制输出的随机性。值越低越稳定，适合事实型简历；值越高表达更发散，也会增加内容不一致或虚构风险。"
            >
              {/* 两端 marks（严谨/发散）与手柄以轨道端点为中心渲染、会溢出 Slider 盒子
                  （mark 半宽 ~14px、handle 半径 ~7px）：外层 div 内缩 16px 把溢出全部吸收
                  在自身 padding 区内——弹窗 body 的 overflowX hidden 就裁不到它们了。
                  内缩只包 Slider 不包 Form.Item，label 左缘与其他列保持对齐。 */}
              <div style={{ paddingInline: 16 }}>
                <Slider min={0} max={2} step={0.1} marks={{ 0: "严谨", 1: "均衡", 2: "发散" }} />
              </div>
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
            {/* 「不限制」放 label 右侧（用户要求），勾上后数字框禁用。问号解释字段本身，
                勾选框自带另一份解释（勾选后不发参数的语义）。 */}
            <Form.Item
              name="max_tokens"
              label={
                <Space size={4} wrap={false}>
                  最大输出 Token
                  <Tooltip title="限制模型单次回复的最大输出 Token 数。值越大可能增加费用；过小可能导致内容被截断。它不是模型的上下文长度上限。">
                    <QuestionCircleOutlined
                      style={{ color: "var(--rf-text-description)", fontSize: 12 }}
                      aria-label="最大输出 Token 说明"
                    />
                  </Tooltip>
                  {/* 这一条的行为与直觉相反（"不限制"其实取决于服务商默认值，可能比
                      手填的还小），勾选框悬停自带解释。 */}
                  <Tooltip title="勾选后不再发送 max_tokens，由服务商决定上限。可缓解推理模型把思考过程算进输出预算、正文被挤空的问题；但它不是真的无限——部分服务商的默认值可能比手动设置的值更小。">
                    <Checkbox
                      checked={unlimitedTokens}
                      onChange={(event) => setUnlimitedTokens(event.target.checked)}
                    >
                      不限制
                    </Checkbox>
                  </Tooltip>
                </Space>
              }
            >
              <InputNumber
                min={MIN_MAX_TOKENS}
                max={MAX_MAX_TOKENS}
                step={512}
                // 要传 undefined 而不是 false：antd 只在 prop 为 null/undefined 时
                // 才回退到 Form 的 disabled 上下文，传 false 会让勾选「不限制」也改不了。
                disabled={unlimitedTokens ? true : undefined}
                style={{ width: "100%" }}
              />
            </Form.Item>
          </Col>
        </Row>
        {/* 用户反馈：三列行（Form.Item 默认 marginBottom 24）与思考模式行之间太空，收紧 12px。 */}
        <div style={{ marginBottom: -12 }} />

        <ThinkingSection
          thinkingEnabled={thinkingEnabled}
          thinkingEffort={thinkingEffort}
          showingCustomEffort={showingCustomEffort}
          effortOptions={effortOptions}
          checkingThinking={checkingThinking}
          thinkingResult={thinkingResult}
          saving={saving}
          testing={testing}
          onProbe={onProbe}
          onBackToPresets={onBackToEffortPresets}
        />

        {/* 折叠头上下间距（2026 三修）：包一层 spacer div，用 **padding** 撑出 16px/8px
            的上下节奏。前两轮没达标的原因：① 第一轮写在 modules.css 里，antd 6 的
            cssinjs 组件样式运行时注入 <head>、排在静态样式表之后，同特异性被整体压掉；
            ② 第二轮换成内联 marginBlock:8px 生效了，但 8px 远小于 antd 表单 24px 的
            分段节奏，且上方思考模式说明文字自带 margin-bottom:12px，与折叠头的
            margin-top 相邻塌陷取 max——margin 被吞，视觉上仍是"贴着"。padding 不参与
            margin 塌陷，加上内联随 JS bundle 分发、不受 CSS 注入顺序影响，两层风险
            一次消除（由 LLMRecordModal.test.tsx 钉住）。 */}
        <div className="llm-advanced-toggle-spacing" style={{ paddingTop: 16, paddingBottom: 8 }}>
          <Button
            type="link"
            className="llm-advanced-toggle"
            style={{ paddingInline: 0 }}
            onClick={() => setAdvancedOpen((current) => !current)}
          >
            {advancedOpen
              ? "收起高级调整"
              : "高级调整（Top P / Top K、惩罚项、随机种子、停止词、思考参数形态）"}
          </Button>
        </div>
        {advancedOpen && <AdvancedParamsSection />}
      </Form>
      {testResult && (
        <Alert
          type={testResult.ok ? "success" : "error"}
          showIcon
          title={
            testResult.ok
              ? `${testResult.message}（耗时 ${testResult.latency_ms}ms）`
              : `连接失败：${testResult.message}`
          }
        />
      )}
    </Modal>
  );
}
