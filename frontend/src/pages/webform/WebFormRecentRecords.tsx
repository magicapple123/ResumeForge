// SPDX-License-Identifier: Apache-2.0
/**
 * 初始态右卡「最近填写」：最近 3 条填充记录 + 「查看全部」。
 *
 * ## 为什么只取 3 条
 *
 * 初始态的作用是"让你知道自己上次干了什么"，不是归档区：3 条固定行高让右卡与左卡
 * （四行开关）齐平，条目多少不会改变版面节奏。完整列表在「查看全部」里（服务端分页）。
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
import { Button, Dropdown, Tag, Typography } from "antd";
import type { MenuProps } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { listWebFormRecordsPage } from "../../api/webform";
import { useApi } from "../../hooks/useApi";
import LoadingBlock from "../../components/common/LoadingBlock";
import ErrorState from "../../components/common/ErrorState";
import type { WebFormUrlHistory } from "../../types";
import { formatServerTime } from "../../utils/serverTime";

/** 主卡只铺最近 3 条；多出来的走「查看全部」。 */
export const RECENT_RECORD_LIMIT = 3;

export function WebFormRecentRecords({
  refreshKey = 0,
  urlHistory,
  onViewAll,
  onUseUrl,
}: {
  /** 外部触发刷新（填充完成后加一）。 */
  refreshKey?: number;
  /** 地址栏的历史网址：空态里的次要入口直接复用它。 */
  urlHistory: WebFormUrlHistory[];
  /** 打开完整记录列表。 */
  onViewAll: () => void;
  /** 从「看看打开过的网址」里挑一条填回地址栏。 */
  onUseUrl: (item: WebFormUrlHistory) => void;
}) {
  useLocale();
  const { data, loading, error, reload } = useApi(
    () => listWebFormRecordsPage(1, RECENT_RECORD_LIMIT),
    [refreshKey],
  );
  const records = data?.items ?? [];
  const total = data?.total ?? 0;

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
        {/* 0 条时禁用而不是隐藏：藏起来会让"没有记录"和"没有这个入口"混成一件事。 */}
        <Button type="text" size="small" disabled={total === 0} onClick={onViewAll}>
          {t("webFormPage.recent.viewAll")}
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
          {records.slice(0, RECENT_RECORD_LIMIT).map((record) => (
            <li key={record.id} className="webform-recent-row">
              <span className="webform-recent-time">{formatServerTime(record.created_at)}</span>
              <Typography.Text className="webform-recent-page" ellipsis>
                {record.page_title || record.url || t("webFormRecords.untitled")}
              </Typography.Text>
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
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
