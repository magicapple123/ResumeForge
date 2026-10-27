// SPDX-License-Identifier: Apache-2.0
/**
 * 联网搜索设置：来源、正文抓取条数、返回条数。
 *
 * 这些参数一直存在于后端，但此前**没有任何界面能改**：`GET/PUT /api/settings/search`
 * 只有接口没有入口，于是「抓取正文的条数」永远是默认的 0，助手拿到的永远只有摘要。
 * 助手页那个开关是"这次要不要联网"，这里配的是"联网时怎么搜"，两者互不替代。
 *
 * 卡片自带取数与保存（与 `UpdateCard` 一致）：它和上面的模型配置是两套独立设置。
 * 交互是「查看态 → 编辑态」（用户要求）：字段默认灰色只读，点「编辑搜索设置」解锁，
 * 编辑时按钮换成「保存搜索设置 + 取消」；卡片右上角常驻「编辑搜索设置」入口。
 */

import { SaveOutlined } from "@ant-design/icons";
import {
  App,
  Alert,
  Button,
  Card,
  Checkbox,
  Flex,
  Input,
  InputNumber,
  Space,
  Typography,
} from "antd";
import LoadingBlock from "../common/LoadingBlock";
import { useCallback, useEffect, useState } from "react";
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

/** 两个设置项是否一致；用来决定保存按钮要不要亮。 */
function sameConfig(left: SearchConfig, right: SearchConfig): boolean {
  return (
    left.fetch_pages === right.fetch_pages &&
    left.max_results === right.max_results &&
    left.searxng_url.trim() === right.searxng_url.trim() &&
    // 顺序不算差异：勾选框的先后不改变任何行为，后端也会去重。
    [...left.sources].sort().join("\u0000") === [...right.sources].sort().join("\u0000")
  );
}

export default function SearchCard() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const { message } = App.useApp();
  const [config, setConfig] = useState<SearchConfig>(DEFAULT_CONFIG);
  const [saved, setSaved] = useState<SearchConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  // 查看态 → 编辑态（用户要求的交互）：字段默认灰色只读，点「编辑搜索设置」解锁；
  // 编辑时按钮换成「保存搜索设置 + 取消」，保存成功或取消都回到查看态。
  const [editing, setEditing] = useState(false);

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
        setSaved(result.config);
      } else {
        setLoadError(result.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchConfig]);

  const patch = (changes: Partial<SearchConfig>) =>
    setConfig((current) => ({ ...current, ...changes }));

  // 取消编辑：丢弃未保存改动，回到查看态（不重新发请求）。
  const cancelEdit = () => {
    setConfig(saved);
    setEditing(false);
  };

  const save = async () => {
    if (saving) return;
    const trimmed = { ...config, searxng_url: config.searxng_url.trim() };
    // 后端 `sources` 要求至少一项。前端先拦一道，省得用户点了保存才收到一个 422。
    if (trimmed.sources.length === 0) {
      message.error(t("searchCard.needSource"));
      return;
    }
    if (trimmed.searxng_url && !/^https?:\/\//i.test(trimmed.searxng_url)) {
      message.error(t("searchCard.badUrl"));
      return;
    }
    setSaving(true);
    try {
      const result = await saveSearchConfig(trimmed);
      setConfig(result);
      setSaved(result);
      message.success(t("searchCard.saved"));
      // 保存完成即编辑结束：回查看态（字段重新变灰）。
      setEditing(false);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("searchCard.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const usesSearxng = config.sources.includes("searxng");
  const dirty = !sameConfig(config, saved);
  // 查看态字段整体只读；SearXNG 输入框叠加原条件（未选该来源时也禁用）。
  const fieldsDisabled = !editing;
  // 卡片右上角：查看态是「编辑搜索设置」入口（编辑态换回保存/取消，在右下角）。
  const editEntry = (
    <Button type="primary" onClick={() => setEditing(true)}>
      {t("searchCard.edit")}
    </Button>
  );

  return (
    <Card title={t("searchCard.title")} className="settings-card" extra={editEntry}>
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
              disabled={fieldsDisabled}
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
              disabled={fieldsDisabled || !usesSearxng}
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
                  disabled={fieldsDisabled}
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
                disabled={fieldsDisabled}
                onChange={(value) => patch({ max_results: value ?? DEFAULT_CONFIG.max_results })}
              />
              <Space.Addon>{t("searchCard.results.unit")}</Space.Addon>
            </Space.Compact>
          </div>

          {/* 编辑态的操作区在右下角；查看态入口在卡片右上角（extra）。 */}
          <Flex justify="flex-end" wrap gap={8}>
            {editing && (
              <>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={saving}
                  disabled={!dirty}
                  onClick={() => void save()}
                >
                  {t("searchCard.action.save")}
                </Button>
                <Button disabled={saving} onClick={cancelEdit}>
                  {t("common.action.cancel")}
                </Button>
                {dirty && <Typography.Text type="warning">{t("searchCard.dirty")}</Typography.Text>}
              </>
            )}
          </Flex>
        </Space>
      </LoadingBlock>
    </Card>
  );
}
