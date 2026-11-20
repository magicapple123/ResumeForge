// SPDX-License-Identifier: Apache-2.0
/**
 * 初始态右卡「最近填写」：最近 10 条填充记录，「查看全部」**就地展开**。
 *
 * ## 为什么改成 10 条 + 就地展开（T03）
 *
 * 上一版只铺 3 条、完整列表开抽屉：抽屉一起就是半屏，而且和这一卡是两套滚动。
 * 现在默认 10 条，点「查看全部」当场向下展开到 100 条（接口上限），按钮同时变「收起」；
 * 超过 100 条时列表末尾补一行「仅显示最近 100 条」。删除仍在行尾 `⋯`（沿用回收站语义）。
 *
 * ## 空态为什么自带「会发生什么」
 *
 * 第一次进来时这张卡必然是空的——只写"暂无数据"等于什么都没说。空态要说清三件事：
 * 现在没有记录、填一次之后这里会出现什么、以及除了填表还能去哪儿（打开过的网址，
 * 直接复用地址栏那份 `urlHistory`，不另取一份数据）。
 *
 * 纯展示 + 一个 `useApi`：渲染所用的记录都是摘要（不含真实填写值），完整明细在
 * 「查看全部」的 `WebFormRecordsPanel` 里按需取。
 */
import { App, Button, Dropdown, Tag, Typography } from "antd";
import type { MenuProps } from "antd";
import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { deleteWebFormRecord, getWebFormRecord, listWebFormRecordsPage } from "../../api/webform";
import { useApi } from "../../hooks/useApi";
import LoadingBlock from "../../components/common/LoadingBlock";
import ErrorState from "../../components/common/ErrorState";
import { RowActions } from "../../components/common/RowActions";
import type { WebFormFillRecord, WebFormUrlHistory } from "../../types";
import { formatServerTime } from "../../utils/serverTime";
import WebFormRecordDetail from "../../features/webform/WebFormRecordDetail";

/** 主卡铺最近 10 条；「查看全部」就地展开到接口上限。 */
export const RECENT_RECORD_LIMIT = 10;
/** 接口 `page_size` 的上限：一次取满，展开后不再翻页。 */
export const RECENT_RECORD_MAX = 100;

export function WebFormRecentRecords({
  refreshKey = 0,
  urlHistory,
  onUseUrl,
}: {
  /** 外部触发刷新（填充完成后加一）。 */
  refreshKey?: number;
  /** 地址栏的历史网址：空态里的次要入口直接复用它。 */
  urlHistory: WebFormUrlHistory[];
  /** 从「看看打开过的网址」里挑一条填回地址栏。 */
  onUseUrl: (item: WebFormUrlHistory) => void;
}) {
  useLocale();
  const { message } = App.useApp();
  const [expanded, setExpanded] = useState(false);
  /** 展开后才取 100 条；收起时回到 10 条的请求（同一份 `useApi`，靠 key 变化重取）。 */
  const { data, loading, error, reload } = useApi(
    () => listWebFormRecordsPage(1, expanded ? RECENT_RECORD_MAX : RECENT_RECORD_LIMIT),
    [refreshKey, expanded],
  );
  const records = data?.items ?? [];
  const total = data?.total ?? 0;
  /** 防御：服务端已按 limit 截断，这里再切一次（旧后端/桩返回更多时版面不被撑爆）。 */
  const visible = expanded ? records : records.slice(0, RECENT_RECORD_LIMIT);
  /** 展开态下打开的那一条明细（就地渲染，不开抽屉、不开弹窗）。 */
  const [opened, setOpened] = useState<number | null>(null);
  const [detail, setDetail] = useState<WebFormFillRecord | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const detailLoading = opened !== null && !detailFailed && detail?.id !== opened;

  useEffect(() => {
    if (opened === null) return;
    let cancelled = false;
    getWebFormRecord(opened)
      .then((full) => {
        if (!cancelled) setDetail(full);
      })
      .catch(() => {
        if (!cancelled) {
          setDetail(null);
          setDetailFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [opened]);

  const remove = async (recordId: number) => {
    await deleteWebFormRecord(recordId);
    if (opened === recordId) setOpened(null);
    message.success(t("webFormRecords.toast.deleted", { count: 1 }));
    await reload();
  };

  const historyItems: MenuProps["items"] = urlHistory.map((item) => ({
    key: String(item.id),
    label: (
      <Typography.Text ellipsis style={{ maxWidth: 300 }} title={item.url}>
        {item.title || item.url}
      </Typography.Text>
    ),
    onClick: () => onUseUrl(item),
  }));

  return (
    <section
      className="webform-recent"
      aria-label={t("webFormPage.recent.title")}
      data-testid="webform-recent"
    >
      <div className="webform-recent-head">
        <h3 className="webform-panel-title">{t("webFormPage.recent.title")}</h3>
        {/* 0 条时禁用而不是隐藏：藏起来会让"没有记录"和"没有这个入口"混成一件事。
            T03：不再开抽屉，当场向下展开到接口上限（100 条）。 */}
        <Button
          type="text"
          size="small"
          disabled={total === 0}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? t("webFormPage.recent.collapse") : t("webFormPage.recent.viewAll")}
        </Button>
      </div>

      {loading && !data ? (
        <LoadingBlock minHeight={96} />
      ) : error ? (
        <ErrorState description={t("webFormPage.recent.error")} onRetry={() => void reload()} />
      ) : total === 0 ? (
        <div className="webform-recent-empty">
          <p className="webform-recent-empty-title">{t("webFormRecords.empty.none")}</p>
          <p className="webform-recent-empty-what">{t("webFormPage.recent.emptyWhat")}</p>
          <p className="webform-recent-empty-body">{t("webFormPage.recent.emptyBody")}</p>
          <Dropdown
            trigger={["click"]}
            disabled={urlHistory.length === 0}
            menu={{ items: historyItems }}
          >
            <Button type="link" size="small" disabled={urlHistory.length === 0}>
              {t("webFormPage.recent.urls")}
            </Button>
          </Dropdown>
        </div>
      ) : (
        <ul className="webform-recent-rows">
          {visible.map((record) => {
            const open = opened === record.id;
            return (
              <li
                key={record.id}
                className={`webform-recent-row${open ? " is-open" : ""}`}
                data-testid="webform-recent-row"
              >
                <div className="webform-recent-line">
                  <span className="webform-recent-time">{formatServerTime(record.created_at)}</span>
                  <button
                    type="button"
                    className="webform-recent-page"
                    aria-expanded={open}
                    onClick={() => setOpened(open ? null : record.id)}
                  >
                    {record.page_title || record.url || t("webFormRecords.untitled")}
                  </button>
                  <span className="webform-recent-tags">
                    <Tag color="success">
                      {t("webFormRecords.tag.filled", { count: record.filled })}
                    </Tag>
                    {record.unverified > 0 ? (
                      <Tag color="warning">
                        {t("webFormRecords.tag.unverified", { count: record.unverified })}
                      </Tag>
                    ) : null}
                    {record.failed > 0 ? (
                      <Tag color="error">
                        {t("webFormRecords.tag.failed", { count: record.failed })}
                      </Tag>
                    ) : null}
                  </span>
                  {/* onboarding 态下这是**唯一**的删除入口（填写台的「填充记录」只在非
                      onboarding 分支挂载），所以它必须在两种态下都渲染。 */}
                  <RowActions
                    more={[
                      {
                        key: "delete",
                        label: t("common.action.delete"),
                        danger: true,
                        confirm: t("webFormRecords.confirm.deleteOne"),
                        onClick: () => void remove(record.id),
                      },
                    ]}
                  />
                </div>
                {open ? (
                  <div className="webform-recent-detail">
                    <WebFormRecordDetail
                      pageTitle={record.page_title}
                      url={record.url}
                      detail={detail?.id === record.id ? detail : null}
                      loading={detailLoading}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
          {expanded && total > RECENT_RECORD_MAX ? (
            <li className="webform-recent-more">
              {t("webFormPage.recent.truncated", { count: RECENT_RECORD_MAX })}
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
