/**
 * 联网搜索设置：来源、正文抓取条数、返回条数。
 *
 * 这些参数一直存在于后端，但此前**没有任何界面能改**：`GET/PUT /api/settings/search`
 * 只有接口没有入口，于是「抓取正文的条数」永远是默认的 0，助手拿到的永远只有摘要。
 * 助手页那个开关是"这次要不要联网"，这里配的是"联网时怎么搜"，两者互不替代。
 *
 * 卡片自带取数与保存（与 `UpdateCard` 一致）：它和上面的模型配置是两套独立设置，
 * 复用「编辑设置」那个全局编辑态只会让用户分不清"我改的这一项保存了没有"。
 */

import { ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import {
  App,
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  InputNumber,
  Space,
  Spin,
  Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { getSearchConfig, saveSearchConfig } from "../../api/settings";
import type { SearchConfig, SearchSource } from "../../types";

/** 与后端 `SearchConfig` 的默认值保持一致，用作取数失败时的兜底草稿。 */
const DEFAULT_CONFIG: SearchConfig = {
  sources: ["bing", "duckduckgo"],
  searxng_url: "",
  fetch_pages: 0,
  max_results: 8,
};

const SOURCE_OPTIONS: { value: SearchSource; label: string }[] = [
  { value: "bing", label: "Bing" },
  { value: "duckduckgo", label: "DuckDuckGo" },
  { value: "searxng", label: "SearXNG（自建实例）" },
];

const FETCH_PAGE_OPTIONS = [
  { value: 0, label: "只取摘要（最快）" },
  { value: 1, label: "抓前 1 条正文" },
  { value: 2, label: "抓前 2 条正文" },
  { value: 3, label: "抓前 3 条正文（最详细，也最慢）" },
];

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
  const { message } = App.useApp();
  const [config, setConfig] = useState<SearchConfig>(DEFAULT_CONFIG);
  const [saved, setSaved] = useState<SearchConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const loaded = await getSearchConfig();
      setConfig(loaded);
      setSaved(loaded);
    } catch (err) {
      // 取不到就把默认值当草稿，但要说清楚——否则用户会以为看到的是自己存过的设置。
      setLoadError(err instanceof Error ? err.message : "加载联网搜索设置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (changes: Partial<SearchConfig>) =>
    setConfig((current) => ({ ...current, ...changes }));

  const save = async () => {
    if (saving) return;
    const trimmed = { ...config, searxng_url: config.searxng_url.trim() };
    // 后端 `sources` 要求至少一项。前端先拦一道，省得用户点了保存才收到一个 422。
    if (trimmed.sources.length === 0) {
      message.error("至少要选一个搜索来源");
      return;
    }
    if (trimmed.searxng_url && !/^https?:\/\//i.test(trimmed.searxng_url)) {
      message.error("SearXNG 地址要以 http:// 或 https:// 开头");
      return;
    }
    setSaving(true);
    try {
      const result = await saveSearchConfig(trimmed);
      setConfig(result);
      setSaved(result);
      message.success("已保存联网搜索设置");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存联网搜索设置失败");
    } finally {
      setSaving(false);
    }
  };

  const usesSearxng = config.sources.includes("searxng");
  const dirty = !sameConfig(config, saved);

  return (
    <Card title="联网搜索" className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        这里配的是助手「联网搜索」开关打开时**怎么搜**；助手页那个开关决定这一次要不要联网。
        抓取正文能拿到比摘要更完整的页面内容，但每次搜索会慢一些，也可能被站点拒绝。
      </Typography.Paragraph>

      {loadError && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title="没能读取已保存的设置"
          description={`${loadError}。下面显示的是默认值，保存会覆盖服务端当前的设置。`}
        />
      )}

      <Spin spinning={loading}>
        <Space orientation="vertical" size="large" style={{ width: "100%" }}>
          <div>
            <Typography.Text strong>搜索来源</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              多个来源会并发查询后合并去重，至少选一个。
            </Typography.Paragraph>
            <Checkbox.Group
              options={SOURCE_OPTIONS}
              value={config.sources}
              onChange={(values) => patch({ sources: values as SearchSource[] })}
            />
          </div>

          <div>
            <Typography.Text strong>SearXNG 实例地址</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              公共实例经常限流，所以不预置默认值；填了自己的实例地址才会去查它，例如{" "}
              <code>http://localhost:8080</code>。不选 SearXNG 来源时可以留空。
            </Typography.Paragraph>
            <Input
              value={config.searxng_url}
              onChange={(event) => patch({ searxng_url: event.target.value })}
              placeholder="http://localhost:8080"
              disabled={!usesSearxng}
              allowClear
            />
          </div>

          <div>
            <Typography.Text strong>抓取正文的条数</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              对排序最靠前的几条结果打开页面读取正文。关闭时助手只能看到搜索摘要。
            </Typography.Paragraph>
            <Space orientation="vertical">
              {FETCH_PAGE_OPTIONS.map((option) => (
                <Checkbox
                  key={option.value}
                  checked={config.fetch_pages === option.value}
                  onChange={() => patch({ fetch_pages: option.value })}
                >
                  {option.label}
                </Checkbox>
              ))}
            </Space>
          </div>

          <div>
            <Typography.Text strong>每次返回的结果条数</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              1~15 条。条数越多，占用模型的上下文越多。
            </Typography.Paragraph>
            {/* addonAfter 已废弃（v6）：按官方指引以 Space.Compact + Space.Addon 重组。 */}
            <Space.Compact>
              <InputNumber
                min={1}
                max={15}
                value={config.max_results}
                onChange={(value) => patch({ max_results: value ?? DEFAULT_CONFIG.max_results })}
              />
              <Space.Addon>条</Space.Addon>
            </Space.Compact>
          </div>

          <Space wrap>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              disabled={!dirty}
              onClick={() => void save()}
            >
              保存搜索设置
            </Button>
            <Button
              icon={<ReloadOutlined />}
              disabled={loading || saving}
              onClick={() => void load()}
            >
              重新读取
            </Button>
            {dirty && <Typography.Text type="warning">有未保存的改动</Typography.Text>}
          </Space>
        </Space>
      </Spin>
    </Card>
  );
}
