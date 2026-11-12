// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「求职助手 · 运行上限与上下文压缩」卡（需求 #5 + #10）。
 *
 * 两块内容共用**一个保存按钮**：
 * 1. 运行上限：一次回复最多几轮工具调用、整条回复最多跑多少秒。默认 30 轮 / 1800 秒。
 * 2. 上下文压缩：摘要模型（可留空 = 跟随当前对话模型）+ 遮蔽 / 摘要两个百分比阈值。
 *
 * 为什么合并成一次提交：两类参数都是**全局**的，误触一次就影响所有人的下一轮对话；
 * 用户改完通常要"立刻跑一次验证"，一次点击落库两项，比两次点击更容易说清"什么时候生效"。
 * 两个接口各自整对象 PUT（后端契约不变），前端只在某项真的改过时才发那一次请求。
 *
 * 为什么前端先校验阈值：后端对越界与"遮蔽 ≥ 摘要"返回 422，但让用户填完再吃一个错误弹窗
 * 体验很差。前端用与后端**同一口径**（1–99 且摘要 > 遮蔽）直接禁用保存并给 inline 提示，
 * 同时不做静默夹取——夹取会悄悄改掉用户填的数字。
 */
import { App, Button, Card, Input, InputNumber, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import LoadingBlock from "../../components/common/LoadingBlock";
import {
  getAssistantCompactionSetting,
  getAssistantLimitSetting,
  saveAssistantCompactionSetting,
  saveAssistantLimitSetting,
} from "../../api/settings";
import type { AssistantCompactionSetting, AssistantLimitSetting } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

// 与后端 schema 的 ge/le 逐项一致：前端先挡一层，用户不必等一次 422 才知道越界。
const ROUNDS_MIN = 1;
const ROUNDS_MAX = 100;
const BUDGET_MIN = 1;
const BUDGET_MAX = 86400;
// 压缩阈值是"窗口占用百分比"，后端同样限定 1–99（0% 会每次请求都压缩，100% 永远不触发）。
const PERCENT_MIN = 1;
const PERCENT_MAX = 99;

/** 后端缺省值（`services/assistant/assistant_compaction.py` 的常量）：读失败时占位用。 */
const COMPACTION_DEFAULTS: AssistantCompactionSetting = {
  model: "",
  mask_percent: 60,
  summary_percent: 75,
};

const LIMIT_DEFAULTS: AssistantLimitSetting = {
  max_tool_rounds: 30,
  stream_budget_seconds: 1800,
};

export default function AssistantLimitCard() {
  // 本组件用模块级 t()：必须订阅语言变化。
  useLocale();
  const { message } = App.useApp();
  const [rounds, setRounds] = useState(LIMIT_DEFAULTS.max_tool_rounds);
  const [budget, setBudget] = useState(LIMIT_DEFAULTS.stream_budget_seconds);
  const [savedLimits, setSavedLimits] = useState<AssistantLimitSetting>(LIMIT_DEFAULTS);
  const [model, setModel] = useState(COMPACTION_DEFAULTS.model);
  const [maskPercent, setMaskPercent] = useState(COMPACTION_DEFAULTS.mask_percent);
  const [summaryPercent, setSummaryPercent] = useState(COMPACTION_DEFAULTS.summary_percent);
  const [savedCompaction, setSavedCompaction] =
    useState<AssistantCompactionSetting>(COMPACTION_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）。
  // 两组设置**各自** try：压缩接口读失败不该把上限一起打回默认值（反之亦然）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const current = await getAssistantLimitSetting();
        if (!cancelled) {
          setRounds(current.max_tool_rounds);
          setBudget(current.stream_budget_seconds);
          setSavedLimits({
            max_tool_rounds: current.max_tool_rounds,
            stream_budget_seconds: current.stream_budget_seconds,
          });
        }
      } catch {
        // 读不到就保持默认展示：上限卡只是"可调项"，读失败不该让整页报错。
      }
      try {
        const compaction = await getAssistantCompactionSetting();
        if (!cancelled) {
          setModel(compaction.model);
          setMaskPercent(compaction.mask_percent);
          setSummaryPercent(compaction.summary_percent);
          setSavedCompaction(compaction);
        }
      } catch {
        // 同上：压缩设置读失败只影响这一块，保持默认值让用户仍可改。
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 空白模型不是"脏"改动：保存时 trim，比较也用 trim 后的一致口径。
  const trimmedModel = model.trim();
  const limitsDirty =
    rounds !== savedLimits.max_tool_rounds || budget !== savedLimits.stream_budget_seconds;
  const compactionDirty =
    trimmedModel !== savedCompaction.model ||
    maskPercent !== savedCompaction.mask_percent ||
    summaryPercent !== savedCompaction.summary_percent;
  const dirty = limitsDirty || compactionDirty;

  // 与后端同口径的两条前端校验：范围 + 顺序。
  const percentsInRange =
    maskPercent >= PERCENT_MIN &&
    maskPercent <= PERCENT_MAX &&
    summaryPercent >= PERCENT_MIN &&
    summaryPercent <= PERCENT_MAX;
  const percentsOrdered = summaryPercent > maskPercent;
  const thresholdsValid = percentsInRange && percentsOrdered;

  const onSave = async () => {
    if (saving || !dirty || !thresholdsValid) return;
    setSaving(true);
    try {
      // 只有真的改过的那一组才发请求：没改还 PUT 一次会白白重写一遍全局设置。
      if (limitsDirty) {
        const current = await saveAssistantLimitSetting({
          max_tool_rounds: rounds,
          stream_budget_seconds: budget,
        });
        // 以后端回传为准：整对象落库，本地不必猜。
        setRounds(current.max_tool_rounds);
        setBudget(current.stream_budget_seconds);
        setSavedLimits({
          max_tool_rounds: current.max_tool_rounds,
          stream_budget_seconds: current.stream_budget_seconds,
        });
      }
      if (compactionDirty) {
        const current = await saveAssistantCompactionSetting({
          model: trimmedModel,
          mask_percent: maskPercent,
          summary_percent: summaryPercent,
        });
        setModel(current.model);
        setMaskPercent(current.mask_percent);
        setSummaryPercent(current.summary_percent);
        setSavedCompaction(current);
      }
      message.success(t("assistantLimits.settings.saved"));
    } catch (err) {
      // 失败必须说出口：静默丢一次保存等于用户以为改好了，实际没改。
      message.error(err instanceof Error ? err.message : t("assistantLimits.settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  // InputNumber 清空时给 null：不能把 null 写进 number 状态。
  const asNumber = (value: number | null, fallback: number) =>
    typeof value === "number" ? value : fallback;

  return (
    <Card title={t("assistantLimits.settings.title")} className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("assistantLimits.settings.intro")}
      </Typography.Paragraph>
      <LoadingBlock spinning={loading}>
        <Space orientation="vertical" size={12}>
          <label>
            <Typography.Text strong style={{ marginRight: 8 }}>
              {t("assistantLimits.settings.rounds.label")}
            </Typography.Text>
            <InputNumber
              min={ROUNDS_MIN}
              max={ROUNDS_MAX}
              step={1}
              precision={0}
              value={rounds}
              disabled={saving}
              aria-label={t("assistantLimits.settings.rounds.label")}
              onChange={(value) => setRounds(asNumber(value, rounds))}
            />
            <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
              {t("assistantLimits.settings.rounds.unit")}
            </Typography.Text>
            <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
              {t("assistantLimits.settings.rounds.hint")}
            </Typography.Paragraph>
          </label>
          <label>
            <Typography.Text strong style={{ marginRight: 8 }}>
              {t("assistantLimits.settings.budget.label")}
            </Typography.Text>
            <InputNumber
              min={BUDGET_MIN}
              max={BUDGET_MAX}
              step={60}
              precision={0}
              value={budget}
              disabled={saving}
              aria-label={t("assistantLimits.settings.budget.label")}
              onChange={(value) => setBudget(asNumber(value, budget))}
            />
            <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
              {t("assistantLimits.settings.budget.unit")}
            </Typography.Text>
            <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
              {t("assistantLimits.settings.budget.hint")}
            </Typography.Paragraph>
          </label>
          <div>
            <Typography.Title level={5} style={{ margin: "8px 0 0" }}>
              {t("assistantLimits.settings.compaction.title")}
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
              {t("assistantLimits.settings.compaction.intro")}
            </Typography.Paragraph>
          </div>
          <label>
            <Typography.Text strong style={{ marginRight: 8 }}>
              {t("assistantLimits.settings.compaction.model.label")}
            </Typography.Text>
            <Input
              style={{ width: 260 }}
              value={model}
              disabled={saving}
              placeholder={t("assistantLimits.settings.compaction.model.placeholder")}
              aria-label={t("assistantLimits.settings.compaction.model.label")}
              onChange={(event) => setModel(event.target.value)}
            />
            <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
              {t("assistantLimits.settings.compaction.model.hint")}
            </Typography.Paragraph>
          </label>
          <label>
            <Typography.Text strong style={{ marginRight: 8 }}>
              {t("assistantLimits.settings.compaction.mask.label")}
            </Typography.Text>
            <InputNumber
              min={PERCENT_MIN}
              max={PERCENT_MAX}
              step={1}
              precision={0}
              value={maskPercent}
              disabled={saving}
              aria-label={t("assistantLimits.settings.compaction.mask.label")}
              onChange={(value) => setMaskPercent(asNumber(value, maskPercent))}
            />
            <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
              {t("assistantLimits.settings.compaction.mask.unit")}
            </Typography.Text>
            <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
              {t("assistantLimits.settings.compaction.mask.hint")}
            </Typography.Paragraph>
          </label>
          <label>
            <Typography.Text strong style={{ marginRight: 8 }}>
              {t("assistantLimits.settings.compaction.summary.label")}
            </Typography.Text>
            <InputNumber
              min={PERCENT_MIN}
              max={PERCENT_MAX}
              step={1}
              precision={0}
              value={summaryPercent}
              disabled={saving}
              aria-label={t("assistantLimits.settings.compaction.summary.label")}
              onChange={(value) => setSummaryPercent(asNumber(value, summaryPercent))}
            />
            <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
              {t("assistantLimits.settings.compaction.summary.unit")}
            </Typography.Text>
            <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
              {t("assistantLimits.settings.compaction.summary.hint")}
            </Typography.Paragraph>
          </label>
          {!percentsInRange && (
            <Typography.Text type="danger" role="alert">
              {t("assistantLimits.settings.compaction.rangeHint", {
                min: PERCENT_MIN,
                max: PERCENT_MAX,
              })}
            </Typography.Text>
          )}
          {percentsInRange && !percentsOrdered && (
            <Typography.Text type="danger" role="alert">
              {t("assistantLimits.settings.compaction.orderHint", {
                mask: maskPercent,
                summary: summaryPercent,
              })}
            </Typography.Text>
          )}
          <Button
            type="primary"
            loading={saving}
            disabled={!dirty || !thresholdsValid}
            onClick={() => void onSave()}
          >
            {t("assistantLimits.settings.save")}
          </Button>
        </Space>
      </LoadingBlock>
    </Card>
  );
}
