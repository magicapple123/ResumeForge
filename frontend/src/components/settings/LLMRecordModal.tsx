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
import DraftRestoreBar from "../common/DraftRestoreBar";
import { useFormDraft } from "../../hooks/useFormDraft";
import { MaxLengthHint } from "../common/MaxLengthHint";
import ModelCatalogField from "./llm/ModelCatalogField";
import { AdvancedParamsSection } from "./llm/AdvancedParamsSection";
import { ThinkingSection } from "./llm/ThinkingSection";
import { useUnlimitedTokens } from "./llm/useUnlimitedTokens";
import { MAX_MAX_TOKENS, MIN_MAX_TOKENS, PRESET_OPTIONS } from "./SettingsConfig";
import type { RecordFormValues } from "../../features/settings/useLLMRecordTools";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  open: boolean;
  /** create = 新建配置记录；edit = 编辑已有记录。 */
  mode: "create" | "edit";
  /** 编辑态用于标题展示的记录名。 */
  recordName: string;
  /** 编辑态的记录 id（草稿作用域用它区分"哪一条记录"；新建态不传）。 */
  recordId?: string;
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
  /**
   * 保存动作。**返回真值表示已落库**（父级保存成功后会关窗）；返回 `null` / `false` /
   * 空值都按"没存上"处理——那正是草稿该留着的情况。
   */
  onSave: () => unknown;
  onClose: () => void;
  onTest: () => void;
  onPresetChange: (provider: string) => void;
  /** 按表单当前填的 Base URL / API Key 拉取可用模型。 */
  onFetchModels: () => Promise<LLMModelsResult>;
}

/**
 * 空值常量（不是字面量 `{}`）：`useFormDraft` 的 `values` 进依赖数组，每次渲染一个新对象
 * 会把防抖计时器一直重置。新建弹窗刚挂载、`useWatch` 还没拿到值时用它。
 */
const EMPTY_DRAFT_VALUES: Record<string, unknown> = {};

export default function LLMRecordModal({
  open,
  mode,
  recordName,
  recordId,
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
  useLocale();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const nameValue = Form.useWatch("name", form);
  const thinkingEnabled = Form.useWatch("thinking_enabled", form);
  const thinkingEffort = Form.useWatch("thinking_effort", form) ?? "";
  const { unlimitedTokens, setUnlimitedTokens } = useUnlimitedTokens(form);
  // 草稿接线（与 TrackFormModal / ClaimFormModal 同一形状）：作用域按"哪一条记录"分，
  // 新建态固定 `new`。api_key 不额外 omit：`stripSensitive` 的字段名正则
  // （api[-_]?key）已经会整键剔除它，再抄一份就等于第二处真相。
  const watchedValues = Form.useWatch<RecordFormValues>([], form) as RecordFormValues | undefined;
  const draft = useFormDraft({
    scope: `llm.record#${recordId ?? "new"}`,
    values: (watchedValues ?? EMPTY_DRAFT_VALUES) as unknown as Record<string, unknown>,
    open,
    // 端点与模型都没填的弹窗没什么可恢复：不写草稿，免得每次打开都弹恢复条。
    isEmpty: (values) => !values.base_url && !values.model,
  });

  /**
   * 保存：父级（`submitRecord`）返回真值才算真的落库，**成功之后**才清草稿——
   * 清早了等于"保存失败也把这一屏配置扔了"。失败时父级在原处报错，弹窗不关。
   */
  const handleSave = async (): Promise<void> => {
    const saved = await onSave();
    if (saved) draft.clear();
  };

  return (
    <Modal
      title={
        mode === "create"
          ? t("llmRecord.title.create")
          : t("llmRecord.title.edit", { name: recordName })
      }
      open={open}
      onCancel={onClose}
      // 表单弹层：点蒙层关掉会丢掉一屏配置，禁掉（Esc / × 仍可关）。
      mask={{ closable: false }}
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
            {t("llmRecord.action.test")}
          </Button>
          <Button disabled={saving} onClick={onClose}>
            {t("common.action.cancel")}
          </Button>
          <Button
            type="primary"
            loading={saving}
            disabled={testing}
            onClick={() => void handleSave()}
          >
            {mode === "create" ? t("llmRecord.action.saveRecord") : t("llmRecord.action.save")}
          </Button>
        </Space>
      }
    >
      {/* 草稿恢复条挂在 body 顶部：命中草稿只提示，**用户点「恢复这份草稿」才应用**。
          本文件用的仍是裸的 antd Modal（本批不改容器），关闭语义因此保持原样：`onCancel`
          直接关、有草稿时关闭无损——即 L1，不需要内联确认条。 */}
      {draft.pending ? (
        <DraftRestoreBar
          savedAt={draft.pending.savedAt}
          fieldCount={Object.keys(draft.pending.values).length}
          onRestore={() => {
            const restored = draft.adopt();
            if (restored) form.setFieldsValue(restored as unknown as RecordFormValues);
          }}
          onDiscard={draft.discard}
        />
      ) : null}
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
              label={t("llmRecord.field.name")}
              rules={[
                { required: true, message: t("llmRecord.required.name") },
                { whitespace: true, message: t("llmRecord.required.name") },
              ]}
            >
              <Input autoFocus maxLength={64} placeholder={t("llmRecord.placeholder.name")} />
            </Form.Item>
            <MaxLengthHint value={nameValue} maxLength={64} />
          </>
        )}
        <Form.Item name="preset" label={t("llmRecord.field.preset")}>
          <Select
            options={PRESET_OPTIONS}
            onChange={onPresetChange}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>
        <Form.Item
          name="api_style"
          label={t("llmRecord.field.protocol")}
          tooltip="多数服务商（含 Claude 的 OpenAI 兼容层）走 Chat Completions，选「OpenAI 兼容」。只有要用 Claude 原生 Messages 协议（支持扩展思考、独立 system 字段）时才选 Anthropic 原生——此时 Base URL 填 https://api.anthropic.com/v1（本应用会在后面接 /messages）。"
        >
          <Select
            options={[
              { value: "openai", label: t("llmRecord.protocol.openai") },
              { value: "anthropic", label: t("llmRecord.protocol.anthropic") },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="base_url"
          label="Base URL"
          rules={[{ required: true, message: t("llmRecord.required.field") }]}
          tooltip={t("llmRecord.hint.baseUrl")}
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
          label={
            mode === "create"
              ? t("llmRecord.field.apiKeyOptional")
              : t("llmRecord.field.apiKeyKeep")
          }
          tooltip={
            mode === "create" ? t("llmRecord.hint.apiKeyCreate") : t("llmRecord.hint.apiKeyEdit")
          }
        >
          {/* 显隐开关只作用于本条刚输入的明文；已保存的密钥是脱敏引用，不存在可回显的本体。 */}
          <Input.Password
            placeholder={mode === "create" ? "sk-…" : t("llmRecord.placeholder.apiKeyKeep")}
            autoComplete="new-password"
          />
        </Form.Item>
        <Row gutter={[16, 0]}>
          <Col xs={24} md={8}>
            <Form.Item
              name="temperature"
              label={t("llmRecord.field.temperature")}
              tooltip={t("llmRecord.hint.temperature")}
            >
              {/* 两端 marks（严谨/发散）与手柄以轨道端点为中心渲染、会溢出 Slider 盒子
                  （mark 半宽 ~14px、handle 半径 ~7px）：外层 div 内缩 16px 把溢出全部吸收
                  在自身 padding 区内——弹窗 body 的 overflowX hidden 就裁不到它们了。
                  内缩只包 Slider 不包 Form.Item，label 左缘与其他列保持对齐。 */}
              <div style={{ paddingInline: 16 }}>
                <Slider
                  min={0}
                  max={2}
                  step={0.1}
                  marks={{
                    0: t("llmRecord.temperature.strict"),
                    1: t("llmRecord.temperature.balanced"),
                    2: t("llmRecord.temperature.creative"),
                  }}
                />
              </div>
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name="timeout_seconds"
              label={t("llmRecord.field.timeout")}
              tooltip={t("llmRecord.hint.timeout")}
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
                  {t("llmRecord.field.maxTokens")}
                  <Tooltip title={t("llmRecord.hint.maxTokens")}>
                    <QuestionCircleOutlined
                      style={{ color: "var(--rf-text-description)", fontSize: 12 }}
                      aria-label={t("llmRecord.aria.maxTokens")}
                    />
                  </Tooltip>
                  {/* 这一条的行为与直觉相反（"不限制"其实取决于服务商默认值，可能比
                      手填的还小），勾选框悬停自带解释。 */}
                  <Tooltip title="勾选后不再发送 max_tokens，由服务商决定上限。可缓解推理模型把思考过程算进输出预算、正文被挤空的问题；但它不是真的无限——部分服务商的默认值可能比手动设置的值更小。">
                    <Checkbox
                      checked={unlimitedTokens}
                      onChange={(event) => setUnlimitedTokens(event.target.checked)}
                    >
                      {t("llmRecord.label.unlimited")}
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
