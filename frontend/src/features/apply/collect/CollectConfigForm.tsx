// SPDX-License-Identifier: Apache-2.0
/**
 * 采集条件的表单区块：关键词/城市/单批上限/站点筛选/间隔与抖动/保存站点原文。
 *
 * 受控组件：form 实例由 CollectPanel 持有（保存/开始都要 validateFields），这里只负责
 * 渲染 Form.Item；`Form.Item` 经 Form context 注册到同一个 form，零独立状态。
 *
 * 2026-10-09 起不再有「采集后筛选」（期望薪资/经验/学历/岗位类型）——条件过滤全权
 * 交给下面的站点侧筛选（用户决定：采回来再筛的层用不上，连同依赖它的「校招」档一起
 * 下线）。schema 里的字段保留以兼容旧配置，前端不再发送。
 *
 * 2026-11-13 排版（用户反馈「自动采集界面排版不好看」）：
 * - 三张卡各有「标题 + 一句话说明」，一眼能分出搜索范围 / 筛选条件 / 节奏与样本；
 * - 搜索条件宽屏一行四字段（关键词弹性、单批上限 150 / 城市 190 / 历史条件 300），
 *   容器 < 1020 退两行——宽度跟内容走，不再被等分栅格拉满；
 * - 节奏两个输入并排并带单位（秒），勾选框移到同一行右侧；
 * - 底部操作条带一句摘要（预计条数 / 间隔 / 时长），不再把按钮悬在一片空白里。
 */
import { PlayCircleOutlined, SaveOutlined } from "@ant-design/icons";
import { Button, Checkbox, Form, Input, InputNumber, Select, Typography } from "antd";
import type { FormInstance } from "antd";
import type { ReactNode } from "react";
import type { CollectConfig } from "../../../types";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import CollectSiteFilters from "../CollectSiteFilters";
import "../applyCollectForm.css";

interface Props {
  history?: ReactNode;
  form: FormInstance<CollectConfig>;
  /** 读取当前表单里选中的站点筛选项（「测试是否生效」按钮用），原样转传给站点筛选区块。 */
  getFilters: () => Record<string, string[]>;
  saveSamples: boolean;
  onSaveSamplesChange: (checked: boolean) => void;
  disabled: boolean;
  saving: boolean;
  starting: boolean;
  onSave: () => void;
  onStart: () => void;
}

export default function CollectConfigForm({
  history,
  form,
  getFilters,
  saveSamples,
  onSaveSamplesChange,
  disabled,
  saving,
  starting,
  onSave,
  onStart,
}: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  // 底部摘要只读三个数：条数、间隔、抖动。`Form.useWatch` 让它们随输入即时变化，
  // 不用另立一套受控 state（表单仍是唯一数据源）。
  const limit = Form.useWatch("per_task_limit", form);
  const interval = Form.useWatch("interval_seconds", form);
  const jitter = Form.useWatch("interval_jitter_seconds", form);
  const summaryCount = typeof limit === "number" ? limit : 0;
  // 每条的期望耗时 = 间隔 + 抖动的一半（抖动是 0..jitter 的均匀分布）。
  const secondsPerItem =
    (typeof interval === "number" ? interval : 0) + (typeof jitter === "number" ? jitter : 0) / 2;
  const summaryMinutes = Math.max(1, Math.round((summaryCount * secondsPerItem) / 60));

  return (
    <Form form={form} layout="vertical" className="apply-collect-config">
      <section className="apply-collect-group">
        <div className="apply-collect-group-head">
          <div className="apply-collect-group-title">
            <Typography.Text strong>{t("applyCollect.group.search")}</Typography.Text>
            <Typography.Text type="secondary" className="apply-collect-group-hint">
              {t("applyCollect.group.searchHint")}
            </Typography.Text>
          </div>
        </div>
        {/* F10：宽屏一行四字段、窄屏两行。原来是一个 3 等分栅格 + `span 2`：单批上限只填
            1–3 位数字却占 400px，关键词与历史条件各跨两列被拉到 600–700px。现在宽度跟内容走
            ——关键词是唯一可伸缩的字段，其余三个定宽。
            两行包装是为了窄屏；宽屏 `display: contents` 把它们摊平成一行（见 CSS）。 */}
        <div className="apply-collect-search-grid">
          <div className="apply-collect-search-row">
            <Form.Item
              name="keywords"
              label={t("applyCollect.field.keywords")}
              extra={t("applyCollect.hint.keywords")}
              className="apply-collect-keywords"
            >
              <Select mode="tags" placeholder={t("applyCollect.placeholder.keywords")} open={false} />
            </Form.Item>
            <Form.Item
              className="apply-collect-limit"
              name="per_task_limit"
              label={t("applyCollect.field.perTaskLimit")}
            >
              <InputNumber
                min={1}
                max={200}
                addonAfter={t("applyCollect.unit.perBatch")}
                style={{ width: "100%" }}
              />
            </Form.Item>
          </div>
          <div className="apply-collect-search-row">
            <Form.Item className="apply-collect-city" name="city" label={t("applyCollect.field.city")}>
              <Input placeholder={t("applyCollect.placeholder.city")} />
            </Form.Item>
            {/* 历史条件从标题行挪进栅格：它是一份"可回填的输入"，和关键词、城市同级；
                原先挂在标题右侧，既显得像页面级动作，也让标题行高矮不齐。 */}
            <div className="apply-collect-field apply-collect-history-cell">
              <span className="apply-collect-field-label">{t("applyCollect.field.history")}</span>
              {history}
            </div>
          </div>
        </div>
      </section>

      {/* 站点侧筛选：招聘网站自己的筛选栏。它现在承担**全部**条件过滤——网站在搜索
          时就把不符合的岗位筛掉了，比采回来再筛更准也更省。 */}
      <CollectSiteFilters disabled={disabled} getFilters={getFilters} />

      <section className="apply-collect-group">
        <div className="apply-collect-group-head">
          <div className="apply-collect-group-title">
            <Typography.Text strong>{t("applyCollect.group.rhythm")}</Typography.Text>
            <Typography.Text type="secondary" className="apply-collect-group-hint">
              {t("applyCollect.group.rhythmHint")}
            </Typography.Text>
          </div>
        </div>
        <div className="apply-collect-rhythm-grid">
          <Form.Item name="interval_seconds" label={t("applyCollect.field.intervalSeconds")}>
            <InputNumber
              min={1}
              max={600}
              addonAfter={t("applyCollect.unit.seconds")}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item name="interval_jitter_seconds" label={t("applyCollect.field.jitterSeconds")}>
            <InputNumber
              min={1}
              max={300}
              addonAfter={t("applyCollect.unit.seconds")}
              style={{ width: "100%" }}
            />
          </Form.Item>
          {/* 保存站点原文：排查解析问题 / 做真实样例回归的通道，属于支持路径而非日常流程，
              所以放在节奏这一行末尾、默认不勾，并把"存什么、存哪、会不会外传"写在下面一行。 */}
          <div className="apply-collect-field apply-collect-samples-cell">
            <Checkbox
              checked={saveSamples}
              onChange={(event) => onSaveSamplesChange(event.target.checked)}
              aria-label={t("applyCollect.field.saveSamples")}
            >
              {t("applyCollect.field.saveSamples")}
            </Checkbox>
          </div>
        </div>
        <Typography.Text type="secondary" className="apply-collect-samples-hint">
          {t("applyCollect.hint.saveSamples")}
        </Typography.Text>
      </section>

      <div className="apply-collect-actions">
        <Typography.Text type="secondary" className="apply-collect-summary">
          {summaryCount > 0
            ? t("applyCollect.footer.summary", {
                count: summaryCount,
                interval: typeof interval === "number" ? interval : 0,
                jitter: typeof jitter === "number" ? jitter : 0,
                minutes: summaryMinutes,
              })
            : null}
        </Typography.Text>
        <Button icon={<SaveOutlined />} loading={saving} onClick={onSave}>
          {t("applyCollect.action.save")}
        </Button>
        <Button
          type="primary"
          icon={<PlayCircleOutlined />}
          loading={starting}
          disabled={disabled || undefined}
          onClick={onStart}
        >
          {t("applyCollect.action.start")}
        </Button>
      </div>
    </Form>
  );
}
