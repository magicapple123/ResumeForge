// SPDX-License-Identifier: Apache-2.0
/**
 * 密钥**依赖矩阵**（#9）：行=功能、列=密钥、格子=依赖。
 *
 * ## 为什么是矩阵，不是节点连线图
 *
 * 8 把 Key × 10 个功能，自由连线在这个密度下必然互相压线；内容区只有 ~790px；每加一把
 * Key 还得重调一次布局。矩阵是同一份数据的**自动排布**：加一行一列就是多一行一列，永不
 * 重叠——这正是"配置变动时矩阵要同步更新"这条需求能被满足的前提。
 *
 * ## 前端零清单（这条比任何样式都重要）
 *
 * 列、行、边**全部来自 `GET /api/connections` 的 `matrix`**（后端 registry 的投影）。
 * 本文件里不许出现任何具体 Key id / 名字：一旦出现，新增来源时前端不跟着改就会少一列，
 * 而用户看到的只是"这里好像少点什么"。单测用 grep 钉住这一条。
 *
 * ## 高亮语义（用户指出的 bug，必须按这个实现）
 *
 * 两种语义**不能混**：
 *
 * | | 表达 | 画法 |
 * | --- | --- | --- |
 * | 实心 / 空心环 | 这个功能**真的依赖**这把 Key | 形状 + 颜色，常驻不变 |
 * | 聚焦 | 你正在看这一行/这一列 | 只把**无关的压暗**，绝不给空位加亮度 |
 *
 * 实现：表格加 `is-focused` 后所有 pip `opacity:.13`（覆盖式 `.22`），只有 `.is-focus`
 * 的 pip 是 `opacity:1`。**不是**给点中的行加亮度——旧实现那样写，看起来像"每个功能都
 * 依赖这两把"。
 *
 * ## 汇总行
 *
 * 三档计数**由 payload 算**（`countByStatus`），可点筛选（只留该状态的列），再点一次或
 * 按 Esc 取消。筛选用**数据驱动重渲染**，不是 CSS 隐藏列——隐藏的列还在 DOM 里，
 * 读屏与 Tab 顺序会跟着错。
 */

import { Typography } from "antd";
import { Fragment, useEffect, useMemo, useState } from "react";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ConnectionKeyMapRow, ConnectionMatrix as ConnectionMatrixPayload } from "../../types";
import ConnectionMatrixDetail from "./ConnectionMatrixDetail";
import {
  MATRIX_FILTERS,
  buildEdgeMap,
  countByStatus,
  edgeId,
  gateOnlyFeatures,
  groupFeatures,
  rowFeatures,
  visibleKeys,
  type MatrixFocus,
  type MatrixStatusFilter,
} from "./connectionMatrixModel";
import "./connection-matrix.css";

export interface ConnectionMatrixProps {
  /** `GET /api/connections` 的 `matrix`；老后端不返回时为 `null`（整块不渲染）。 */
  matrix: ConnectionMatrixPayload | null | undefined;
  /** `key_map`：详情卡那四句整话（按 id 关联，不多发请求）。 */
  details: ConnectionKeyMapRow[];
  /** 「去配置」：交给路由（`/settings?tab=…#anchor`，先切分组再滚动）。 */
  onConfigure: (section: string, anchor: string) => void;
}

/** 功能域的中文名；后端给的是 group id，认不出时回落到 id 本身（不吞信息）。 */
function featureGroupLabel(group: string): string {
  const key = `settingsUi.connections.matrix.group.${group}`;
  const text = t(key as Parameters<typeof t>[0]);
  return text === key ? group : text;
}

/** 三档筛选用到的状态名（复用凭据三态那套译文，不另写一份"已保存/未配置"）。 */
function filterLabel(filter: MatrixStatusFilter): string {
  return t(`connections.status.${filter}` as MessageKey);
}

/** 真正的表格：只在 `matrix` 有数据时挂载（钩子不能有条件地调用）。 */
function ConnectionMatrixBody({
  matrix,
  details,
  onConfigure,
}: {
  matrix: ConnectionMatrixPayload;
  details: ConnectionKeyMapRow[];
  onConfigure: (section: string, anchor: string) => void;
}) {
  useLocale();
  const [focus, setFocus] = useState<MatrixFocus | null>(null);
  const [filter, setFilter] = useState<MatrixStatusFilter | null>(null);

  const edges = useMemo(() => buildEdgeMap(matrix), [matrix]);
  const counts = useMemo(() => countByStatus(matrix.keys), [matrix.keys]);
  const keys = useMemo(() => visibleKeys(matrix.keys, filter), [matrix.keys, filter]);
  const groups = useMemo(
    // 只画有依赖的功能：一条边都没有的功能（只经过闸门）合并成一句话，不画空格子。
    () => groupFeatures(rowFeatures(matrix.features, matrix.edges)),
    [matrix.features, matrix.edges],
  );
  const orphans = useMemo(
    () => gateOnlyFeatures(matrix.features, matrix.edges),
    [matrix.features, matrix.edges],
  );
  const detailsById = useMemo(() => {
    const map = new Map<string, ConnectionKeyMapRow>();
    for (const row of details) map.set(row.id, row);
    return map;
  }, [details]);
  const gateDetail = matrix.gate ? detailsById.get(matrix.gate.key) : undefined;

  // Esc：先取消筛选，没有筛选时清掉聚焦（两件事共用同一个"退出"手势）。
  useEffect(() => {
    if (filter === null && focus === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (filter !== null) {
        setFilter(null);
        return;
      }
      setFocus(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filter, focus]);

  /** 点同一列/行第二次 = 取消聚焦（与汇总档位同一套"再点一次取消"的手感）。 */
  const toggleFocus = (next: MatrixFocus): void => {
    setFocus((prev) =>
      prev !== null && prev.kind === next.kind && prev.id === next.id ? null : next,
    );
  };

  const toggleFilter = (next: MatrixStatusFilter): void => {
    setFilter((prev) => (prev === next ? null : next));
    // 筛选态与详情卡共用选中态：切走即清空（否则详情卡说着被隐藏的列）。
    setFocus(null);
  };

  const columns = keys.length + 1;

  return (
    <section
      className="connection-matrix"
      aria-label={t("settingsUi.connections.matrix.title")}
      data-testid="connection-matrix"
    >
      <div className="connection-matrix__head">
        <Typography.Text strong>{t("settingsUi.connections.matrix.title")}</Typography.Text>
        {/* 三档计数由 payload 算；点一下只留该状态的列，再点一次取消。 */}
        <div className="connection-matrix__summary" role="group">
          {MATRIX_FILTERS.map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={filter === status}
              aria-label={t("settingsUi.connections.matrix.filterAria", {
                label: filterLabel(status),
                count: counts[status],
              })}
              className={`connection-matrix__summary-btn${filter === status ? " is-active" : ""}`}
              data-status={status}
              onClick={() => toggleFilter(status)}
            >
              {t("settingsUi.connections.matrix.count", {
                label: filterLabel(status),
                count: counts[status],
              })}
            </button>
          ))}
          {filter !== null ? (
            <button
              type="button"
              className="connection-matrix__summary-clear"
              onClick={() => setFilter(null)}
            >
              {t("settingsUi.connections.matrix.clearFilter")}
            </button>
          ) : null}
        </div>
      </div>

      <p className="connection-matrix__hint">{t("settingsUi.connections.matrix.hint")}</p>

      <div className="connection-matrix__scroll">
        <table className={`connection-matrix__table${focus !== null ? " is-focused" : ""}`}>
          <thead>
            <tr>
              <th scope="col" className="connection-matrix__corner">
                {t("settingsUi.connections.matrix.corner")}
              </th>
              {keys.map((key) => {
                const active = focus?.kind === "key" && focus.id === key.id;
                return (
                  <th
                    key={key.id}
                    scope="col"
                    className={`connection-matrix__col${active ? " is-focus" : ""}`}
                    data-group={key.group}
                    data-status={key.status}
                  >
                    <button
                      type="button"
                      className="connection-matrix__col-btn"
                      aria-pressed={active}
                      onClick={() => toggleFocus({ kind: "key", id: key.id })}
                      title={key.label}
                    >
                      <span className="connection-matrix__col-dot" aria-hidden="true" />
                      {key.label}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {groups.map(({ group, items }) => (
              <Fragment key={group}>
                {/* 功能域分组标题：10.5px + 浅底，只为分段，不承担状态语义。 */}
                <tr className="connection-matrix__group-row">
                  <th scope="colgroup" colSpan={columns}>
                    {featureGroupLabel(group)}
                  </th>
                </tr>
                {items.map((feature) => {
                  const rowActive = focus?.kind === "feature" && focus.id === feature.id;
                  return (
                    <tr
                      key={feature.id}
                      className={`connection-matrix__row${rowActive ? " is-focus" : ""}`}
                      data-feature={feature.id}
                    >
                      <th scope="row" className="connection-matrix__row-head">
                        <button
                          type="button"
                          className="connection-matrix__row-btn"
                          aria-pressed={rowActive}
                          onClick={() => toggleFocus({ kind: "feature", id: feature.id })}
                        >
                          {feature.label}
                        </button>
                      </th>
                      {keys.map((key) => {
                        const kind = edges.get(edgeId(key.id, feature.id));
                        // 空位**不带任何类**：聚焦只压暗有格子的地方，绝不给空位加亮度。
                        if (kind === undefined) {
                          return <td key={key.id} className="connection-matrix__cell" />;
                        }
                        const cellFocus =
                          focus !== null &&
                          ((focus.kind === "key" && focus.id === key.id) ||
                            (focus.kind === "feature" && focus.id === feature.id));
                        return (
                          <td key={key.id} className="connection-matrix__cell">
                            <span
                              className={`connection-matrix__pip is-on${
                                kind === "override" ? " is-override" : ""
                              }${cellFocus ? " is-focus" : ""}`}
                              data-group={key.group}
                              role="img"
                              aria-label={t(
                                kind === "override"
                                  ? "settingsUi.connections.matrix.cell.override"
                                  : "settingsUi.connections.matrix.cell.direct",
                                { key: key.label, feature: feature.label },
                              )}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* 闸门带：代理口令不占列（它不属于某个功能，所有出网请求都过它）。 */}
      {matrix.gate ? (
        <div className="connection-matrix__gate" data-testid="connection-matrix-gate">
          <span className="connection-matrix__gate-name">{matrix.gate.label}</span>
          <span className="connection-matrix__gate-hint">
            {t("settingsUi.connections.matrix.gate.hint")}
          </span>
          {gateDetail ? (
            <button
              type="button"
              className="connection-matrix__gate-action"
              // 与详情卡的「去配置」可见文案相同、落点不同：无障碍名必须区分开，
              // 否则同一 region 里两个同名按钮，读屏用户无法判断点哪个。
              aria-label={t("settingsUi.connections.matrix.gate.actionAria", {
                name: matrix.gate.label,
              })}
              onClick={() => onConfigure(gateDetail.section, gateDetail.anchor)}
            >
              {t("settingsUi.connections.matrix.detail.goConfigure")}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* 只经过闸门、不依赖任何 Key 的功能：合成一句说明，不画一排空格子。 */}
      {orphans.length > 0 ? (
        <p className="connection-matrix__gate-note">
          {t("settingsUi.connections.matrix.gate.only", {
            list: orphans.map((feature) => feature.label).join("、"), // i18n-ok: 顿号是列表分隔符，不是界面文案
          })}
        </p>
      ) : null}

      <div className="connection-matrix__legend">
        <span className="connection-matrix__legend-item">
          <span className="connection-matrix__pip is-on" aria-hidden="true" />
          {t("settingsUi.connections.matrix.legend.direct")}
        </span>
        <span className="connection-matrix__legend-item">
          <span className="connection-matrix__pip is-on is-override" aria-hidden="true" />
          {t("settingsUi.connections.matrix.legend.override")}
        </span>
        <span className="connection-matrix__legend-item">
          {t("settingsUi.connections.matrix.legend.focus")}
        </span>
      </div>

      <div className="connection-matrix__detail">
        <div className="connection-matrix__detail-title">
          {t("settingsUi.connections.matrix.detail.title")}
        </div>
        <ConnectionMatrixDetail
          matrix={matrix}
          focus={focus}
          detailsById={detailsById}
          onConfigure={onConfigure}
        />
      </div>
    </section>
  );
}

export default function ConnectionMatrix({ matrix, details, onConfigure }: ConnectionMatrixProps) {
  // 拿不到矩阵（老后端 / 加载中）时整块不渲染：空表头比"没有这条信息"更容易误导。
  if (!matrix || matrix.keys.length === 0) return null;
  return <ConnectionMatrixBody matrix={matrix} details={details} onConfigure={onConfigure} />;
}
