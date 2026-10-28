// SPDX-License-Identifier: Apache-2.0
/**
 * 联网搜索设置：来源、正文抓取条数、返回条数。
 *
 * 这些参数一直存在于后端，但此前**没有任何界面能改**：`GET/PUT /api/settings/search`
 * 只有接口没有入口，于是「抓取正文的条数」永远是默认的 0，助手拿到的永远只有摘要。
 * 助手页那个开关是"这次要不要联网"，这里配的是"联网时怎么搜"，两者互不替代。
 *
 * 卡片自带取数与保存（与 `UpdateCard` 一致）：它和模型配置是两套独立设置。
 *
 * **没有保存按钮**：字段常驻可编辑，改动合并 400ms 后自动 PUT；离散勾选与数字框
 * 也一样。校验失败（一个来源都没选、地址不是 http(s)）时只在卡片底部说明，不发请求；
 * 改对后自动重试。这样"改完还要记得点保存"不再是一个会丢配置的步骤。
 */

import { Alert, Card, Checkbox, Input, InputNumber, Space, Typography } from "antd";
import LoadingBlock from "../common/LoadingBlock";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSearchConfig, saveSearchConfig } from "../../api/settings";
import type { SearchConfig, SearchSource } from "../../types";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 与后端 `SearchConfig` 的默认值保持一致，用作取数失败时的兜底草稿。 */
const DEFAULT_CONFIG: SearchConfig = {
  sources: ["bing", "duckduckgo"],
  searxng_url: "",
  fetch_pages: 0,
  max_results: 8,
};

/**
 * 一条搜索来源的显示名。
 *
 * `label` 给品牌名用（`Bing` / `DuckDuckGo`：两种语言写法相同，进词表会被
 * `source-ascii-english` 判成"源文是英文"），`labelKey` 给需要随语言变化的显示名用。
 * 两者都只影响显示；`value` 是提交给后端的协议值，一个字都不动。
 */
interface SourceOption {
  value: SearchSource;
  label?: string;
  labelKey?: MessageKey;
}

const SOURCE_OPTIONS: SourceOption[] = [
  { value: "bing", label: "Bing" },
  { value: "duckduckgo", label: "DuckDuckGo" },
  { value: "searxng", labelKey: "searchCard.source.searxng" },
];

/**
 * 抓取正文的档位。
 *
 * `value` 就是后端 `fetch_pages` 的取值（0 = 只取摘要），原样提交；
 * `labelKey` 只负责显示，在渲染处 `t()`——模块作用域里调 `t()` 会把语言固定在
 * 模块求值那一刻（§8.1）。
 */
const FETCH_PAGE_OPTIONS: { value: number; labelKey: MessageKey }[] = [
  { value: 0, labelKey: "searchCard.fetch.0" },
  { value: 1, labelKey: "searchCard.fetch.1" },
  { value: 2, labelKey: "searchCard.fetch.2" },
  { value: 3, labelKey: "searchCard.fetch.3" },
];

/** 一条来源选项的显示名（品牌名直接用，其余走词表）。 */
function sourceLabel(option: SourceOption): string {
  if (option.labelKey) return t(option.labelKey);
  return option.label ?? option.value;
}

export default function SearchCard() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
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
        setConfig(result.config);
        latest.current = result.config;
      } else {
        setLoadError(result.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchConfig]);

  /** 真正发请求；校验失败时只更新状态，不发请求。 */
  const persist = useCallback(async (next: SearchConfig) => {
    const trimmed = { ...next, searxng_url: next.searxng_url.trim() };
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

  return (
    <Card title={t("searchCard.title")} className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("searchCard.intro")}
      </Typography.Paragraph>

      {loadError && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title={t("searchCard.loadErrorTitle")}
          description={t("searchCard.loadErrorBody", { message: loadError })}
        />
      )}

      <LoadingBlock spinning={loading}>
        <Space orientation="vertical" size="large" style={{ width: "100%" }}>
          <div>
            <Typography.Text strong>{t("searchCard.sources.title")}</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              {t("searchCard.sources.hint")}
            </Typography.Paragraph>
            <Checkbox.Group
              options={SOURCE_OPTIONS.map((option) => ({
                value: option.value,
                label: sourceLabel(option),
              }))}
              value={config.sources}
              onChange={(values) => patch({ sources: values as SearchSource[] })}
            />
          </div>

          <div>
            <Typography.Text strong>{t("searchCard.searxng.title")}</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              {t("searchCard.searxng.hint")}
            </Typography.Paragraph>
            <Input
              value={config.searxng_url}
              onChange={(event) => patch({ searxng_url: event.target.value })}
              placeholder="http://localhost:8080"
              // 只有勾了 SearXNG 才需要填地址：未勾选时禁用以免误以为"必须先填"。
              disabled={!usesSearxng}
              allowClear
            />
          </div>

          <div>
            <Typography.Text strong>{t("searchCard.fetch.title")}</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              {t("searchCard.fetch.hint")}
            </Typography.Paragraph>
            <Space orientation="vertical">
              {FETCH_PAGE_OPTIONS.map((option) => (
                <Checkbox
                  key={option.value}
                  checked={config.fetch_pages === option.value}
                  onChange={() => patch({ fetch_pages: option.value })}
                >
                  {t(option.labelKey)}
                </Checkbox>
              ))}
            </Space>
          </div>

          <div>
            <Typography.Text strong>{t("searchCard.results.title")}</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              {t("searchCard.results.hint")}
            </Typography.Paragraph>
            {/* addonAfter 已废弃（v6）：按官方指引以 Space.Compact + Space.Addon 重组。 */}
            <Space.Compact>
              <InputNumber
                aria-label={t("searchCard.results.aria")}
                min={1}
                max={15}
                value={config.max_results}
                onChange={(value) => patch({ max_results: value ?? DEFAULT_CONFIG.max_results })}
              />
              <Space.Addon>{t("searchCard.results.unit")}</Space.Addon>
            </Space.Compact>
          </div>

          {saveStatus === "saving" ? (
            <Typography.Text type="secondary" className="search-save-status">
              {t("searchCard.saving")}
            </Typography.Text>
          ) : null}
          {saveStatus === "saved" ? (
            <Typography.Text type="secondary" className="search-save-status">
              {t("searchCard.saved")}
            </Typography.Text>
          ) : null}
          {saveStatus === "error" ? (
            <Typography.Text type="danger" className="search-save-status">
              {saveError}
            </Typography.Text>
          ) : null}
        </Space>
      </LoadingBlock>
    </Card>
  );
}
