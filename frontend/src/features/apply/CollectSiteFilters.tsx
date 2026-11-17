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
import { ExperimentOutlined, ReloadOutlined } from "@ant-design/icons";
import type { SelectProps } from "antd";
import {
  Alert,
  App,
  Button,
  Dropdown,
  Form,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
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
import HintDetail from "../../components/common/HintDetail";

/** 来源标签：颜色 + 文案 key。文案要说清"这份清单的可信度"，不能只说一个英文枚举值。
 *
 * 2026-11-17：四个来源合并成**一个**状态徽标（原来并排多个 `Tag` + 一条琥珀提示条，
 * 既重复又抢眼）。颜色只有三档：真实读到 = 绿、通用/快照 = 灰、读不到 = 红。 */
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
    color: "default",
    textKey: "collectFilters.source.public.text",
    hintKey: "collectFilters.source.public.hint",
  },
  snapshot: {
    color: "default",
    textKey: "collectFilters.source.snapshot.text",
    hintKey: "collectFilters.source.snapshot.hint",
  },
  unavailable: {
    color: "error",
    textKey: "collectFilters.status.failed",
    hintKey: "collectFilters.source.unavailable.hint",
  },
};

interface Props {
  /** 是否禁用（有批次在跑时不允许改条件）。 */
  disabled: boolean;
  /** 读取当前表单里选中的站点筛选项（「测试是否生效」用）。 */
  getFilters: () => Record<string, string[]>;
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

/** 表单里的值可能是单值（单选组）或数组（多选组/旧快照），统一折成编码数组。 */
function toCodes(value: unknown): string[] {
  if (value === null || value === undefined || value === "") return [];
  const items = Array.isArray(value) ? value : [value];
  const codes: string[] = [];
  for (const item of items) {
    const code = item === null || item === undefined ? "" : String(item).trim();
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

/** 联动判定：没有规则 = 可见；有规则时控制组的当前编码必须落在白名单里。 */
function isGroupVisible(group: CollectFilterGroup, controllerCode: string): boolean {
  if (!group.visible_when) return true;
  return group.visible_when.values.includes(controllerCode);
}

export default function CollectSiteFilters({ disabled, getFilters }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const { message } = App.useApp();
  const form = Form.useFormInstance();
  // 联动只看「求职类型」：站点实测它决定薪资/结算方式/兼职时间哪些格子可见（§15.2）。
  const jobTypeValue = Form.useWatch(["filters", "jobType"], form);
  const currentJobType = toCodes(jobTypeValue)[0] ?? "";
  // 「已选 N 项」：只数**有值的组**（多选按组算一项）。七个下拉全是「不限」时，
  // 界面上没有任何进度感，用户不知道自己是"没设条件"还是"设了但没生效"。
  const filtersValue = Form.useWatch("filters", form) as Record<string, unknown> | undefined;
  const selectedCount = useMemo(
    () => Object.values(filtersValue ?? {}).filter((value) => toCodes(value).length > 0).length,
    [filtersValue],
  );
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

  const allGroups = useMemo(
    () => (data?.groups ?? []).filter((group) => group.options.length > 0),
    [data],
  );
  // 联动（§15.2 实测）：兼职时「薪资待遇」整组消失，换成「结算方式 + 兼职时间」；
  // 规则由后端随清单下发（visible_when），前端不写死站点规则。
  const groups = useMemo(
    () => allGroups.filter((group) => isGroupVisible(group, currentJobType)),
    [allGroups, currentJobType],
  );
  const hiddenKeys = useMemo(
    () =>
      allGroups.filter((group) => !isGroupVisible(group, currentJobType)).map((group) => group.key),
    [allGroups, currentJobType],
  );
  // 切走时清空被隐藏组的**残留值**：只做显隐不清值，历史配置里那组编码仍会被发出去
  // （站点会忽略它，但界面可能谎报"已生效"——清单 §15.4-2）。
  useEffect(() => {
    for (const key of hiddenKeys) {
      if (toCodes(form.getFieldValue(["filters", key])).length > 0) {
        form.setFieldValue(["filters", key], undefined);
      }
    }
  }, [hiddenKeys, form]);
  // 来源**按值去重**后只报一个状态：混了来源时按"最保守"的那个说——一组没读到时
  // 不能显示"已读取真实选项"，否则用户会以为整份清单都可信。
  const sources = useMemo(() => [...new Set(groups.map((group) => group.source))], [groups]);
  const statusSource: CollectFilterSource = sources.includes("unavailable")
    ? "unavailable"
    : data?.session_read
      ? "session"
      : sources.includes("snapshot")
        ? "snapshot"
        : "public";
  const statusMeta = SOURCE_TAG[statusSource];
  // 一段说明按整句拼：每条一个语言包 key（英文语序各自成立），`\n` 由 HintDetail 分段。
  const introDetail = [
    t("collectFilters.intro"),
    t("collectFilters.intro.rules"),
    t("collectFilters.intro.breadth"),
    t("collectFilters.launch.title"),
    t("collectFilters.launch.body"),
  ].join("\n");

  // 「测试是否生效」：把当前表单里选中的项发到后端，在真实站点页面上逐项校验。
  const runTest = useCallback(async () => {
    if (testing) return;
    const raw = getFilters();
    const selected: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(raw || {})) {
      const codes = toCodes(value);
      if (codes.length > 0) selected[key] = codes;
    }
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
    // 这一态不参与"段间合并"：它是整块读不到时的独立提示，需要自己的一层外观
    // （`.is-standalone` 在 applyCollectForm.css 里补回）。
    return (
      <div className="apply-collect-site-filters is-standalone">
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
        />
      </div>
    );
  }
  if (loading && groups.length === 0) {
    // 清单还在读取：渲染一个占位而不是整个消失——用户进入采集页签时若这块是空的，
    // 会误以为"没有站点筛选功能"（实测反馈）。
    return (
      <div className="apply-collect-site-filters is-standalone">
        {/* 结构与加载完成后的那一份保持一致（head > title > Text）：
            否则占位树与正式树的首个子节点类型不同，React 会整块重建，
            `findByText(title)` 拿到的是已被替换掉的旧节点（用例会报 detached）。 */}
        <div className="apply-collect-site-head">
          <Space size={8} wrap className="apply-collect-site-title">
            <Typography.Text strong>{t("collectFilters.section.title")}</Typography.Text>
            <Spin size="small" />
            <Typography.Text type="secondary">
              {t("collectFilters.section.loading")}
            </Typography.Text>
          </Space>
        </div>
      </div>
    );
  }
  if (groups.length === 0) return null;

  return (
    <div className="apply-collect-site-filters">
      {/* 头部只剩「身份」与「动作」两栏。三颗按钮（重新读取 / 测试是否生效 / 说明）
          收成「检查」下拉 + `ⓘ`：这两件事都是"核查清单"，低频且互斥。
          「已选 N 项」仍是这一块唯一的进度感来源。 */}
      <div className="apply-collect-site-head">
        <Space size={8} wrap className="apply-collect-site-title">
          <Typography.Text strong>{t("collectFilters.section.title")}</Typography.Text>
          {selectedCount > 0 && (
            <span className="apply-collect-selected-chip">
              {t("applyCollect.filters.selected", { count: selectedCount })}
            </span>
          )}
          <Tooltip title={t(statusMeta.hintKey)}>
            <Tag color={statusMeta.color} style={{ marginInlineEnd: 0 }}>
              {t(statusMeta.textKey)}
            </Tag>
          </Tooltip>
          {/* 两段常驻说明（哪些单选/多选、选多了会怎样、清单从哪来）收进 `ⓘ`：
              它们读一遍就够，常驻只会把七个下拉推到首屏之外。 */}
          <HintDetail detail={introDetail} label={t("collectFilters.intro.hintAria")} />
        </Space>
        <Space size={4} wrap={false}>
          {(loading || testing) && <Spin size="small" />}
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                {
                  key: "reload",
                  icon: <ReloadOutlined />,
                  label: t("collectFilters.action.reload"),
                },
                {
                  key: "test",
                  icon: <ExperimentOutlined />,
                  label: t("collectFilters.action.test"),
                },
              ],
              onClick: ({ key }) => {
                if (key === "reload") void load();
                else void runTest();
              },
            }}
          >
            {/* aria-label 与可见文字一致：antd 会给两字中文按钮插空格（「检 查」），
                显式命名让读屏与测试都拿到稳定的一串。 */}
            <Button size="small" aria-label={t("collectFilters.action.check")}>
              {t("collectFilters.action.check")}
            </Button>
          </Dropdown>
          {/* I-17：46 字的"会临时导航到筛选栏、测试完不影响采集"原本挂在这颗按钮的
              tooltip 上——用户点之前看不到，而那正是决定"敢不敢点"的一句。改成 `ⓘ`。 */}
          <HintDetail
            detail={t("collectFilters.test.hint")}
            label={t("collectFilters.test.hintAria")}
          />
        </Space>
      </div>

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
      <div className="apply-collect-site-grid">
        {groups.map((group) => (
          <Form.Item key={group.key} name={["filters", group.key]} label={group.label}>
            <Select
              // 多选/单选由后端能力表决定（§15.2 实测）：求职类型与薪资待遇是单选，其余多选。
              mode={group.multi ? "multiple" : undefined}
              maxTagCount="responsive"
              allowClear
              showSearch
              disabled={disabled || undefined}
              placeholder={t("collectFilters.tag.any")}
              style={{ width: "100%" }}
              optionFilterProp="label"
              // 选项多（行业 145 条）时要能搜；分组用 antd 的嵌套 options。
              options={buildOptions(group)}
              aria-label={t("collectFilters.aria.group", { label: group.label })}
            />
          </Form.Item>
        ))}
      </div>
    </div>
  );
}
