// SPDX-License-Identifier: Apache-2.0
/**
 * 面试深挖：针对台账里每一条主张做压力测试，结束时给一份"该去补什么"的清单。
 *
 * 与「模拟面试」的分工写在页面上：那边按轮数推进、给四维度评分；这边**不评总分**，
 * 用证据状态回答"这条主张我到底讲不讲得清"。所以界面上也不该出现任何分数。
 *
 * 两个刻意的呈现选择：
 * - **反馈策略默认「真实模拟」**：每题后不念判定，因为念了会让人按判分标准答题，
 *   而不像真面试。判定仍如实回传（界面不撒谎），只是不主动展示。
 * - **评分契约在整个会话期间可见**：它是"判定标准"，用户有权看到自己在被怎么衡量——
 *   藏起来才会让人怀疑"是不是看人下菜碟"。
 */
import {
  App,
  Button,
  Card,
  Checkbox,
  Listy,
  Pagination,
  Space,
  Statistic,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import EmptyState from "../components/common/EmptyState";
import PageSkeleton from "../components/common/PageSkeleton";
import BatchActionBar from "../components/common/BatchActionBar";
import { RowActions, RowContextMenu, type RowMenuItem } from "../components/common/RowActions";
import { HARD_DELETE_NOTE } from "../components/common/rowActionMenu";
import { useBatchSelection } from "../hooks/useBatchSelection";
import { ListyItem } from "../components/common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../components/common/listyPadding";
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  PlusOutlined,
  CheckSquareOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useClientPagination } from "../hooks/useClientPagination";
import { deleteDrillSession, getDrillSession, listDrillSessions } from "../api/drill";
import type { DrillSession, DrillSessionBrief, FeedbackPolicy } from "../types";
import { ActiveSession } from "./drill/ActiveSession";
import { ReviewPanel } from "./drill/ReviewPanel";
import { StartPanel } from "./drill/StartPanel";
import { t, type MessageKey } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

/**
 * 反馈策略是协议值，展示名在语言包里。这里沿用 `drill.startPanel.feedback.*` 那组 key
 * （与开场面板的选项逐字一致）；`types/drill.ts` 的 `FEEDBACK_LABELS` 属类型层，按约定不改。
 */
const FEEDBACK_LABEL_KEYS: Record<FeedbackPolicy, MessageKey> = {
  deferred: "drill.startPanel.feedback.deferred",
  immediate: "drill.startPanel.feedback.immediate",
};

export default function DrillPage() {
  useLocale();
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const [current, setCurrent] = useState<DrillSession | null>(null);
  const [history, setHistory] = useState<DrillSessionBrief[]>([]);
  // 深挖历史持续累积，一页 10 条（Listy 无内建分页，走通用客户端分页）。
  const {
    page,
    setPage,
    paged: pagedHistory,
    total: historyTotal,
  } = useClientPagination(history, 10);
  const batch = useBatchSelection<number>();
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);

  // 用 ref 读"当前是否已打开某一场"：把它写进 refreshHistory 的依赖会让回调
  // 每次都重建，而 refreshHistory 又是 useEffect 的依赖 → 无限重取。
  // ref 写入放 effect（Compiler 禁止渲染期写 ref）。
  const currentRef = useRef<DrillSession | null>(null);
  useEffect(() => {
    currentRef.current = current;
  });

  // 纯取数（不含 setState）：effect 内联调用时 Compiler 才能验证非同步更新；
  // 返回 null 表示失败（错误提示在这里统一给出）。
  const fetchHistory = useCallback(async () => {
    try {
      return await listDrillSessions();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("drill.error.loadRecords"));
      return null;
    }
  }, [message]);

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const records = await fetchHistory();
      if (cancelled) return;
      if (records !== null) {
        setHistory(records);
        // 自动打开最近一场**进行中**的：用户回到这一页最可能是想接着答，
        // 让他再点一次「继续」是多余的一步。没有进行中的就不自动打开，
        // 免得把一份旧复盘糊在屏幕上。
        const active = records.find((item) => item.status === "active");
        if (active && !currentRef.current) {
          setCurrent(await getDrillSession(active.id));
          setOpenId(active.id);
        }
      }
      setLoadingHistory(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchHistory]);

  // 事件路径（提交复盘后的整表重拉，含 loading 翻动）。
  const refreshHistory = useCallback(async () => {
    setLoadingHistory(true);
    const records = await fetchHistory();
    if (records !== null) setHistory(records);
    setLoadingHistory(false);
  }, [fetchHistory]);

  const openHistory = async (id: number) => {
    try {
      setOpenId(id);
      setCurrent(await getDrillSession(id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("drill.error.load"));
    }
  };

  const remove = async (id: number) => {
    try {
      await deleteDrillSession(id);
      message.success(t("drill.toast.deletedOne"));
      if (current?.id === id) setCurrent(null);
      await refreshHistory();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("drill.error.deleteFailed"));
    }
  };

  /** 批量删除：确认后逐条走同一个删除接口，全部完成再刷新一次。 */
  const removeSelected = () => {
    const ids = [...batch.selectedIds];
    if (ids.length === 0) return;
    modal.confirm({
      title: t("drill.confirm.deleteTitle"),
      // 标题只说动作 + 对象；条数与后果进正文（§4.4 的例外：数量让标题超 12 字）。
      // i18n-ok: 正文后缀是共用常量 HARD_DELETE_NOTE（含中文），待常量收口后整句一起迁移
      content: `这 ${ids.length} 场深挖${HARD_DELETE_NOTE}`,
      okText: t("common.action.delete"),
      okButtonProps: { danger: true },
      onOk: async () => {
        const results = await Promise.allSettled(
          history
            .filter((item) => batch.isSelected(item.id))
            .map((item) => deleteDrillSession(item.id)),
        );
        const failed = results.filter((item) => item.status === "rejected").length;
        if (failed === 0) message.success(t("drill.toast.deletedMany", { count: ids.length }));
        else message.warning(t("drill.toast.deletedPartial", { ok: ids.length - failed, failed }));
        batch.exitSelecting();
        await refreshHistory();
      },
    });
  };

  const stats = useMemo(() => {
    if (!current) return null;
    return current.summary;
  }, [current]);

  const finished = current?.status === "finished";

  /**
   * 历史条目的右键菜单：批量选择（工具栏按钮已收进这里，R8）+ 分隔线 + 删除。
   *
   * 分隔线不是装饰：「批量选择」与「删除」挨着排、只有一个词宽时很容易点错，而删除是
   * 危险项（§4.9：普通项与危险项之间用分隔线分组）。
   */
  const contextActions = (item: DrillSessionBrief): RowMenuItem[] => [
    {
      key: "batch_select",
      label: t("drill.selectMode"),
      icon: <CheckSquareOutlined />,
      onClick: batch.enterSelecting,
    },
    { key: "delete_divider", type: "divider" },
    {
      key: "delete",
      label: t("drill.action.delete"),
      danger: true,
      confirm: t("drill.confirm.deleteOne"),
      confirmBody: HARD_DELETE_NOTE,
      onClick: () => void remove(item.id),
    },
  ];

  return (
    <div className="drill-page">
      <div className="drill-page-head">
        <Space orientation="vertical" size={0}>
          {/* 深挖是从台账「开始深挖」进来的子页面，但它是独立路由——浏览器后退之外
              界面上没有别的出口，用户会以为"进去就出不来了"。 */}
          <Button
            type="link"
            size="small"
            className="drill-back"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate("/claims")}
          >
            {t("drill.action.back")}
          </Button>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t("drill.page.title")}
          </Typography.Title>
          <Typography.Text type="secondary">{t("drill.page.subtitle")}</Typography.Text>
        </Space>
        <StartPanel
          onStarted={(session) => {
            setCurrent(session);
            setOpenId(session.id);
            void refreshHistory();
          }}
        />
      </div>

      {current && stats && (
        <div className="drill-summary">
          <Statistic title={t("drill.stat.asked")} value={stats.questions} />
          <Statistic
            title={t("drill.stat.clear")}
            value={stats.verified_count}
            styles={{ content: { color: "var(--rf-success-text)" } }}
            prefix={<CheckCircleOutlined />}
          />
          <Statistic
            title={t("drill.stat.partial")}
            value={stats.partial_count}
            styles={{ content: { color: "var(--rf-warning-text)" } }}
          />
          <Statistic title={t("drill.stat.unverified")} value={stats.unverified_count} />
          {stats.contradictory_count > 0 && (
            <Statistic
              title={t("drill.stat.contradiction")}
              value={stats.contradictory_count}
              styles={{ content: { color: "var(--rf-error-text)" } }}
              prefix={<ExclamationCircleOutlined />}
            />
          )}
        </div>
      )}

      {current && (
        <Card
          size="small"
          title={current.title}
          extra={
            <Space>
              <Tag color={finished ? "default" : "processing"}>
                {finished ? t("drill.status.finished") : t("drill.status.active")}
              </Tag>
              <Tooltip title={t(FEEDBACK_LABEL_KEYS[current.feedback_policy])}>
                <Tag>
                  {current.feedback_policy === "deferred"
                    ? t("drill.mode.simulated")
                    : t("drill.mode.training")}
                </Tag>
              </Tooltip>
            </Space>
          }
        >
          {finished ? (
            <ReviewPanel session={current} />
          ) : (
            <ActiveSession session={current} onUpdate={setCurrent} />
          )}
        </Card>
      )}

      <Card
        size="small"
        title={t("drill.section.history")}
        extra={
          <Button size="small" onClick={() => void refreshHistory()} loading={loadingHistory}>
            {t("drill.action.refresh")}
          </Button>
        }
      >
        {batch.selecting && (
          <BatchActionBar
            count={batch.selectedCount}
            onExit={batch.exitSelecting}
            pageSelectAll={{
              allSelected:
                pagedHistory.length > 0 && pagedHistory.every((item) => batch.isSelected(item.id)),
              someSelected: pagedHistory.some((item) => batch.isSelected(item.id)),
              onToggle: (checked) =>
                batch.selectPage(
                  pagedHistory.map((item) => item.id),
                  checked,
                ),
            }}
          >
            <Button danger disabled={batch.selectedCount === 0} onClick={removeSelected}>
              {t("drill.batch.delete")}
            </Button>
          </BatchActionBar>
        )}
        {loadingHistory ? (
          <PageSkeleton rows={3} />
        ) : history.length === 0 ? (
          <EmptyState description={t("drill.empty")} />
        ) : (
          <>
            <Listy
              items={pagedHistory}
              rowKey={(item) => item.id}
              styles={{ item: { ...LISTY_ITEM_PADDING_SMALL } }}
              itemRender={(item) => (
                <RowContextMenu items={batch.selecting ? [] : contextActions(item)}>
                  <ListyItem
                    actions={
                      batch.selecting
                        ? [
                            <Checkbox
                              key="pick"
                              aria-label={t("drill.aria.select", { title: item.title })}
                              checked={batch.isSelected(item.id)}
                              onChange={() => batch.toggle(item.id)}
                            />,
                          ]
                        : [
                            <Button
                              key="open"
                              size="small"
                              type="link"
                              onClick={() => void openHistory(item.id)}
                            >
                              {item.status === "active"
                                ? t("drill.action.continue")
                                : t("drill.action.review")}
                            </Button>,
                            // 删除收进「···」菜单：除回收站外，删除不再以红图标裸露（全局约定）。
                            <RowActions
                              key="more"
                              more={[
                                {
                                  key: "delete",
                                  label: t("drill.action.delete"),
                                  danger: true,
                                  confirm: t("drill.confirm.deleteOne"),
                                  confirmBody: HARD_DELETE_NOTE,
                                  onClick: () => void remove(item.id),
                                },
                              ]}
                            />,
                          ]
                    }
                  >
                    <Space size={8} wrap>
                      <Typography.Text strong={openId === item.id}>{item.title}</Typography.Text>
                      <Tag color={item.status === "active" ? "processing" : "default"}>
                        {item.status === "active"
                          ? t("drill.status.active")
                          : t("drill.status.finished")}
                      </Tag>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {t("drill.progress", {
                          current: item.current_index,
                          total: item.max_questions,
                        })}
                        {" · "}
                        {item.created_at.replace("T", " ").slice(0, 16)}
                      </Typography.Text>
                    </Space>
                  </ListyItem>
                </RowContextMenu>
              )}
            />
            <div style={{ textAlign: "right", marginTop: 12 }}>
              <Pagination
                current={page}
                pageSize={10}
                total={historyTotal}
                onChange={setPage}
                hideOnSinglePage
                showSizeChanger={false}
                showTotal={(count) => t("drill.table.total", { count })}
              />
            </div>
          </>
        )}
      </Card>

      {!current && history.length > 0 && (
        <Typography.Text type="secondary">
          {t("pagesMisc.drillPage.openHint.before")}
          <PlusOutlined /> {t("pagesMisc.drillPage.openHint.after")}
        </Typography.Text>
      )}
    </div>
  );
}
