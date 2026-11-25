// SPDX-License-Identifier: Apache-2.0
/**
 * 联网搜索的来源卡片网格（从 `SearchCard` 拆出，守住 500 行预算）。
 *
 * 每张卡：勾选框 + 副标题 + 该来源需要的输入（SearXNG 地址 / 三把 Key / 自定义表单）。
 * 未勾选时输入框禁用——"没启用却要填 Key"是上一版最容易让人误解的地方。
 *
 * 两种附加物也在这里：
 * - CR-12：三把搜索 Key 的**空串规则**（留空并保存 = 移除），挂在各自输入框旁边；
 * - CR-04：DeepSeek 的「测试 Key」按钮。它只发一次零计费的鉴权请求（`/v1/models`），
 *   结果就地显示，**不影响**自动保存——验证失败不阻断保存是明确口径。
 */

import { Button, Checkbox, Flex, Input, Typography, theme } from "antd";
import { useState } from "react";
import { testSearchKey } from "../../api/settings";
import type { SearchConfig, SearchSource } from "../../types";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import SearchCustomFields from "./SearchCustomFields";

/** 服务端掩码字面量：拿到它时"测试"要测已保存的那把，而不是把星号当 Key 发出去。 */
const API_KEY_MASK_PREFIX = "********";

/**
 * CR-12：三把搜索 Key 的空串规则（「留空并保存 = 移除」）。
 *
 * 只有这三把是这个语义；语音 / 语义检索的输入框留空是"沿用本条旧 Key"。把规则挂在
 * 输入框旁边，用户就不必记住"哪个页面是哪种"。
 */
const KEY_RULE_KEYS: Partial<Record<SearchSource, MessageKey>> = {
  deepseek: "searchCard.deepseek.keyRule",
  tavily: "searchCard.tavily.keyRule",
  jina: "searchCard.jina.keyRule",
  custom: "searchCard.custom.keyRule",
};

/**
 * 一条搜索来源的显示名与卡片副标题。
 *
 * 全部走 `labelKey`（品牌名在两种语言里写法相同，登记在 `EQUALITY_EXEMPT_KEYS`）。
 * `noteKey` 是卡片副标题（要不要钥匙），两者都只影响显示；`value` 是提交给后端的协议值。
 */
interface SourceOption {
  value: SearchSource;
  labelKey: MessageKey;
  noteKey: MessageKey;
}

const SOURCE_OPTIONS: SourceOption[] = [
  { value: "bing", labelKey: "searchCard.source.bing", noteKey: "searchCard.source.note.bing" },
  {
    value: "duckduckgo",
    labelKey: "searchCard.source.duckduckgo",
    noteKey: "searchCard.source.note.duckduckgo",
  },
  {
    value: "searxng",
    labelKey: "searchCard.source.searxng",
    noteKey: "searchCard.source.note.searxng",
  },
  // DeepSeek 也是品牌名：两种语言写法相同，走词表 + 等值豁免（与模型预设同一口径）。
  {
    value: "deepseek",
    labelKey: "searchCard.source.deepseek",
    noteKey: "searchCard.source.note.deepseek",
  },
  // P4-09 / P4-10：两个需要 Key 的第三方来源。
  {
    value: "tavily",
    labelKey: "searchCard.source.tavily",
    noteKey: "searchCard.source.note.tavily",
  },
  {
    value: "jina",
    labelKey: "searchCard.source.jina",
    noteKey: "searchCard.source.note.jina",
  },
  // CR-09：用户自带的大模型搜索接口（v1 只有一套，模板决定端点与字段映射）。
  {
    value: "custom",
    labelKey: "searchCard.source.custom",
    noteKey: "searchCard.source.note.custom",
  },
];

/** 一条来源选项的显示名。 */
function sourceLabel(option: SourceOption): string {
  return t(option.labelKey);
}

type TestState = { status: "idle" | "running" | "ok" | "error"; message: string };

export default function SearchSourceTiles({
  config,
  onChange,
}: {
  config: SearchConfig;
  onChange: (changes: Partial<SearchConfig>) => void;
}) {
  useLocale();
  const { token } = theme.useToken();
  const [testState, setTestState] = useState<TestState>({ status: "idle", message: "" });

  const usesSearxng = config.sources.includes("searxng");
  const usesDeepseek = config.sources.includes("deepseek");
  const usesTavily = config.sources.includes("tavily");
  const usesJina = config.sources.includes("jina");

  const toggleSource = (value: SearchSource, checked: boolean) => {
    const sources = checked
      ? [...config.sources.filter((item) => item !== value), value]
      : config.sources.filter((item) => item !== value);
    onChange({ sources });
  };

  const runTest = async () => {
    setTestState({ status: "running", message: t("searchCard.deepseek.testing") });
    const typed = config.deepseek_api_key.trim();
    // 掩码 = "用已保存的那把"：把 `********` 当 Key 发出去必然 401。
    const key = typed.startsWith(API_KEY_MASK_PREFIX) ? "" : typed;
    try {
      const result = await testSearchKey(key);
      setTestState(
        result.ok
          ? {
              status: "ok",
              message: t("searchCard.deepseek.testOk", { ms: result.latency_ms ?? 0 }),
            }
          : { status: "error", message: result.message },
      );
    } catch (err) {
      setTestState({
        status: "error",
        message: err instanceof Error ? err.message : t("searchCard.saveFailed"),
      });
    }
  };

  // Selected state: brand tint background + 1.5px brand border (same as the provider cards).
  //
  // The colours MUST come from the `--rf-*` CSS variables, not from `palette.*` and not from
  // `token.colorPrimaryBg`:
  //   - `token.colorPrimaryBg` is derived from the deep brand colour (#16365c) and lands on a
  //     mid-grey (#92989c), so a selected tile read as "dark grey card";
  //   - `palette.brandTint` is a *light-theme-only* literal: in dark mode the tile stayed
  //     white while the label turned light, i.e. white-on-white text (W2 regression #3).
  // `--rf-brand-tint` / `--rf-brand` / `--rf-border` are defined in design-tokens.css and
  // overridden in dark-tokens.css, so the same inline style is correct in both themes.
  //
  // `borderWidth` must be set on its own: writing `${1.5}px` inside the `border` shorthand
  // is normalised, so the 1.5px selection border may never render.
  const tileStyle = (checked: boolean) => ({
    padding: "10px 12px",
    // 卡片按内容高度收缩：同一行里 SearXNG（标题+说明+地址框）比 DeepSeek 矮一截，
    // 撑成等高会在输入框下方留出一大块空白（清单 §4）。
    minWidth: 0,
    borderRadius: token.borderRadiusLG,
    backgroundColor: checked ? "var(--rf-brand-tint)" : "transparent",
    borderStyle: "solid",
    borderWidth: checked ? "1.5px" : "1px",
    borderColor: checked ? "var(--rf-brand)" : "var(--rf-border)",
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 8,
  });

  return (
    <div
      role="group"
      aria-label={t("searchCard.sources.title")}
      style={{
        display: "grid",
        // auto-fit：宽屏保持两列（清单 §4 的「第二行两张卡」），容器窄于两列
        // 最小宽度时自动降为单列，380px 不会挤成两列半；
        // alignItems: start：卡片按自身内容高度排列，不再被最高的那张拉齐。
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
        gap: 8,
        alignItems: "start",
      }}
    >
      {SOURCE_OPTIONS.map((option) => {
        const checked = config.sources.includes(option.value);
        return (
          <div key={option.value} style={tileStyle(checked)}>
            <Flex align="center" justify="space-between" gap={8}>
              <Typography.Text strong>{sourceLabel(option)}</Typography.Text>
              <Checkbox
                aria-label={sourceLabel(option)}
                checked={checked}
                onChange={(event) => toggleSource(option.value, event.target.checked)}
              />
            </Flex>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t(option.noteKey)}
            </Typography.Text>

            {option.value === "searxng" ? (
              <Input
                aria-label={t("searchCard.searxng.title")}
                value={config.searxng_url}
                onChange={(event) => onChange({ searxng_url: event.target.value })}
                placeholder={t("searchCard.searxng.placeholder")}
                // 只有勾了 SearXNG 才需要填地址：未勾选时禁用以免误以为"必须先填"。
                disabled={!usesSearxng}
                allowClear
              />
            ) : null}

            {option.value === "deepseek" ? (
              <>
                <Input.Password
                  aria-label={t("searchCard.deepseek.keyAria")}
                  value={config.deepseek_api_key}
                  onChange={(event) => onChange({ deepseek_api_key: event.target.value })}
                  placeholder={t("searchCard.deepseek.keyPlaceholder")}
                  // 只有勾了 DeepSeek 才需要密钥：未勾选时禁用，避免误解。
                  disabled={!usesDeepseek || undefined}
                  allowClear
                  autoComplete="off"
                />
                <Flex align="center" gap={8} wrap>
                  <Button
                    size="small"
                    onClick={() => void runTest()}
                    disabled={!usesDeepseek || testState.status === "running"}
                    loading={testState.status === "running"}
                  >
                    {t("searchCard.deepseek.test")}
                  </Button>
                  {testState.status === "ok" || testState.status === "error" ? (
                    <Typography.Text
                      className="search-key-test-result"
                      type={testState.status === "ok" ? "success" : "danger"}
                      style={{ fontSize: 12 }}
                    >
                      {testState.message}
                    </Typography.Text>
                  ) : null}
                </Flex>
              </>
            ) : null}

            {/* P4-09 / P4-10：两个新来源的 Key 同样就地放在自己的卡片里。 */}
            {option.value === "tavily" ? (
              <Input.Password
                aria-label={t("searchCard.tavily.keyAria")}
                value={config.tavily_api_key}
                onChange={(event) => onChange({ tavily_api_key: event.target.value })}
                placeholder={t("searchCard.tavily.keyPlaceholder")}
                disabled={!usesTavily || undefined}
                allowClear
                autoComplete="off"
              />
            ) : null}

            {option.value === "jina" ? (
              <Input.Password
                aria-label={t("searchCard.jina.keyAria")}
                value={config.jina_api_key}
                onChange={(event) => onChange({ jina_api_key: event.target.value })}
                placeholder={t("searchCard.jina.keyPlaceholder")}
                disabled={!usesJina || undefined}
                allowClear
                autoComplete="off"
              />
            ) : null}

            {option.value === "custom" && checked ? (
              <SearchCustomFields config={config} onChange={onChange} />
            ) : null}

            {/* CR-12：三把 Key 的空串规则不一样于「语音转写」那一类按条编辑的输入框
                （那里留空=沿用旧 Key）。这里逐行写明，避免用户用错语义后以为"没保存"。 */}
            {KEY_RULE_KEYS[option.value] ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t(KEY_RULE_KEYS[option.value] as MessageKey)}
              </Typography.Text>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
