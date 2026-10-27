// SPDX-License-Identifier: Apache-2.0
/**
 * 采集记录：按时间倒序列出每一次采集的**条件与结果**，展开看那次采到的岗位。
 *
 * 采集是个"跑完就看不见过程"的动作——没有这份记录，第二天就不知道上次按什么关键词、哪个城市
 * 采的，也不知道采到了几条、跳过多少重复。所以每条记录至少要说清三件事：什么时候、什么条件、
 * 结果如何（已暂存 / 重复 / 失败原因）。
 */
import { HistoryOutlined } from "@ant-design/icons";
import { Alert, Button, Collapse, Pagination, Space, Tag, Typography } from "antd";
import EmptyState from "../common/EmptyState";
import { useState } from "react";
import { Link } from "react-router-dom";
import { listApplyTasksPage } from "../../api/apply";
import { useApi } from "../../hooks/useApi";
import { isActiveTaskStatus } from "../../hooks/useTaskPolling";
import PageSkeleton from "../common/PageSkeleton";
import { TASK_STATUS_META, type ApplyTask } from "../../types";
import { formatDateTime } from "../../utils/format";
import CollectResultPanel from "./CollectResultPanel";
import { t } from "../../i18n";
import { TASK_STATUS_LABEL_KEYS } from "../../i18n/enum/apply";
import { useLocale } from "../../i18n/i18nContext";

/** 采集批次持续累积，一页 20 条走服务端分页（/api/apply/tasks/page）。 */
const COLLECT_PAGE_SIZE = 20;

interface Props {
  /** 采集正在跑时禁用展开里的导入动作。 */
  disabled?: boolean;
  /**
   * 重新拉取的键：采集结束后外层改它即可。
   *
   * 用字符串是为了让调用方能直接拼"批次 id + 状态 + 完成时间"——那个组合变化就代表
   * "有一次采集刚结束"，比拼一堆 state 简单，也不会漏掉刷新。
   */
  refreshKey?: string | number;
}

/**
 * 是否是「补齐详情」批次。
 *
 * 这类批次同样是 ``kind=collect``、也会出现在这份记录里，但它的"条件 / 结果"口径与搜索采集
 * 完全不同——没有关键词/城市，结果也不是"已暂存 N 个"。不区分模式的话，用户会看到一条
 * 「已暂存 0 个 / 采集条件：关键词：xxx」的记录，纯误导。
 */
function isBackfillTask(task: ApplyTask): boolean {
  const ids = task.config?.backfill_job_ids;
  return Array.isArray(ids) && ids.length > 0;
}

/** 把批次 config 里的关键词/城市读成一行可读文字；补详情批次没有"采集条件"可显示。 */
function conditionText(task: ApplyTask): string {
  if (isBackfillTask(task)) return "";
  const keywords = Array.isArray(task.config?.keywords)
    ? (task.config.keywords as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  const city = typeof task.config?.city === "string" ? task.config.city : "";
  const parts: string[] = [];
  if (keywords.length > 0) {
    const joined = keywords.join(t("applyUi.collectRecords.keywordSeparator"));
    parts.push(t("applyUi.collectRecords.conditionKeywords", { keywords: joined }));
  }
  if (city.trim()) parts.push(t("applyUi.collectRecords.conditionCity", { city: city.trim() }));
  return parts.length > 0
    ? parts.join(t("applyUi.collectRecords.conditionSeparator"))
    : t("applyUi.collectRecords.conditionEmpty");
}

function resultText(task: ApplyTask): string {
  if (isBackfillTask(task)) {
    // 后端已经把补详情的收尾文案写好并存在 ``message``（补到几条 / 跳过几条 / 为什么），能用就直接
    // 用，绝不再造一套不同措辞。message 为空（异常路径）时退回用计数拼一句。
    const message = (task.message ?? "").trim();
    if (message) return message;
    // 兜底必须读 ``task.succeeded`` / ``task.skipped``——这是**进度条用的同一个数据源**，由
    // ``_update_task_progress`` 逐条同步，所以「正常完成 / 中途停止 / 部分失败」三种情况都对。
    // 反面教材：以前读 ``config.backfilled`` / ``config.backfill_skipped``，而那份账目只在
    // ``run()`` **正常收尾**时才写；用户中途停止走的是另一条路径、根本不写它，于是明明已经补好了
    // N 条（JD 是逐条 commit 的），面板却显示「已补齐 0 条」——给用户看了个不真实的数字。
    // 补详情模式下 collected/skipped 恒为 0，故 succeeded 即 backfilled、skipped 即 backfill_skipped。
    const backfilled = task.succeeded ?? 0;
    const skipped = task.skipped ?? 0;
    const parts = [t("applyUi.collectRecords.resultBackfilled", { count: backfilled })];
    if (skipped) parts.push(t("applyUi.collectRecords.resultSkipped", { count: skipped }));
    if (task.failed) {
      parts.push(t("applyUi.collectRecords.resultBackfillFailed", { count: task.failed }));
    }
    return parts.join(t("applyUi.collectRecords.resultSeparator"));
  }
  const parts = [t("applyUi.collectRecords.resultSaved", { count: task.succeeded ?? 0 })];
  if (task.skipped)
    parts.push(t("applyUi.collectRecords.resultDuplicate", { count: task.skipped }));
  // 筛选掉的条数也要出现在摘要行里：只写"已暂存 N 个"，用户会以为采到的全都在这儿了。
  const filtered = Number(task.config?.filtered_out) || 0;
  if (filtered) parts.push(t("applyUi.collectRecords.resultFiltered", { count: filtered }));
  if (task.failed) parts.push(t("applyUi.collectRecords.resultFailed", { count: task.failed }));
  return parts.join(t("applyUi.collectRecords.resultSeparator"));
}

export default function CollectRecordsPanel({ disabled = false, refreshKey = 0 }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后摘要行停在旧文案。
  useLocale();
  const [page, setPage] = useState(1);
  // 服务端分页：total 来自响应的 total 字段，翻页 / refreshKey 变化都重新拉取。
  const { data, loading, error } = useApi(
    () => listApplyTasksPage("collect", page, COLLECT_PAGE_SIZE),
    [page, refreshKey],
  );

  const records = data?.items ?? [];
  const recordTotal = data?.total ?? 0;

  if (error) return <Alert type="error" showIcon title={error} />;
  if (loading && !data) return <PageSkeleton rows={5} card={false} />;

  if (records.length === 0) {
    return <EmptyState description={t("applyUi.collectRecords.empty")} />;
  }

  return (
    <>
      <Collapse
        className="apply-collect-records"
        items={records.map((record) => {
          const meta = TASK_STATUS_META[record.status];
          // 未登记的状态码（后端新增）回退原码，与旧行为一致。
          const statusKey = TASK_STATUS_LABEL_KEYS[record.status];
          const condition = conditionText(record);
          return {
            key: String(record.id),
            label: (
              <Space size={8} wrap>
                <HistoryOutlined />
                <Typography.Text strong>
                  {formatDateTime(record.finished_at || record.created_at)}
                </Typography.Text>
                <Tag color={meta?.color}>{statusKey ? t(statusKey) : record.status}</Tag>
                {condition && <Typography.Text type="secondary">{condition}</Typography.Text>}
                <Typography.Text>{resultText(record)}</Typography.Text>
              </Space>
            ),
            children: (
              <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                {record.message && <Alert type="info" showIcon title={record.message} />}
                <CollectResultPanel taskId={record.id} disabled={disabled} />
                {/* 批次完成后给下一步入口（RF-Q1）：候选岗位的终点是岗位广场，不给入口
                    用户不知道"采完/导完然后呢"。投递批次的对应入口在 ApplyProgressPanel
                    （「去求职进度跟进」→ /tracker），那是另一条链路的终点。 */}
                {!isActiveTaskStatus(record.status) && (
                  <Space size={4} wrap align="center">
                    <Typography.Text type="secondary">
                      {t("applyUi.collectRecords.nextStep")}
                    </Typography.Text>
                    <Link to="/jobs">
                      <Button type="link" size="small" style={{ padding: 0 }}>
                        {t("applyUi.collectRecords.viewJobs")}
                      </Button>
                    </Link>
                  </Space>
                )}
              </Space>
            ),
          };
        })}
      />
      <div style={{ textAlign: "right", marginTop: 12 }}>
        <Pagination
          current={page}
          pageSize={COLLECT_PAGE_SIZE}
          total={recordTotal}
          onChange={setPage}
          hideOnSinglePage
          showSizeChanger={false}
          showTotal={(count) => t("applyUi.collectRecords.paginationTotal", { count })}
        />
      </div>
    </>
  );
}
