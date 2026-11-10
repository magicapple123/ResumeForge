// SPDX-License-Identifier: Apache-2.0
/** 各服务商对三种接口协议的支持情况（设置页「模型配置」区的可展开说明）。
 *
 * 数据是**前端静态核对表**，不做实时探测：每次进设置页都发请求既慢又会被服务商限流。
 * 核对日期：2026-11-09（与 config.ts 的预设注释、i18n 表尾同一口径）；表尾与"核对日期"
 * 列都写明，避免用户把这张表当成永久承诺。
 *
 * 行序按热门度排列（热门服务商在前），不是按字母序：这张表是"我该选谁"的查阅入口，
 * 用户最可能找的那几家应当先看到。
 *
 * 列：服务商 / Chat Completions / Responses / Anthropic Messages / 核对日期。
 * 状态三档：支持 / 不支持 / 部分支持（另有入口或版本前置条件，Tooltip 里说明）。
 *
 * **这张表是"用户该选哪个协议"的唯一出处**：协议下拉的说明不再枚举"谁不支持"，
 * 因为那种枚举总是漏（2026-11-07 那版就把 DeepSeek / MiniMax / 千帆 / 星火 全写错了）。
 *
 * **2026-11-09 修订**（清单 §11.4 第 7 类缺陷）：豆包 Anthropic 写「支持」但官方无入口、
 * xAI Anthropic 官方已废弃、讯飞入口在新 MaaS 域名、MiniMax 域名与官方文档不一致——四处
 * 一并改。表尾同时指向「思考开关」：哪些型号强制思考、本应用不会给它们发关闭参数。
 * 强制思考型号清单的唯一事实在 ``backend/app/services/llm/thinking_vendors.py``
 * 的 ``FORCED_THINKING_MODELS``，后端守卫会读本目录的语言包比对（两边必须逐字一致）。
 */
import { Collapse, Table, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType } from "antd";
import type { MessageKey } from "../../i18n";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

type Support = "yes" | "no" | "partial";

interface MatrixRow {
  /** 服务商显示名（语言包 key：沿用预设名，Azure 单列一条）。 */
  labelKey: MessageKey;
  chat: Support;
  responses: Support;
  anthropic: Support;
  /** 单元格补充说明（版本前置条件 / 另有入口），有值才渲染 Tooltip。 */
  chatNoteKey?: MessageKey;
  responsesNoteKey?: MessageKey;
  anthropicNoteKey?: MessageKey;
}

/** 核对日期：改表时同步改这里与 i18n 表尾。 */
const VERIFIED_AT = "2026-11-09";

/** 23 行，按热门度排序：22 个内置预设 + Azure OpenAI（单列、暂不内置）。 */
const ROWS: MatrixRow[] = [
  {
    labelKey: "appConfig.preset.deepseek",
    chat: "yes",
    responses: "yes",
    anthropic: "yes",
    anthropicNoteKey: "llmProtocol.matrix.deepseekAnthropicNote",
  },
  {
    labelKey: "appConfig.preset.qwen",
    chat: "yes",
    responses: "partial",
    anthropic: "yes",
    responsesNoteKey: "llmProtocol.matrix.qwenResponsesNote",
  },
  {
    labelKey: "appConfig.preset.doubao",
    chat: "yes",
    responses: "yes",
    // 官方文档没有 Anthropic Messages 入口（§11.4 缺陷 7）：「支持」会让用户选到一个
    // 必然 404 的协议。
    anthropic: "no",
    anthropicNoteKey: "llmProtocol.matrix.doubaoAnthropicNote",
  },
  { labelKey: "appConfig.preset.zhipu", chat: "yes", responses: "yes", anthropic: "yes" },
  {
    labelKey: "appConfig.preset.siliconflow",
    chat: "yes",
    responses: "no",
    anthropic: "yes",
    responsesNoteKey: "llmProtocol.matrix.siliconflowResponsesNote",
    anthropicNoteKey: "llmProtocol.matrix.siliconflowAnthropicNote",
  },
  { labelKey: "appConfig.preset.kimi", chat: "yes", responses: "yes", anthropic: "yes" },
  { labelKey: "llmProtocol.preset.hunyuan", chat: "yes", responses: "yes", anthropic: "yes" },
  { labelKey: "appConfig.preset.openai", chat: "yes", responses: "yes", anthropic: "no" },
  {
    labelKey: "appConfig.preset.anthropic",
    chat: "partial",
    responses: "no",
    anthropic: "yes",
    chatNoteKey: "llmProtocol.matrix.claudeChatNote",
  },
  {
    labelKey: "appConfig.preset.gemini",
    chat: "yes",
    responses: "no",
    anthropic: "no",
    chatNoteKey: "llmProtocol.matrix.geminiChatNote",
  },
  { labelKey: "llmProtocol.preset.qianfan", chat: "yes", responses: "yes", anthropic: "yes" },
  {
    labelKey: "llmProtocol.preset.spark",
    chat: "yes",
    responses: "yes",
    anthropic: "yes",
    anthropicNoteKey: "llmProtocol.matrix.sparkAnthropicNote",
  },
  {
    labelKey: "appConfig.preset.minimax",
    chat: "yes",
    responses: "yes",
    anthropic: "yes",
    // 官方域名与预设保留旧域名的原因（§11.4 缺陷 7 的同一类：矩阵与预设不一致）。
    anthropicNoteKey: "llmProtocol.matrix.minimaxNote",
  },
  { labelKey: "appConfig.preset.openrouter", chat: "yes", responses: "yes", anthropic: "yes" },
  {
    labelKey: "llmProtocol.preset.stepfun",
    chat: "yes",
    responses: "partial",
    anthropic: "yes",
    responsesNoteKey: "llmProtocol.matrix.stepfunResponsesNote",
    anthropicNoteKey: "llmProtocol.matrix.stepfunNote",
  },
  {
    labelKey: "appConfig.preset.ollama",
    chat: "yes",
    responses: "yes",
    anthropic: "yes",
    responsesNoteKey: "llmProtocol.matrix.ollamaNote",
    anthropicNoteKey: "llmProtocol.matrix.ollamaAnthropicNote",
  },
  {
    labelKey: "appConfig.preset.xai",
    chat: "yes",
    responses: "yes",
    // 官方已废弃 Anthropic 兼容入口（§11.4 缺陷 7）：标「部分支持」等于让用户踩一个
    // 已下线的入口。迁移目标是 Responses。
    anthropic: "no",
    anthropicNoteKey: "llmProtocol.matrix.xaiAnthropicNote",
  },
  {
    labelKey: "appConfig.preset.mistral",
    chat: "yes",
    responses: "yes",
    anthropic: "no",
    responsesNoteKey: "llmProtocol.matrix.mistralResponsesNote",
  },
  {
    labelKey: "appConfig.preset.lmstudio",
    chat: "yes",
    responses: "yes",
    anthropic: "yes",
    responsesNoteKey: "llmProtocol.matrix.lmstudioNote",
    anthropicNoteKey: "llmProtocol.matrix.lmstudioAnthropicNote",
  },
  {
    labelKey: "llmProtocol.matrix.azure",
    chat: "yes",
    responses: "yes",
    anthropic: "no",
    anthropicNoteKey: "llmProtocol.matrix.azureAnthropicNote",
  },
  {
    labelKey: "appConfig.preset.groq",
    chat: "yes",
    responses: "yes",
    anthropic: "no",
    responsesNoteKey: "llmProtocol.matrix.groqResponsesNote",
  },
  {
    labelKey: "llmProtocol.preset.together",
    chat: "yes",
    responses: "yes",
    anthropic: "partial",
    responsesNoteKey: "llmProtocol.matrix.togetherResponsesNote",
    anthropicNoteKey: "llmProtocol.matrix.togetherAnthropicNote",
  },
  {
    labelKey: "llmProtocol.preset.perplexity",
    chat: "partial",
    responses: "yes",
    anthropic: "partial",
    chatNoteKey: "llmProtocol.matrix.perplexityNote",
    anthropicNoteKey: "llmProtocol.matrix.perplexityAnthropicNote",
  },
];

const STATUS_LABEL_KEYS: Record<Support, MessageKey> = {
  yes: "llmProtocol.matrix.yes",
  no: "llmProtocol.matrix.no",
  partial: "llmProtocol.matrix.partial",
};

const STATUS_COLORS: Record<Support, string> = {
  yes: "green",
  no: "default",
  partial: "gold",
};

export default function LLMProtocolSupportMatrix() {
  // 本组件用模块级 t()：订阅语言变化，切到英文后这一屏要跟着重渲染。
  useLocale();

  const renderSupport = (status: Support, noteKey?: MessageKey) => {
    const tag = <Tag color={STATUS_COLORS[status]}>{t(STATUS_LABEL_KEYS[status])}</Tag>;
    return noteKey ? <Tooltip title={t(noteKey)}>{tag}</Tooltip> : tag;
  };

  const columns: TableColumnsType<MatrixRow> = [
    {
      title: t("llmProtocol.matrix.provider"),
      dataIndex: "labelKey",
      render: (labelKey: MessageKey) => t(labelKey),
    },
    {
      title: t("llmProtocol.matrix.chat"),
      align: "center",
      render: (_, row) => renderSupport(row.chat, row.chatNoteKey),
    },
    {
      title: t("llmProtocol.matrix.responses"),
      align: "center",
      render: (_, row) => renderSupport(row.responses, row.responsesNoteKey),
    },
    {
      title: t("llmProtocol.matrix.anthropic"),
      align: "center",
      render: (_, row) => renderSupport(row.anthropic, row.anthropicNoteKey),
    },
    {
      title: t("llmProtocol.matrix.verifiedAt"),
      align: "center",
      render: () => VERIFIED_AT,
    },
  ];

  return (
    <Collapse
      size="small"
      className="llm-protocol-matrix"
      items={[
        {
          key: "matrix",
          label: t("llmProtocol.matrix.toggle"),
          children: (
            <>
              <Table<MatrixRow>
                rowKey="labelKey"
                size="small"
                pagination={false}
                columns={columns}
                dataSource={ROWS}
                scroll={{ x: 620 }}
              />
              <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
                {t("llmProtocol.matrix.footnote")}
              </Typography.Paragraph>
            </>
          ),
        },
      ]}
    />
  );
}
