// SPDX-License-Identifier: Apache-2.0
/**
 * 密钥依赖矩阵的**详情卡**（#9）：固定在矩阵下方的那一块。
 *
 * 为什么在下方而不是右侧：内容区只有 ~790px，右侧再切一栏会把矩阵压到每列 40px 以下。
 *
 * 两种聚焦各给一份详情：
 * - 点**一列**（一把密钥）：在哪配 / 谁在用 / 留空会怎样 / 落点 + 「去配置」；
 * - 点**一行**（一个功能）：它依赖哪几把密钥（按列顺序）。
 *
 * 落点那一行（`?tab=…#anchor`）**只作文本展示**：原来旁边还有一个「复制落点」按钮，
 * 复制出来的串没有路径（`?tab=…#…`），粘进地址栏会被当成搜索词（R17）。按钮已删，
 * 文本保留——它仍然是"这一行的深链长什么样"的唯一说明。
 *
 * 数据全部来自 payload：`matrix.keys` 给列，`key_map` 给那四句整话（`used_by` 已经
 * 被后端拼回 `used_by_text`）。这里**不按 id 判断任何语义**。
 */

import { Button } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ConnectionKeyMapRow, ConnectionMatrix } from "../../types";
import { keysOfFeature, type MatrixFocus } from "./connectionMatrixModel";

export interface ConnectionMatrixDetailProps {
  matrix: ConnectionMatrix;
  focus: MatrixFocus | null;
  /** `key_map` 按 id 索引：那四句整话只在 key_map 里（矩阵只带状态与落点）。 */
  detailsById: Map<string, ConnectionKeyMapRow>;
  /** 「去配置」：由 `ConnectionsCard` 交给路由（先切分组再滚动）。 */
  onConfigure: (section: string, anchor: string) => void;
}

/** 一行「字段名 + 值」：详情卡的四个字段共用。 */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="connection-matrix__field">
      <span className="connection-matrix__field-label">{label}</span>
      <span className="connection-matrix__field-value">{value || "—"}</span>
    </div>
  );
}

export function ConnectionMatrixDetail({
  matrix,
  focus,
  detailsById,
  onConfigure,
}: ConnectionMatrixDetailProps) {
  useLocale();

  if (focus === null) {
    return (
      <p className="connection-matrix__detail-empty">
        {t("settingsUi.connections.matrix.detail.placeholder")}
      </p>
    );
  }

  if (focus.kind === "feature") {
    const feature = matrix.features.find((item) => item.id === focus.id);
    const usedKeys = keysOfFeature(matrix, focus.id);
    return (
      <div className="connection-matrix__detail-body" data-focus="feature">
        <div className="connection-matrix__detail-head">{feature?.label ?? focus.id}</div>
        <p className="connection-matrix__detail-line">
          {usedKeys.length === 0
            ? t("settingsUi.connections.matrix.detail.featureNone", { name: feature?.label ?? "" })
            : t("settingsUi.connections.matrix.detail.feature", {
                name: feature?.label ?? "",
                count: usedKeys.length,
                list: usedKeys.map((key) => key.label).join("、"), // i18n-ok: 顿号是列表分隔符，不是界面文案
              })}
        </p>
      </div>
    );
  }

  const key = matrix.keys.find((item) => item.id === focus.id);
  if (!key) {
    return (
      <p className="connection-matrix__detail-empty">
        {t("settingsUi.connections.matrix.detail.placeholder")}
      </p>
    );
  }
  const detail = detailsById.get(key.id);

  return (
    <div className="connection-matrix__detail-body" data-focus="key">
      <div className="connection-matrix__detail-head">{key.label}</div>
      <div className="connection-matrix__detail-fields">
        {/* 四句整话来自 key_map（与凭据页同一份数据）：矩阵只负责"哪一格"，不负责解释。 */}
        <DetailRow
          label={t("settingsUi.connections.matrix.detail.configureAt")}
          value={detail?.configure_at ?? ""}
        />
        <DetailRow
          label={t("settingsUi.connections.matrix.detail.usedBy")}
          value={detail?.used_by_text ?? ""}
        />
        <DetailRow
          label={t("settingsUi.connections.matrix.detail.emptyMeaning")}
          value={detail?.empty_meaning ?? ""}
        />
        <DetailRow
          label={t("settingsUi.connections.matrix.detail.anchor")}
          value={`?tab=${key.section}#${key.anchor}`}
        />
      </div>
      <div className="connection-matrix__detail-actions">
        <Button size="small" type="primary" onClick={() => onConfigure(key.section, key.anchor)}>
          {t("settingsUi.connections.matrix.detail.goConfigure")}
        </Button>
      </div>
    </div>
  );
}

export default ConnectionMatrixDetail;
