// SPDX-License-Identifier: Apache-2.0
/**
 * #15D「优化指派」抽屉：一次给多条队列条目算「关键词覆盖」并建议换哪份简历。
 *
 * 表格口径（列顺序就是用户决策顺序）：岗位 / 当前简历 / 覆盖率 / 推荐简历 / 换后 / 提升。
 * 「换用」与「全部换用」都调用**现有的**改简历接口（`PATCH /apply/queue/{id}`），
 * 不新增批量端点——批量只是一次 `allSettled` 循环，一条失败不拖垮整批，账目如实回报。
 *
 * 命名一律「关键词覆盖」：不写「匹配度 / 参考分」。后者是另一套口径（准入结论派生的
 * 参考分），两个数混叫会让用户以为可以互相比大小。
 *
 * `gain <= 0` 的行照样列出（用户需要看到"这条已经是最优"），但推荐列写「覆盖已经最高」、
 * 「换用」不可点——不给一个点了只会变差的按钮。
 */
import { Alert, App, Button, Drawer, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useMemo, useState } from "react";
import EmptyState from "../../common/EmptyState";
import LoadingBlock from "../../common/LoadingBlock";
import { updateQueueItem } from "../../../api/apply";
import { getResumeFit } from "../../../api/applyInsights";
import { useApi } from "../../../hooks/useApi";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ApplyQueueItem, ApplyResumeFitItem, ApplyResumeFitList } from "../../../types";
import { fetchResumeTitles, resumeTitleOf } from "./resumeTitles";

interface Props {
  open: boolean;
  /** 勾选的队列条目（只对这些条目算建议）。 */
  items: ApplyQueueItem[];
  onClose: () => void;
  /** 换用成功后通知面板刷新队列（简历名变了）。 */
  onApplied: () => void;
}

/** 这一行是否值得换：有推荐、有提升、且还没换过。 */
function isSwappable(row: ApplyResumeFitItem, applied: readonly number[]): boolean {
  return row.gain > 0 && row.recommended_resume_id !== null && !applied.includes(row.queue_id);
}

export default function ApplyResumeFitDrawer({ open, items, onClose, onApplied }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化。
  useLocale();
  const { message } = App.useApp();
  const [applied, setApplied] = useState<number[]>([]);
  const [swapping, setSwapping] = useState<number | null>(null);
  const [swappingAll, setSwappingAll] = useState(false);
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const idKey = ids.join(",");
  const { data, loading, error } = useApi<ApplyResumeFitList>(() => getResumeFit(ids), [idKey], {
    enabled: open && ids.length > 0,
  });
  const { data: titles } = useApi<Record<number, string>>(() => fetchResumeTitles(), [], {
    enabled: open,
  });

  const queueById = useMemo(() => {
    const map = new Map<number, ApplyQueueItem>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const rows = useMemo(() => data?.items ?? [], [data]);
  const swappableRows = useMemo(
    () => rows.filter((row) => isSwappable(row, applied)),
    [rows, applied],
  );

  /**
   * 应用一条：走现有改简历接口（只改 `resume_id`，招呼语等字段不带）。
   * 成功后就地标记，避免同一行被连点两次。
   */
  const applyOne = async (row: ApplyResumeFitItem) => {
    const resumeId = row.recommended_resume_id;
    if (resumeId === null) return;
    setSwapping(row.queue_id);
    try {
      await updateQueueItem(row.queue_id, { resume_id: resumeId });
      setApplied((previous) =>
        previous.includes(row.queue_id) ? previous : [...previous, row.queue_id],
      );
      message.success(t("applyQueue.insights.fit.applied", { count: 1 }));
      onApplied();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("applyQueue.insights.fit.applyFailed"));
    } finally {
      setSwapping(null);
    }
  };

  /** 全部换用：逐条 PATCH + allSettled 聚合账目（一条失败不拖垮整批）。 */
  const applyAll = async () => {
    const targets = rows.filter((row) => isSwappable(row, applied));
    if (targets.length === 0) return;
    setSwappingAll(true);
    try {
      const results = await Promise.allSettled(
        targets.map((row) =>
          updateQueueItem(row.queue_id, { resume_id: row.recommended_resume_id as number }),
        ),
      );
      const okIds = targets
        .filter((_, index) => results[index].status === "fulfilled")
        .map((row) => row.queue_id);
      if (okIds.length > 0) {
        setApplied((previous) => [...new Set([...previous, ...okIds])]);
        onApplied();
      }
      const failed = targets.length - okIds.length;
      if (failed > 0) {
        message.warning(t("applyQueue.insights.fit.applyPartial", { ok: okIds.length, failed }));
      } else {
        message.success(t("applyQueue.insights.fit.applied", { count: okIds.length }));
      }
    } finally {
      setSwappingAll(false);
    }
  };

  const coverageText = (value: number | null): string =>
    value === null ? "—" : t("applyQueue.insights.fit.coverage", { percent: Math.round(value) });

  const columns: TableColumnsType<ApplyResumeFitItem> = [
    {
      title: t("applyQueue.insights.fit.column.job"),
      key: "job",
      width: 180,
      render: (_, row) => {
        const item = queueById.get(row.queue_id);
        return (
          <Typography.Text ellipsis style={{ maxWidth: 160 }}>
            {item?.job_title || t("applyQueue.detail.deletedJob")}
          </Typography.Text>
        );
      },
    },
    {
      title: t("applyQueue.insights.fit.column.current"),
      key: "current",
      width: 150,
      render: (_, row) => {
        const item = queueById.get(row.queue_id);
        return item?.resume_title || t("applyQueue.detail.defaultResume");
      },
    },
    {
      title: t("applyQueue.insights.fit.column.coverage"),
      key: "coverage",
      width: 90,
      align: "center",
      render: (_, row) => coverageText(row.current_coverage),
    },
    {
      title: t("applyQueue.insights.fit.column.recommended"),
      key: "recommended",
      width: 190,
      render: (_, row) => {
        if (row.gain <= 0 || row.recommended_resume_id === null) {
          return (
            <Typography.Text type="secondary">
              {t("applyQueue.insights.fit.noGain")}
            </Typography.Text>
          );
        }
        const title = resumeTitleOf(titles ?? {}, row.recommended_resume_id);
        return row.reason ? (
          <Tooltip title={row.reason}>
            <Typography.Text ellipsis style={{ maxWidth: 170 }}>
              {title}
            </Typography.Text>
          </Tooltip>
        ) : (
          title
        );
      },
    },
    {
      title: t("applyQueue.insights.fit.column.after"),
      key: "after",
      width: 90,
      align: "center",
      render: (_, row) =>
        row.gain > 0 ? coverageText(row.recommended_coverage) : coverageText(null),
    },
    {
      title: t("applyQueue.insights.fit.column.gain"),
      key: "gain",
      width: 80,
      align: "center",
      render: (_, row) =>
        row.gain > 0 ? (
          <Tag color="green">
            {t("applyQueue.insights.fit.gain", { gain: Math.round(row.gain) })}
          </Tag>
        ) : (
          "—"
        ),
    },
    {
      title: t("applyQueue.insights.fit.column.action"),
      key: "action",
      width: 110,
      align: "right",
      render: (_, row) => {
        if (applied.includes(row.queue_id)) {
          return <Tag color="blue">{t("applyQueue.insights.fit.swapped")}</Tag>;
        }
        return (
          <Button
            size="small"
            // aria-label 与文字同源：antd 会给"两个汉字"的按钮插一个空格（换 用），
            // 显式给无障碍名才能保证读屏与测试拿到的都是原样的「换用」。
            aria-label={t("applyQueue.insights.fit.swap")}
            disabled={!isSwappable(row, applied)}
            loading={swapping === row.queue_id}
            onClick={() => void applyOne(row)}
          >
            {t("applyQueue.insights.fit.swap")}
          </Button>
        );
      },
    },
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="right"
      size={760}
      destroyOnHidden
      title={t("applyQueue.insights.fit.title")}
      footer={null}
    >
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <Alert type="error" showIcon title={t("applyQueue.insights.fit.error")} />
      ) : rows.length === 0 ? (
        <EmptyState inline description={t("applyQueue.insights.fit.empty")} />
      ) : (
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Space>
            <Button
              type="primary"
              loading={swappingAll}
              disabled={swappableRows.length === 0}
              onClick={() => void applyAll()}
            >
              {t("applyQueue.insights.fit.swapAll")}
            </Button>
          </Space>
          <Table<ApplyResumeFitItem>
            rowKey="queue_id"
            size="small"
            columns={columns}
            dataSource={rows}
            pagination={false}
            tableLayout="fixed"
          />
        </Space>
      )}
    </Drawer>
  );
}
