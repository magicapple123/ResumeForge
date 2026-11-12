// SPDX-License-Identifier: Apache-2.0
/**
 * 联网搜索设置：来源（多选卡片）、搜索深度、每次最多返回的结果条数。
 *
 * 这些参数一直存在于后端，但此前**没有任何界面能改**：`GET/PUT /api/settings/search`
 * 只有接口没有入口，于是「抓取正文的条数」永远是默认的 0，助手拿到的永远只有摘要。
 * 助手页那个开关是"这次要不要联网"，这里配的是"联网时怎么搜"，两者互不替代。
 * 配置存在全局设置里，所有数据集共用（切换数据集不会换一套来源与 Key）。
 *
 * ## 统一口径（条目 02 / 03）
 *
 * - 卡头：`title` 里显示「已选 N 个」，`extra` 放**自动保存状态**（这张卡没有保存按钮）；
 * - 说明：`Alert type="info"` 一句话，字段统一走 `SettingsField`；
 * - 来源：4 张可选卡片自动铺列（`auto-fit`，窄容器降为单列），右上角 `Checkbox`，选中态
 *   1.5px 主色边框；只有勾了 SearXNG 才需要实例地址，只有勾了 DeepSeek 才需要 Key ——
 *   输入框就地放在对应卡片里（未勾选时禁用），不再单独占两大块；
 * - 卡片按内容高度排列（`alignItems: start`，不设 `height: 100%`）：DeepSeek 的计费与
 *   隐私长提示移出卡片，放网格下方的全宽 `Alert`（常驻可见，不能塞进 Tooltip/折叠区）；
 * - 通用参数：抓取档位是互斥单选（`Radio.Group`），条数上限是 1–50 的 `InputNumber`。
 *
 * ## 为什么没有保存按钮
 *
 * 字段常驻可编辑，改动合并 400ms 后自动 PUT；离散勾选与数字框也一样。校验失败（一个来源
 * 都没选、地址不是 http(s)）时在卡片里说明，不发请求；改对后自动重试。这样"改完还要记得
 * 点保存"不再是一个会丢配置的步骤。
 */

import {
  Alert,
  Card,
  Checkbox,
  Flex,
  Input,
  InputNumber,
  Space,
  Tag,
  Typography,
  theme,
} from "antd";
import ErrorState from "../../components/common/ErrorState";
import LoadingBlock from "../../components/common/LoadingBlock";
import SettingsField from "./SettingsField";
import SearchDepthField from "./SearchDepthField";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSearchConfig, saveSearchConfig } from "../../api/settings";
import type { SearchConfig, SearchSource } from "../../types";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 与后端 `SearchConfig` 的默认值保持一致，用作取数失败时的兜底草稿。 */
const DEFAULT_CONFIG: SearchConfig = {
  sources: ["bing", "duckduckgo"],
  searxng_url: "",
  // 与后端 `SearchConfig.depth` 的默认值一致（P4-08）：「标准」= 抓 2 页正文。
  depth: "standard",
  max_results: 8,
  deepseek_api_key: "",
  tavily_api_key: "",
  jina_api_key: "",
};

/** 「每次最多返回的结果条数」上限，与后端 `SearchConfig.max_results` 的 `le=50` 对齐。 */
const MAX_RESULTS_LIMIT = 50;

/** 输入框里键入越界值时在本地夹紧，避免 400ms 后发出一个必然 422 的请求。 */
function clampMaxResults(value: number | null): number {
  return Math.max(1, Math.min(MAX_RESULTS_LIMIT, value ?? DEFAULT_CONFIG.max_results));
}

/**
 * 一条搜索来源的显示名与卡片副标题。
 *
 * `label` 给品牌名用（`Bing` / `DuckDuckGo`：两种语言写法相同，进词表会被
 * `source-ascii-english` 判成"源文是英文"），`labelKey` 给需要随语言变化的显示名用。
 * `noteKey` 是卡片副标题（要不要钥匙），两者都只影响显示；`value` 是提交给后端的协议值。
 */
interface SourceOption {
  value: SearchSource;
  label?: string;
  labelKey?: MessageKey;
  noteKey: MessageKey;
}

const SOURCE_OPTIONS: SourceOption[] = [
  { value: "bing", label: "Bing", noteKey: "searchCard.source.note.bing" },
  { value: "duckduckgo", label: "DuckDuckGo", noteKey: "searchCard.source.note.duckduckgo" },
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
];

/** 一条来源选项的显示名（品牌名直接用，其余走词表）。 */
function sourceLabel(option: SourceOption): string {
  if (option.labelKey) return t(option.labelKey);
  return option.label ?? option.value;
}

export default function SearchCard() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const { token } = theme.useToken();
  const [config, setConfig] = useState<SearchConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [loadError, setLoadError] = useState("");
  const timer = useRef<number | null>(null);
  const latest = useRef<SearchConfig>(DEFAULT_CONFIG);

  // 纯取数（不含 setState）：effect 内联调用时 Compiler 才能验证非同步更新；
  // 判别式结果保留原始错误消息（测试钉住它必须原样展示），只翻兜底那句。
  const fetchConfig = useCallback(async (): Promise<
    { config: SearchConfig } | { error: string }
  > => {
    try {
      return { config: await getSearchConfig() };
    } catch (err) {
      return { error: err instanceof Error ? err.message : t("searchCard.loadFailed") };
    }
  }, []);

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）；
  // loading/loadError 初始值即「加载中/无错误」，无需同步置位。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchConfig();
      if (cancelled) return;
      if ("config" in result) {
        // 用默认值补齐：旧后端没有新字段时，受控输入不能拿到 undefined。
        const loaded = { ...DEFAULT_CONFIG, ...result.config };
        setConfig(loaded);
        latest.current = loaded;
      } else {
        setLoadError(result.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchConfig]);

  /** 「重新读取」：与挂载那段共用同一份取数逻辑。 */
  const reload = async () => {
    setLoading(true);
    const result = await fetchConfig();
    if ("config" in result) {
      const loaded = { ...DEFAULT_CONFIG, ...result.config };
      setConfig(loaded);
      latest.current = loaded;
      setLoadError("");
    } else {
      setLoadError(result.error);
    }
    setLoading(false);
  };

  /** 真正发请求；校验失败时只更新状态，不发请求。 */
  const persist = useCallback(async (next: SearchConfig) => {
    const trimmed = {
      ...next,
      searxng_url: next.searxng_url.trim(),
      deepseek_api_key: next.deepseek_api_key.trim(),
      tavily_api_key: next.tavily_api_key.trim(),
      jina_api_key: next.jina_api_key.trim(),
    };
    if (trimmed.sources.length === 0) {
      setSaveStatus("error");
      setSaveError(t("searchCard.needSource"));
      return;
    }
    if (trimmed.searxng_url && !/^https?:\/\//i.test(trimmed.searxng_url)) {
      setSaveStatus("error");
      setSaveError(t("searchCard.badUrl"));
      return;
    }
    setSaveStatus("saving");
    setSaveError("");
    try {
      await saveSearchConfig(trimmed);
      setSaveStatus("saved");
    } catch (err) {
      setSaveStatus("error");
      setSaveError(err instanceof Error ? err.message : t("searchCard.saveFailed"));
    }
  }, []);

  /** 改动合并 400ms 后保存：勾选/数字框不会连发，URL 输入也不会每键一次请求。 */
  const scheduleSave = useCallback(
    (next: SearchConfig) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void persist(next);
      }, 400);
    },
    [persist],
  );

  const patch = (changes: Partial<SearchConfig>) => {
    setConfig((current) => {
      const next = { ...current, ...changes };
      latest.current = next;
      scheduleSave(next);
      return next;
    });
  };

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const usesSearxng = config.sources.includes("searxng");
  const usesDeepseek = config.sources.includes("deepseek");
  const usesTavily = config.sources.includes("tavily");
  const usesJina = config.sources.includes("jina");

  const toggleSource = (value: SearchSource, checked: boolean) => {
    const sources = checked
      ? [...config.sources.filter((item) => item !== value), value]
      : config.sources.filter((item) => item !== value);
    patch({ sources });
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

  const saveStatusText =
    saveStatus === "saving"
      ? t("searchCard.status.saving")
      : saveStatus === "saved"
        ? t("searchCard.status.saved")
        : saveStatus === "error"
          ? t("searchCard.status.error")
          : "";

  return (
    <Card
      title={
        <Flex align="center" gap={8} wrap>
          <span>{t("searchCard.title")}</span>
          <Tag color={config.sources.length > 0 ? "green" : undefined}>
            {t("searchCard.sources.count", { count: config.sources.length })}
          </Tag>
        </Flex>
      }
      extra={
        saveStatusText ? (
          <Typography.Text
            type={saveStatus === "error" ? "danger" : "secondary"}
            className="search-save-status"
          >
            {saveStatusText}
          </Typography.Text>
        ) : undefined
      }
      className="settings-card"
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} title={t("searchCard.intro")} />

      {loadError ? (
        <div style={{ marginBottom: 16 }}>
          {/* Same shape as the other two cards: a retryable ErrorState, not the list EmptyState. */}
          <ErrorState
            description={
              <>
                <div>{t("searchCard.loadErrorTitle")}</div>
                <Typography.Text type="secondary">
                  {t("searchCard.loadErrorBody", { message: loadError })}
                </Typography.Text>
              </>
            }
            onRetry={() => void reload()}
            retryLabel={t("common.retry")}
          />
        </div>
      ) : null}

      <LoadingBlock spinning={loading}>
        <Flex vertical gap={16}>
          <SettingsField label={t("searchCard.sources.title")} hint={t("searchCard.sources.hint")}>
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
                        onChange={(event) => patch({ searxng_url: event.target.value })}
                        placeholder={t("searchCard.searxng.placeholder")}
                        // 只有勾了 SearXNG 才需要填地址：未勾选时禁用以免误以为"必须先填"。
                        disabled={!usesSearxng}
                        allowClear
                      />
                    ) : null}

                    {option.value === "deepseek" ? (
                      <Input.Password
                        aria-label={t("searchCard.deepseek.keyAria")}
                        value={config.deepseek_api_key}
                        onChange={(event) => patch({ deepseek_api_key: event.target.value })}
                        placeholder={t("searchCard.deepseek.keyPlaceholder")}
                        // 只有勾了 DeepSeek 才需要密钥：未勾选时禁用，避免误解。
                        disabled={!usesDeepseek || undefined}
                        allowClear
                        autoComplete="off"
                      />
                    ) : null}

                    {/* P4-09 / P4-10：两个新来源的 Key 同样就地放在自己的卡片里。 */}
                    {option.value === "tavily" ? (
                      <Input.Password
                        aria-label={t("searchCard.tavily.keyAria")}
                        value={config.tavily_api_key}
                        onChange={(event) => patch({ tavily_api_key: event.target.value })}
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
                        onChange={(event) => patch({ jina_api_key: event.target.value })}
                        placeholder={t("searchCard.jina.keyPlaceholder")}
                        disabled={!usesJina || undefined}
                        allowClear
                        autoComplete="off"
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </SettingsField>

          {/* 长提示移出卡片、放到网格下方全宽显示：既让卡片按内容收缩（卡片内不再留白），
              也保证隐私提示常驻可见——塞进 Tooltip 或折叠区就会被用户忽略（清单 §4.3）。 */}
          {usesDeepseek ? (
            <Alert
              type="warning"
              showIcon
              title={t("searchCard.deepseek.cost")}
              description={t("searchCard.deepseek.privacy")}
              style={{ marginTop: 8 }}
            />
          ) : null}

          {/* 新来源的说明同样是全宽常驻（理由同上：塞进卡片会把卡片撑高留白）。 */}
          {usesTavily ? (
            <Alert
              type="info"
              showIcon
              title={t("searchCard.tavily.note")}
              style={{ marginTop: 8 }}
            />
          ) : null}
          {usesJina ? (
            <Alert
              type="info"
              showIcon
              title={t("searchCard.jina.note")}
              style={{ marginTop: 8 }}
            />
          ) : null}

          <div>
            <Typography.Text strong>{t("searchCard.general.title")}</Typography.Text>
            <Flex vertical gap={16} style={{ marginTop: 8 }}>
              {/* 「搜索深度」整块在 SearchDepthField 里（拆分为守住 500 行预算）；
                  换档只上报新值，400ms 合并保存仍由本卡负责。 */}
              <SearchDepthField value={config.depth} onChange={(depth) => patch({ depth })} />

              <SettingsField
                label={t("searchCard.results.title")}
                hint={t("searchCard.results.hint")}
              >
                {/* addonAfter is deprecated in antd 6: use Space.Compact + Space.Addon instead. */}
                <Space.Compact>
                  <InputNumber
                    aria-label={t("searchCard.results.aria")}
                    min={1}
                    max={MAX_RESULTS_LIMIT}
                    value={config.max_results}
                    onChange={(value) => patch({ max_results: clampMaxResults(value) })}
                  />
                  <Space.Addon>{t("searchCard.results.unit")}</Space.Addon>
                </Space.Compact>
              </SettingsField>
            </Flex>
          </div>

          {saveStatus === "error" && saveError ? (
            <Alert type="error" showIcon title={saveError} />
          ) : null}
        </Flex>
      </LoadingBlock>
    </Card>
  );
}
