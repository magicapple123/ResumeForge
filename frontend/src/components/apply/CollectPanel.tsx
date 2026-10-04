/**
 * 自动采集：设置关键词/城市/筛选条件后显式开始，并把无法映射的条件如实标为「未生效」。
 *
 * 为什么要把「未生效」单独拎出来：关键词 + 城市 + 翻页是站点一定能接受的，而薪资/经验/
 * 学历/岗位类型能不能落到查询参数取决于站点——若不明确提示，用户会以为筛选生效了，实际却把
 * 不符合条件的岗位也采了进来。后端把这些条件写进 `task.config["unmapped_conditions"]`，
 * 界面据此显示。
 */
import { Alert, App, Form, Select, Skeleton, Space, Typography } from "antd";
import { RowActions } from "../common/RowActions";
import { useEffect, useState } from "react";
import { createCollectTask, getCollectConfig, updateCollectConfig } from "../../api/apply";
import { useApi } from "../../hooks/useApi";
import type { ApplyTask, ApplyTaskDetail, CollectConfig, CollectConfigOut } from "../../types";
import CollectResultPanel from "./CollectResultPanel";
import CollectConfigForm from "./collect/CollectConfigForm";
import CollectOutcomeAlerts from "./collect/CollectOutcomeAlerts";
import {
  CONFIG_HISTORY_KEY,
  CONFIG_HISTORY_MAX,
  historySummaryLabel,
  readConfigHistory,
  writeConfigHistory,
} from "./collect/collectConfigHistory";
import type { CollectConfigSnapshot } from "./collect/collectConfigHistory";
import { filterSummary, siteFilterSummary, unmappedConditions } from "./collect/collectTaskSummary";

interface Props {
  disabled: boolean;
  onStarted: (task: ApplyTask) => void;
  /** 最近一次采集批次：用来读取「未生效」条件。 */
  collectTask: ApplyTaskDetail | null;
}

export default function CollectPanel({ disabled, onStarted, collectTask }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<CollectConfig>();
  const { data, loading, error } = useApi<CollectConfigOut>(getCollectConfig, []);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  // 是否保存本次抓到的站点原文。默认不勾选——往磁盘写站点数据必须由用户显式开启。
  const [saveSamples, setSaveSamples] = useState(false);
  // 历史条件快照（localStorage 读取，最新在前）。
  const [history, setHistory] = useState<CollectConfigSnapshot[]>(() => readConfigHistory());
  const [historyValue, setHistoryValue] = useState<string | undefined>(undefined);
  // 岗位类型的筛选方式标签随所选值变化（站点筛选 / 采集后筛选）。
  const jobTypeValue = Form.useWatch("job_type", form);

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  /** 把当前表单整份快照存入历史（去重 + 上限 20）。 */
  const pushHistory = (config: CollectConfig) => {
    const savedAt = new Date().toISOString();
    setHistory((prev) => {
      const next = [
        { savedAt, config },
        ...prev.filter((entry) => JSON.stringify(entry.config) !== JSON.stringify(config)),
      ].slice(0, CONFIG_HISTORY_MAX);
      writeConfigHistory(next);
      return next;
    });
    setHistoryValue(savedAt);
  };

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await updateCollectConfig(values);
      pushHistory(values as CollectConfig);
      message.success("采集条件已保存");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存采集条件失败");
    } finally {
      setSaving(false);
    }
  };

  /** 选中某条历史 → 回填表单。 */
  const applyHistory = (savedAt: string) => {
    const snapshot = history.find((entry) => entry.savedAt === savedAt);
    if (snapshot) {
      form.setFieldsValue(snapshot.config);
      setHistoryValue(savedAt);
    }
  };

  const clearHistory = () => {
    setHistory([]);
    setHistoryValue(undefined);
    localStorage.removeItem(CONFIG_HISTORY_KEY);
  };

  const start = async () => {
    // 开始前先保存，避免"改了条件但用的是旧值"这种静默落差。
    const values = await form.validateFields();
    if (!values.keywords?.length && !values.city?.trim()) {
      message.warning("请至少填写一个关键词或城市");
      return;
    }
    setStarting(true);
    try {
      await updateCollectConfig(values);
      const task = await createCollectTask(saveSamples);
      message.success(
        saveSamples
          ? "已开始采集，进度见下方；本次会保存站点原文到 backend/data/captures/，完成时也会提示具体目录"
          : "已开始采集，进度见下方",
      );
      onStarted(task);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "开始采集失败");
    } finally {
      setStarting(false);
    }
  };

  if (loading && !data) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (error && !data) return <Alert type="error" showIcon title={error} />;

  const unmapped = unmappedConditions(collectTask);
  const filtered = filterSummary(collectTask);
  const siteFiltered = siteFilterSummary(collectTask);

  return (
    <div className="apply-collect-panel">
      {/* 用户反馈过"采完了只显示成功，不知道下一步做什么"。采集只是第一步、而且**不会**直接
          进岗位广场，所以这里把后面两步明确写出来，并指出每一步在哪个页签。 */}
      <Alert
        className="apply-collect-flow"
        type="info"
        showIcon
        title="采集之后还有两步才轮到投递"
        description={
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              采集把岗位放进下面的<span className="apply-collect-flow-em">「本次采集结果」</span>，
              <Typography.Text strong>不会</Typography.Text>直接进岗位广场——采到的噪声由你筛掉。
            </li>
            <li>在结果里勾选要留下的岗位，点「导入选中的岗位」。</li>
            <li>
              到<span className="apply-collect-flow-em">「投递队列」</span>
              把它们排进队列并显式开始投递， 结果在
              <span className="apply-collect-flow-em">「投递记录」</span>里看。
            </li>
          </ol>
        }
      />

      <Space size={8} wrap style={{ marginBottom: 12 }}>
        <Select
          aria-label="历史条件"
          placeholder="历史条件"
          allowClear
          style={{ minWidth: 320 }}
          value={historyValue}
          onChange={(value) => {
            if (value) applyHistory(value as string);
            else setHistoryValue(undefined);
          }}
          options={history.map((entry) => ({
            value: entry.savedAt,
            label: historySummaryLabel(entry),
          }))}
        />
        {/* 清空历史不可恢复，同样收进「···」菜单（全局约定：破坏性入口不裸露）。 */}
        <RowActions
          more={[
            {
              key: "clear-history",
              label: "清空历史",
              danger: true,
              confirm: "清空历史条件？会删除全部已保存的采集条件快照，且不可恢复。",
              onClick: clearHistory,
            },
          ]}
        />
      </Space>

      <CollectConfigForm
        form={form}
        jobTypeValue={jobTypeValue}
        saveSamples={saveSamples}
        onSaveSamplesChange={setSaveSamples}
        disabled={disabled}
        saving={saving}
        starting={starting}
        onSave={() => void save()}
        onStart={() => void start()}
      />

      <CollectOutcomeAlerts unmapped={unmapped} filtered={filtered} siteFiltered={siteFiltered} />

      {/* 采集结果只陈列、不入库：勾选后才进岗位广场。 */}
      <CollectResultPanel
        taskId={collectTask?.id ?? null}
        disabled={disabled}
        refreshKey={`${collectTask?.status ?? ""}-${collectTask?.processed ?? 0}-${collectTask?.finished_at ?? ""}`}
      />
    </div>
  );
}
