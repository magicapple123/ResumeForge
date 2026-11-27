// SPDX-License-Identifier: Apache-2.0
/**
 * #15D「优化指派」抽屉：一次给多条队列条目算「关键词覆盖」并建议换哪份简历。
 *
 * ## 为什么是「现在 / 建议」两栏（整改 #17）
 *
 * 用户的决策只有一步：**要不要把 A 换成 B**。原来的七列
 * （`岗位 180 + 当前简历 150 + 覆盖率 90 + 推荐简历 190 + 换后 90 + 提升 80 + 操作 110 = 890`）
 * 比抽屉内容区（760 抽屉约 712）宽 178px，最右的「操作」列被裁掉半个按钮；而
 * 「覆盖率 / 换后 / 提升」三列其实是同一次比较的三个碎片，等于让用户自己做减法。
 *
 * 现在四列合计 `198 + 196 + 92 = 486`，剩下一列自适应（≈226），正好放进 712：
 * 每一侧各占一栏，主行是简历名，副行是覆盖率，并排就能直接比。
 *
 * ## 「+N」的口径（本次修的语义错误）
 *
 * 后端 `baseline = current_coverage or 0`（`services/apply/resume_fit.py`），当前**未指定**
 * 简历时 `gain = 推荐覆盖率 − 0`，于是界面显示「+67」，读起来像"提升了 67 个百分点"，
 * 实际是"从无到 67"。这里只改**展示口径**（不改后端 `gain` 定义）：
 * - `current_coverage === null` → chip「新指派」（绝不出现 `+` 开头的 chip）；
 * - 有基线且 `gain > 0` → chip「+N」；
 * - 否则整行「已是最优」+ chip「无需更换」，操作列给灰色「—」——
 *   **不渲染 disabled 按钮**（点了只会变差的按钮不该存在）。
 *
 * ## 不动的部分
 *
 * 「换用」与「全部换用」都调用**现有的**改简历接口（`PATCH /apply/queue/{id}`），
 * 不新增批量端点——批量只是一次 `allSettled` 循环，一条失败不拖垮整批，账目如实回报。
 * 命名一律「关键词覆盖」：不写「匹配度 / 参考分」（那是准入结论派生的另一套口径）。
 */
import { Alert, App, Button, Drawer, Table, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useMemo, useState, type CSSProperties } from "react";
import EmptyState from "../../../components/common/EmptyState";
import LoadingBlock from "../../../components/common/LoadingBlock";
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

/**
 * 列宽（整改 #17 拍板值）。
 *
 * 三个定宽列 + 一个自适应列 = 抽屉内容区（≈712）。**不要**把「建议」列也定宽：
 * 简历标题长度不可控，定宽就会把最右的操作列顶出去（这正是整改前的问题）。
 */
const COLUMN_WIDTH = { job: 198, current: 196, action: 92 } as const;

/** 副行（覆盖率 / 提示语）的统一样式：比正文小一号、灰色，不抢主行的注意力。 */
const SUB_STYLE: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--rf-text-tertiary, #8a94a6)",
};

/** 单元格内的单行省略：`tableLayout="fixed"` 下由这一层裁掉，全文交给 `Tooltip`。 */
const ELLIPSIS: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/** 主行容器：`minWidth: 0` 让 flex 子项真的能被压缩（否则省略不生效）。 */
const MAIN_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  minWidth: 0,
};

/** 一行建议的结论：要么可换（`swap`），要么已经是最优（`best`）。 */
interface FitPlan {
  /** 注意别叫 `action`：`action` 是产品文案的契约属性名（`COPY_PROPERTIES`），
   *  `action: "swap"` 会被 i18n 守卫当成"未登记的界面文案"。 */
  mode: "swap" | "best";
  /** 当前没有基线（`current_coverage === null`）→ chip 写「新指派」而不是「+N」。 */
  isNew: boolean;
  /** 可换时的目标简历 id；`best` 时为 null。 */
  resumeId: number | null;
}

/**
 * 把后端给的一条数据收敛成"要不要换"。
 *
 * 三种情况的优先级就是用户的理解顺序：**先看有没有推荐**（没有就无可换），
 * 再看有没有基线（没有基线是"新指派"，不是"提升"），最后才看提升是否为正。
 */
function planOf(row: ApplyResumeFitItem): FitPlan {
  if (row.recommended_resume_id === null) {
    return { mode: "best", isNew: false, resumeId: null };
  }
  if (row.current_coverage === null) {
    return { mode: "swap", isNew: true, resumeId: row.recommended_resume_id };
  }
  if (row.gain > 0) {
    return { mode: "swap", isNew: false, resumeId: row.recommended_resume_id };
  }
  return { mode: "best", isNew: false, resumeId: null };
}

/**
 * 简历标题的展示口径。
 *
 * 三档必须分清（整改 #17 第 7 条）：
 * - 标题非空 → 原样；
 * - 标题存在但为空串（`titles` 里有这个 id）→「未命名简历 #id」；
 * - 这个 id 根本不在对照表里（请求失败 / 超出分页）→ 既有的「简历 #id」兜底。
 */
function fitResumeTitle(titles: Record<number, string>, resumeId: number): string {
  const title = titles[resumeId]?.trim();
  if (title) return title;
  const known = Object.prototype.hasOwnProperty.call(titles, resumeId);
  return known
    ? t("applyQueue.insights.fit.untitledResume", { id: resumeId })
    : resumeTitleOf(titles, resumeId);
}

/** 覆盖率的副行文案：算不出来时写 `覆盖率 —`，不写 `0%`（那会被读成"完全没覆盖"）。 */
function coverageLine(value: number | null): string {
  return value === null
    ? t("applyQueue.insights.fit.coverageNone")
    : t("applyQueue.insights.fit.coverageLine", { percent: Math.round(value) });
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
  const titleMap = titles ?? {};

  /** 还没换、且换成推荐版本确实更好看的那些行。 */
  const swappableRows = useMemo(
    () => rows.filter((row) => planOf(row).mode === "swap" && !applied.includes(row.queue_id)),
    [rows, applied],
  );
  /** 已经是最优的行数（footer 摘要用）。 */
  const bestCount = useMemo(() => rows.filter((row) => planOf(row).mode === "best").length, [rows]);

  /**
   * 应用一条：走现有改简历接口（只改 `resume_id`，招呼语等字段不带）。
   * 成功后就地标记，避免同一行被连点两次。
   */
  const applyOne = async (row: ApplyResumeFitItem, resumeId: number) => {
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
    const targets = swappableRows;
    if (targets.length === 0) return;
    setSwappingAll(true);
    try {
      const results = await Promise.allSettled(
        targets.map((row) => {
          const { resumeId } = planOf(row);
          return updateQueueItem(row.queue_id, { resume_id: resumeId as number });
        }),
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

  /** 「现在」列主行：队列条目自己的 `resume_title`，未指定时明确写「未指定…」。 */
  const currentTitleOf = (row: ApplyResumeFitItem): string => {
    const item = queueById.get(row.queue_id);
    const fromQueue = item?.resume_title?.trim() ?? "";
    if (fromQueue) return fromQueue;
    if (row.current_resume_id === null) {
      return t("applyQueue.insights.fit.now.unspecified");
    }
    return fitResumeTitle(titleMap, row.current_resume_id);
  };

  const columns: TableColumnsType<ApplyResumeFitItem> = [
    {
      title: t("applyQueue.insights.fit.column.job"),
      key: "job",
      width: COLUMN_WIDTH.job,
      render: (_, row) => {
        const item = queueById.get(row.queue_id);
        const jobTitle = item?.job_title?.trim() || t("applyQueue.detail.deletedJob");
        const company = item?.company?.trim() ?? "";
        // 省略必须配 Tooltip：列的定宽是为了"放得下"，不是为了"看不清全名"。
        return (
          <Tooltip title={company ? `${company} · ${jobTitle}` : jobTitle}>
            <div style={ELLIPSIS}>{jobTitle}</div>
          </Tooltip>
        );
      },
    },
    {
      title: t("applyQueue.insights.fit.column.current"),
      key: "current",
      width: COLUMN_WIDTH.current,
      render: (_, row) => {
        const title = currentTitleOf(row);
        return (
          <div style={{ minWidth: 0 }}>
            <Tooltip title={title}>
              <div style={ELLIPSIS}>{title}</div>
            </Tooltip>
            <div style={SUB_STYLE}>{coverageLine(row.current_coverage)}</div>
          </div>
        );
      },
    },
    {
      title: t("applyQueue.insights.fit.column.recommended"),
      key: "recommended",
      render: (_, row) => {
        const plan = planOf(row);
        if (plan.mode === "best") {
          return (
            <div style={{ minWidth: 0 }}>
              <div style={MAIN_ROW}>
                <span style={{ ...ELLIPSIS, color: "var(--rf-text-tertiary, #8a94a6)" }}>
                  {t("applyQueue.insights.fit.bestRow")}
                </span>
                <Tag style={{ marginInlineEnd: 0 }}>
                  {t("applyQueue.insights.fit.chip.noChange")}
                </Tag>
              </div>
              <div style={SUB_STYLE}>{t("applyQueue.insights.fit.bestSub")}</div>
            </div>
          );
        }
        const title = fitResumeTitle(titleMap, plan.resumeId as number);
        const chip = plan.isNew ? (
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>
            {t("applyQueue.insights.fit.chip.new")}
          </Tag>
        ) : (
          <Tag color="green" style={{ marginInlineEnd: 0 }}>
            {t("applyQueue.insights.fit.gain", { gain: Math.round(row.gain) })}
          </Tag>
        );
        return (
          <div style={{ minWidth: 0 }}>
            <div style={MAIN_ROW}>
              <Tooltip title={title}>
                <span style={ELLIPSIS}>{title}</span>
              </Tooltip>
              {row.reason ? <Tooltip title={row.reason}>{chip}</Tooltip> : chip}
            </div>
            <div style={SUB_STYLE}>{coverageLine(row.recommended_coverage)}</div>
          </div>
        );
      },
    },
    {
      title: t("applyQueue.insights.fit.column.action"),
      key: "action",
      width: COLUMN_WIDTH.action,
      align: "right",
      render: (_, row) => {
        const plan = planOf(row);
        if (applied.includes(row.queue_id)) {
          return (
            <Tag color="blue" style={{ marginInlineEnd: 0 }}>
              {t("applyQueue.insights.fit.swapped")}
            </Tag>
          );
        }
        // 已是最优：给一个灰色的「—」，**不渲染 disabled 按钮**。
        if (plan.mode === "best") {
          return <span style={SUB_STYLE}>—</span>;
        }
        return (
          <Button
            size="small"
            // aria-label 与文字同源：antd 会给"两个汉字"的按钮插一个空格（换 用），
            // 显式给无障碍名才能保证读屏与测试拿到的都是原样的「换用」。
            aria-label={t("applyQueue.insights.fit.swap")}
            loading={swapping === row.queue_id}
            onClick={() => void applyOne(row, plan.resumeId as number)}
          >
            {t("applyQueue.insights.fit.swap")}
          </Button>
        );
      },
    },
  ];

  const hasRows = rows.length > 0;
  const summary = t("applyQueue.insights.fit.summary", {
    total: rows.length,
    swappable: swappableRows.length,
    best: bestCount,
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="right"
      size={760}
      destroyOnHidden
      title={t("applyQueue.insights.fit.title")}
      footer={
        hasRows ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {summary}
            </Typography.Text>
            <span style={{ flex: "1 1 auto" }} />
            <Button
              // aria-label 与文字同源：antd 会给"两个汉字"的按钮插一个空格（取 消）。
              aria-label={t("applyQueue.insights.fit.cancel")}
              onClick={onClose}
            >
              {t("applyQueue.insights.fit.cancel")}
            </Button>
            <Button
              type="primary"
              loading={swappingAll}
              disabled={swappableRows.length === 0}
              // aria-label 带上条数：读屏用户也能听到"这一次会改几条"。
              aria-label={t("applyQueue.insights.fit.swapAllCount", {
                count: swappableRows.length,
              })}
              onClick={() => void applyAll()}
            >
              {t("applyQueue.insights.fit.swapAllCount", { count: swappableRows.length })}
            </Button>
          </div>
        ) : null
      }
    >
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <Alert type="error" showIcon title={t("applyQueue.insights.fit.error")} />
      ) : !hasRows ? (
        <EmptyState inline description={t("applyQueue.insights.fit.empty")} />
      ) : (
        <>
          {/* 用途说明：整改前这里一个字都没有，用户看不出这页在干什么。 */}
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
            {t("applyQueue.insights.fit.intro")}{" "}
            <Tooltip title={t("applyQueue.insights.fit.coverageHelp")}>
              <Typography.Text
                style={{
                  fontSize: 12,
                  color: "var(--rf-brand, #1d63d1)",
                  cursor: "help",
                  borderBottom: "1px dashed currentColor",
                }}
              >
                {t("applyQueue.insights.fit.coverageHelpLabel")}
              </Typography.Text>
            </Tooltip>
          </Typography.Paragraph>
          <Table<ApplyResumeFitItem>
            rowKey="queue_id"
            size="small"
            columns={columns}
            dataSource={rows}
            pagination={false}
            tableLayout="fixed"
          />
        </>
      )}
    </Drawer>
  );
}
