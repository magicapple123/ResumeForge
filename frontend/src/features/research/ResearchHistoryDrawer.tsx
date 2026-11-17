// SPDX-License-Identifier: Apache-2.0
/**
 * 调研历史抽屉（T07）。
 *
 * 知识库对同一家公司是**原地覆盖**（只留最新一份），所以"上次调研说了什么"只能在这里看。
 * 列表 → 详情用**视图切换**而不是再开一层抽屉（同一时刻只允许一个弹层容器）。
 *
 * 三条产品口径：
 * - 详情超过 30 天给「可能已过时」提示：公司与岗位信息会变，旧结论不能当现状用；
 * - 「清空全部」是内联二次确认（不可恢复），文案必须写明**不影响知识库最新一条**；
 * - 「重新调研」只**回填**输入、不自动提交——一按就开始搜等于替用户付搜索费。
 */
import { Alert, App, Button, Drawer, List, Popconfirm, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import {
  clearResearchHistory,
  deleteResearchHistory,
  getResearchHistory,
  listResearchHistory,
  type ResearchHistoryDetail,
  type ResearchHistoryItem,
} from "../../api/research";
import EmptyState from "../../components/common/EmptyState";
import ErrorState from "../../components/common/ErrorState";
import LoadingBlock from "../../components/common/LoadingBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { formatBytes, formatDateTime } from "../../utils/format";
import ResearchBriefPanel from "./ResearchBrief";
import ResearchCardList from "./ResearchCardList";

/** 超过这个天数就提醒"可能已过时"（岗位与公司信息变化很快）。 */
const STALE_DAYS = 30;
/** 一页 10 条：抽屉高度有限，20 条要滚很久才看得完"共 N 条"。 */
const PAGE_SIZE = 10;

const STATUS_COLOR: Record<string, string> = {
  ok: "green",
  failed: "red",
  skipped: "default",
};

/** 状态 → 文案 key。表里存 key、渲染处再 `t()`：模块加载时求值 `t()` 不会跟着切语言。 */
const STATUS_LABEL_KEY = {
  ok: "companyResearch.history.status.ok",
  failed: "companyResearch.history.status.failed",
  skipped: "companyResearch.history.status.skipped",
} as const satisfies Record<"ok" | "failed" | "skipped", string>;

function ageInDays(iso: string | null): number | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return Math.floor((Date.now() - at.getTime()) / 86_400_000);
}

function StatusTag({ status }: { status: ResearchHistoryItem["status"] }) {
  const key = STATUS_LABEL_KEY[status as keyof typeof STATUS_LABEL_KEY];
  if (!key) return null;
  return (
    <Tag color={STATUS_COLOR[status]} className="rf-research-history-tag">
      {t(key)}
    </Tag>
  );
}

export default function ResearchHistoryDrawer({
  open,
  company,
  jobId,
  onClose,
  onRerun,
}: {
  open: boolean;
  /** 只看这家公司的历史；为空表示"所有公司"。 */
  company?: string;
  /** 从岗位详情进来时只看这个岗位的。 */
  jobId?: number;
  onClose: () => void;
  /** 「重新调研」：把这次的输入回填到页面（**不**自动提交）。 */
  onRerun?: (run: ResearchHistoryDetail) => void;
}) {
  useLocale();
  const { message } = App.useApp();
  const [items, setItems] = useState<ResearchHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<ResearchHistoryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);

  // 打开或筛选条件变化时重新从第一页读：抽屉是"临时视图"，不该带着上次的游标。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect -- 换公司/重新打开必须清掉上一份列表：
       留着旧行会让"共 N 条"与列表对不上，而这不是能从渲染里推导出来的状态。 */
    setLoading(true);
    setError("");
    setItems([]);
    setCursor(null);
    setDetail(null);
    setConfirmingClear(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    listResearchHistory({ company, job_id: jobId, limit: PAGE_SIZE })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.total);
        setBytes(page.bytes);
        setCursor(page.next_cursor);
      })
      .catch(() => {
        if (!cancelled) setError(t("companyResearch.history.error"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, company, jobId]);

  const loadMore = async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await listResearchHistory({
        company,
        job_id: jobId,
        cursor,
        limit: PAGE_SIZE,
      });
      setItems((prev) => [...prev, ...page.items]);
      setTotal(page.total);
      setBytes(page.bytes);
      setCursor(page.next_cursor);
    } catch {
      setError(t("companyResearch.history.error"));
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (item: ResearchHistoryItem) => {
    setDetailLoading(true);
    setError("");
    try {
      setDetail(await getResearchHistory(item.id));
    } catch {
      setError(t("companyResearch.history.detailError"));
    } finally {
      setDetailLoading(false);
    }
  };

  const removeOne = async () => {
    if (!detail) return;
    try {
      await deleteResearchHistory(detail.id);
      setItems((prev) => prev.filter((item) => item.id !== detail.id));
      setTotal((prev) => Math.max(0, prev - 1));
      setDetail(null);
      message.success(t("companyResearch.history.deleted"));
    } catch {
      message.error(t("companyResearch.history.error"));
    }
  };

  const clearAll = async () => {
    try {
      await clearResearchHistory(company ? { company } : { all: true });
      message.success(t("companyResearch.history.cleared", { count: total }));
      setItems([]);
      setTotal(0);
      setBytes(0);
      setCursor(null);
      setConfirmingClear(false);
      setDetail(null);
    } catch {
      message.error(t("companyResearch.history.error"));
    }
  };

  const staleDays = detail ? ageInDays(detail.created_at) : null;
  // 详情读失败时也要能退回列表：否则用户停在一条错误信息上，只能关掉整个抽屉。
  const backVisible = detail !== null || (error !== "" && items.length > 0);

  const backToList = () => {
    setDetail(null);
    setError("");
  };

  return (
    <Drawer
      title={t("companyResearch.history.title")}
      size="min(720px, 100vw)"
      open={open}
      onClose={onClose}
      extra={
        backVisible ? (
          <Button onClick={backToList}>{t("companyResearch.history.back")}</Button>
        ) : undefined
      }
    >
      {error && !detail ? (
        <ErrorState description={error} />
      ) : detail ? (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <div className="rf-research-history-meta">
            <Typography.Text strong>
              {detail.company_raw || detail.company}
              {detail.role ? ` · ${detail.role}` : ""}
            </Typography.Text>
            {detail.created_at ? (
              <Typography.Text type="secondary">
                {formatDateTime(detail.created_at)}
              </Typography.Text>
            ) : null}
          </div>
          {staleDays !== null && staleDays >= STALE_DAYS ? (
            <Alert
              type="warning"
              showIcon
              title={t("companyResearch.history.staleDays", { days: staleDays })}
            />
          ) : null}
          <Space>
            {onRerun ? (
              <Button
                type="primary"
                onClick={() => {
                  onRerun(detail);
                  onClose();
                }}
              >
                {t("companyResearch.history.rerun")}
              </Button>
            ) : null}
            <Popconfirm
              title={t("companyResearch.history.deleteBody")}
              okText={t("companyResearch.history.delete")}
              cancelText={t("common.action.cancel")}
              okButtonProps={{ danger: true }}
              onConfirm={() => void removeOne()}
            >
              <Button danger>{t("companyResearch.history.delete")}</Button>
            </Popconfirm>
          </Space>
          <ResearchBriefPanel brief={detail.brief} />
          <ResearchCardList cards={detail.cards} />
        </Space>
      ) : loading && items.length === 0 ? (
        <LoadingBlock />
      ) : items.length === 0 ? (
        <EmptyState
          inline
          description={
            company ? t("companyResearch.history.empty") : t("companyResearch.history.emptyAll")
          }
        />
      ) : (
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <List
            dataSource={items}
            renderItem={(item) => {
              return (
                <List.Item className="rf-research-history-item">
                  <Button
                    type="text"
                    block
                    className="rf-research-history-row"
                    onClick={() => void openDetail(item)}
                  >
                    <span className="rf-research-history-when">
                      {formatDateTime(item.created_at ?? undefined)}
                    </span>
                    <span className="rf-research-history-who">
                      {item.company_raw || item.company}
                      {item.role ? ` · ${item.role}` : ""}
                    </span>
                    <span className="rf-research-history-tags">
                      {item.deep ? (
                        <Tag className="rf-research-history-tag">
                          {t("companyResearch.history.deepTag")}
                        </Tag>
                      ) : null}
                      <StatusTag status={item.status} />
                      <Typography.Text type="secondary">
                        {t("companyResearch.usage.summary", {
                          count: item.search_count,
                          seconds: Math.max(1, Math.round(item.elapsed_ms / 1000)),
                        })}
                      </Typography.Text>
                    </span>
                  </Button>
                </List.Item>
              );
            }}
          />
          {cursor ? (
            <Button block loading={loading} onClick={() => void loadMore()}>
              {t("companyResearch.history.loadMore")}
            </Button>
          ) : null}
          <div className="rf-research-history-footer">
            <Typography.Text type="secondary">
              {t("companyResearch.history.summary", {
                count: total,
                size: formatBytes(bytes),
              })}
            </Typography.Text>
            {confirmingClear ? (
              <Space direction="vertical" size="small" className="rf-research-history-confirm">
                <Typography.Text>{t("companyResearch.history.clearBody")}</Typography.Text>
                <Space>
                  <Button danger onClick={() => void clearAll()}>
                    {t("companyResearch.history.clearAction", { count: total })}
                  </Button>
                  <Button onClick={() => setConfirmingClear(false)}>
                    {t("companyResearch.history.clearCancel")}
                  </Button>
                </Space>
              </Space>
            ) : (
              <Button danger onClick={() => setConfirmingClear(true)}>
                {t("companyResearch.history.clear")}
              </Button>
            )}
          </div>
        </Space>
      )}
      {detailLoading ? <LoadingBlock minHeight={80} /> : null}
    </Drawer>
  );
}
