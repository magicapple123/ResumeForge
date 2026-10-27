// SPDX-License-Identifier: Apache-2.0
/**
 * 站点侧筛选项：把招聘网站**自己的筛选栏**搬进采集条件里。
 *
 * 为什么值得单独一块：站点在接口侧就把不符合的岗位筛掉了，比采回来再筛更快更准——
 * 网站搜索时就完成筛选，结果里不会有不符合的岗位。
 *
 * 两条不能让步的性质：
 *
 * 1. **选项清单来自站点，不是这里写死的。** 写死的一份在站点改编码之后会静默筛错
 *    （用户以为按「本科」筛了，实际发出去的是另一个编码）。清单由后端读来，前端只渲染。
 * 2. **来源要标明。** 浏览器在跑时读到的是"你这个账号可见"的完整清单；没跑时用的是全网
 *    通用清单。两者可能不一样（实测：「求职类型」里「实习」这一档就因人而异），所以
 *    必须让用户知道自己拿到的是哪一份。
 *
 * 「测试是否生效」按钮：把当前选中的项发到后端，在真实站点页面上逐项校验
 * （必要时会导航到筛选栏页读"这个账号可见"的清单），结果逐项展示。
 */
import { ExperimentOutlined, InfoCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import type { SelectProps } from "antd";
import { Alert, App, Button, Form, Select, Space, Spin, Tag, Tooltip, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getCollectFilterOptions, testCollectFilters } from "../../api/apply";
import type {
  CollectFilterGroup,
  CollectFilterOptions,
  CollectFilterSource,
  CollectFilterTestResult,
} from "../../types";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 来源标签：颜色 + 文案 key。文案要说清"这份清单的可信度"，不能只说一个英文枚举值。 */
const SOURCE_TAG: Record<
  CollectFilterSource,
  { color: string; textKey: MessageKey; hintKey: MessageKey }
> = {
  session: {
    color: "green",
    textKey: "collectFilters.source.session.text",
    hintKey: "collectFilters.source.session.hint",
  },
  public: {
    color: "blue",
    textKey: "collectFilters.source.public.text",
    hintKey: "collectFilters.source.public.hint",
  },
  snapshot: {
    color: "orange",
    textKey: "collectFilters.source.snapshot.text",
    hintKey: "collectFilters.source.snapshot.hint",
  },
  unavailable: {
    color: "default",
    textKey: "collectFilters.source.unavailable.text",
    hintKey: "collectFilters.source.unavailable.hint",
  },
};

interface Props {
  /** 是否禁用（有批次在跑时不允许改条件）。 */
  disabled: boolean;
  /** 读取当前表单里选中的站点筛选项（「测试是否生效」用）。 */
  getFilters: () => Record<string, string>;
}

/** antd Select 认得的下拉项形状（含"分组"那一层），用它标注免得 TS 推出一个联合类型。 */
type SelectOptionList = NonNullable<SelectProps["options"]>;

/** 把一组选项折成 antd Select 的 options；行业有 15 个一级分组，要分层展示。 */
function buildOptions(group: CollectFilterGroup): SelectOptionList {
  if (!group.options.some((item) => item.group)) {
    return group.options.map((item) => ({ value: item.code, label: item.label }));
  }
  const grouped = new Map<string, { value: string; label: string }[]>();
  for (const item of group.options) {
    const key = item.group || group.label;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)?.push({ value: item.code, label: item.label });
  }
  return [...grouped].map(([label, options]) => ({ label, options }));
}

export default function CollectSiteFilters({ disabled, getFilters }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const { message } = App.useApp();
  const [data, setData] = useState<CollectFilterOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<CollectFilterTestResult | null>(null);

  // 纯取数（不含 setState）：effect 内联调用时 Compiler 才能验证非同步更新。
  const fetchOptions = useCallback(async (): Promise<CollectFilterOptions | null> => {
    try {
      return await getCollectFilterOptions();
    } catch {
      return null;
    }
  }, []);

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const options = await fetchOptions();
      if (cancelled) return;
      if (options !== null) {
        setData(options);
        setFailed(false);
      } else {
        // 读不到就当"这个站点没有站点侧筛选"：它是可选能力，不该挡住整个采集表单。
        setFailed(true);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchOptions]);

  // 事件路径（手动重试按钮，含 loading/failed 翻动）。
  const load = useCallback(async () => {
    setLoading(true);
    const options = await fetchOptions();
    if (options !== null) {
      setData(options);
      setFailed(false);
    } else {
      setFailed(true);
    }
    setLoading(false);
  }, [fetchOptions]);

  const groups = useMemo(
    () => (data?.groups ?? []).filter((group) => group.options.length > 0),
    [data],
  );
  // 来源**按值去重**：七个分组通常来自同一处，逐个渲染就会并排出现七个一模一样的标签，
  // 那不是在说明来源，只是在制造噪声。混了来源时才逐条列出。
  const sources = useMemo(() => [...new Set(groups.map((group) => group.source))], [groups]);

  // 「测试是否生效」：把当前表单里选中的项发到后端，在真实站点页面上逐项校验。
  const runTest = useCallback(async () => {
    if (testing) return;
    const raw = getFilters();
    const selected = Object.fromEntries(
      Object.entries(raw || {}).filter(([, code]) => (code || "").trim() !== ""),
    );
    if (Object.keys(selected).length === 0) {
      message.info(t("collectFilters.toast.needCondition"));
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testCollectFilters(selected);
      setTestResult(result);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("collectFilters.toast.testFailed"));
    } finally {
      setTesting(false);
    }
  }, [getFilters, message, testing]);

  if (failed && !data) {
    return (
      <Alert
        type="warning"
        showIcon
        title={t("collectFilters.unread.title")}
        description={t("collectFilters.unread.body")}
        action={
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>
            {t("collectFilters.action.reload")}
          </Button>
        }
        style={{ marginBottom: 12 }}
      />
    );
  }
  if (loading && groups.length === 0) {
    // 清单还在读取：渲染一个占位而不是整个消失——用户进入采集页签时若这块是空的，
    // 会误以为"没有站点筛选功能"（实测反馈）。
    return (
      <div className="apply-collect-site-filters">
        <Space size={8} wrap style={{ marginBottom: 4 }}>
          <Typography.Text strong>{t("collectFilters.section.title")}</Typography.Text>
          <Spin size="small" />
          <Typography.Text type="secondary">{t("collectFilters.section.loading")}</Typography.Text>
        </Space>
      </div>
    );
  }
  if (groups.length === 0) return null;

  const sessionRead = data?.session_read ?? false;

  return (
    <div className="apply-collect-site-filters">
      <Space size={8} wrap style={{ marginBottom: 4 }}>
        <Typography.Text strong>{t("collectFilters.section.title")}</Typography.Text>
        {sources.map((source) => {
          const meta = SOURCE_TAG[source] ?? SOURCE_TAG.unavailable;
          return (
            <Tooltip key={`tag-${source}`} title={t(meta.hintKey)}>
              <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
                {t(meta.textKey)}
              </Tag>
            </Tooltip>
          );
        })}
        <Button
          size="small"
          type="link"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => void load()}
        >
          {t("collectFilters.action.reload")}
        </Button>
        <Tooltip title={t("collectFilters.test.hint")}>
          <Button
            size="small"
            type="link"
            icon={<ExperimentOutlined />}
            loading={testing}
            onClick={() => void runTest()}
          >
            {t("collectFilters.action.test")}
          </Button>
        </Tooltip>
      </Space>

      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
        <InfoCircleOutlined /> {t("collectFilters.intro")}
      </Typography.Text>

      {!sessionRead && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title={t("collectFilters.launch.title")}
          description={t("collectFilters.launch.body")}
        />
      )}

      {testing && <Spin size="small" style={{ marginBottom: 8 }} />}

      {testResult && (
        <Alert
          type={testResult.unapplied.length > 0 ? "warning" : "success"}
          showIcon
          style={{ marginBottom: 12 }}
          title={
            testResult.unapplied.length > 0
              ? t("collectFilters.result.partial", { count: testResult.unapplied.length })
              : t("collectFilters.result.all")
          }
          description={
            <Space orientation="vertical" size={4} style={{ width: "100%" }}>
              {testResult.applied.map((item) => (
                <Typography.Text key={item.key}>
                  <Tag color="success" style={{ marginInlineEnd: 4 }}>
                    {t("collectFilters.result.applied")}
                  </Tag>
                  {t("collectFilters.result.itemLabel", { label: item.label, value: item.value })}
                </Typography.Text>
              ))}
              {testResult.unapplied.map((item) => (
                <Typography.Text key={item.key} type="warning">
                  <Tag color="warning" style={{ marginInlineEnd: 4 }}>
                    {t("collectFilters.result.unapplied")}
                  </Tag>
                  {t("collectFilters.result.itemDetail", {
                    label: item.label,
                    value: item.value,
                    detail: item.detail,
                  })}
                </Typography.Text>
              ))}
              {testResult.unlimited.map((item) => (
                <Typography.Text key={item.key} type="secondary">
                  <Tag style={{ marginInlineEnd: 4 }}>{t("collectFilters.tag.any")}</Tag>
                  {t("collectFilters.result.unlimited", {
                    label: item.label,
                    detail: item.detail,
                  })}
                </Typography.Text>
              ))}
            </Space>
          }
        />
      )}

      {/* align="start"：说明文字换行会把某项撑高，居中对齐会让旁边的下拉"浮"在半空——
          顶边对齐后各列控件在同一水平线上。 */}
      <Space size={16} wrap align="start">
        {groups.map((group) => (
          <Form.Item key={group.key} name={["filters", group.key]} label={group.label}>
            <Select
              allowClear
              showSearch
              disabled={disabled}
              placeholder={t("collectFilters.tag.any")}
              style={{ width: group.key === "industry" ? 240 : 170 }}
              optionFilterProp="label"
              // 选项多（行业 145 条）时要能搜；分组用 antd 的嵌套 options。
              options={buildOptions(group)}
              aria-label={t("collectFilters.aria.group", { label: group.label })}
            />
          </Form.Item>
        ))}
      </Space>
    </div>
  );
}
