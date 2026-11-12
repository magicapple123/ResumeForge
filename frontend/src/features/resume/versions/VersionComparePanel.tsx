// SPDX-License-Identifier: Apache-2.0
/**
 * 版本比较视图（W13 / #28b）：字段级「旧值 → 新值」，不再渲染整份文档的 JSON 行 diff。
 *
 * 变更集来自后端 `document_versions_diff`：按 header → section → entry → item 的稳定身份
 * 对齐，前端只做本地化（字段目录 → 兜底目录 → 文档 label）与分组展示。
 * 排版差异仍按顶层键报增/删/改（后端 `_layout_diff`，同一份 `LayoutDiffOut`）。
 */
import { Alert, Button, Space, Tag, Typography } from "antd";
import { useMemo } from "react";
import { t } from "../../../i18n";
import type { MessageKey } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { changeTitle, changeTruncateText, changeValueText, summarizeCompare } from "./model";
import { fieldCatalogLabelResolver } from "../document/fieldCatalog";
import { useFieldPlacementCatalog } from "../../profile/library/fieldPlacement";
import type { VersionChangeOut, VersionCompareOut } from "./types";

interface Props {
  compare: VersionCompareOut;
  onClose: () => void;
}

const KIND_COLOR: Record<VersionChangeOut["kind"], string> = {
  added: "green",
  removed: "red",
  changed: "orange",
};

const KIND_LABEL_KEY: Record<VersionChangeOut["kind"], MessageKey> = {
  added: "versions.compare.kind.added",
  removed: "versions.compare.kind.removed",
  changed: "versions.compare.kind.changed",
};

const VALUE_STYLE = {
  old: { textDecoration: "line-through", color: "var(--rf-diff-removed-text)" },
  arrow: { color: "var(--rf-text-secondary)" },
  next: { color: "var(--rf-diff-added-text)", fontWeight: 600 },
} as const;

function ChangeRow({
  change,
  resolveLabel,
}: {
  change: VersionChangeOut;
  resolveLabel: (key: string, sectionKey?: string) => string | undefined;
}) {
  const title = changeTitle(change, resolveLabel);
  const detail =
    change.scope === "header"
      ? ""
      : [change.section_title, change.entry_label].filter(Boolean).join(" · ");
  return (
    <div
      data-change-kind={change.kind}
      data-change-scope={change.scope}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "baseline",
        padding: "4px 0",
        borderBottom: "1px dashed var(--rf-border-subtle)",
      }}
    >
      <Tag color={KIND_COLOR[change.kind]} style={{ marginInlineEnd: 0 }}>
        {t(KIND_LABEL_KEY[change.kind])}
      </Tag>
      <Typography.Text strong>{title}</Typography.Text>
      {detail ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {detail}
        </Typography.Text>
      ) : null}
      {change.kind === "changed" ? (
        <Space size={6} wrap>
          <Typography.Text style={VALUE_STYLE.old}>
            {changeValueText(change.old_value)}
          </Typography.Text>
          <Typography.Text style={VALUE_STYLE.arrow}>→</Typography.Text>
          <Typography.Text style={VALUE_STYLE.next}>
            {changeValueText(change.new_value)}
          </Typography.Text>
        </Space>
      ) : (
        <Typography.Text type="secondary">
          {changeValueText(change.kind === "removed" ? change.old_value : change.new_value)}
        </Typography.Text>
      )}
    </div>
  );
}

export default function VersionComparePanel({ compare, onClose }: Props) {
  useLocale();
  const digest = summarizeCompare(compare);
  const { catalog } = useFieldPlacementCatalog();
  const resolveLabel = useMemo(() => {
    const fromCatalog = fieldCatalogLabelResolver(catalog);
    return (key: string, sectionKey?: string) => fromCatalog(key, sectionKey);
  }, [catalog]);
  const againstLabel =
    compare.against_id === 0
      ? t("versions.compare.againstCurrent")
      : t("versions.compare.againstVersion", { name: compare.against_name });
  // 按变更所属板块分组：基本信息在前，其余按文档顺序（后端已按文档顺序下发）。
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: VersionChangeOut[] }>();
    for (const change of compare.changes ?? []) {
      const key = change.scope === "header" ? "header" : change.section_key || "other";
      const label =
        change.scope === "header"
          ? t("structure.node.header")
          : change.section_title || t("versions.compare.content");
      const group = map.get(key) ?? { label, items: [] };
      group.items.push(change);
      map.set(key, group);
    }
    return [...map.values()];
  }, [compare.changes]);
  const truncated = changeTruncateText(compare);
  return (
    <section
      style={{
        marginTop: 12,
        padding: 12,
        border: "1px solid var(--rf-border-subtle)",
        borderRadius: "var(--rf-radius-control)",
        background: "var(--rf-surface-alt)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Typography.Text strong>{compare.base_name || t("versions.compare.title")}</Typography.Text>
        <Typography.Text type="secondary">{againstLabel}</Typography.Text>
        <span style={{ flex: "1 1 auto" }} />
        <Button size="small" onClick={onClose}>
          {t("versions.compare.close")}
        </Button>
      </div>
      {digest.identical ? (
        <Typography.Text type="secondary">{t("versions.compare.identical")}</Typography.Text>
      ) : (
        <Space size={8} wrap style={{ marginTop: 6 }}>
          <Tag color="green">
            {t("versions.compare.changeStats", {
              added: digest.added,
              changed: digest.changed,
              removed: digest.removed,
            })}
          </Tag>
          {digest.layoutEqual ? <Tag color="green">{t("versions.compare.layoutEqual")}</Tag> : null}
          {compare.layout.added.length > 0 ? (
            <Tag color="blue">
              {t("versions.compare.layoutAdded", { keys: compare.layout.added.join(", ") })}
            </Tag>
          ) : null}
          {compare.layout.removed.length > 0 ? (
            <Tag color="red">
              {t("versions.compare.layoutRemoved", { keys: compare.layout.removed.join(", ") })}
            </Tag>
          ) : null}
          {compare.layout.changed.length > 0 ? (
            <Tag color="orange">
              {t("versions.compare.layoutChanged", { keys: compare.layout.changed.join(", ") })}
            </Tag>
          ) : null}
        </Space>
      )}
      <Typography.Text strong style={{ display: "block", marginTop: 10 }}>
        {t("versions.compare.content")}
      </Typography.Text>
      {truncated ? (
        <Alert type="warning" showIcon title={truncated} style={{ marginTop: 6 }} />
      ) : null}
      {groups.length === 0 ? (
        <Typography.Text type="secondary">{t("versions.compare.noContentChanges")}</Typography.Text>
      ) : (
        groups.map((group) => (
          <div key={group.label} style={{ marginTop: 8 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {group.label}
            </Typography.Text>
            {group.items.map((change) => (
              <ChangeRow
                key={`${change.kind}:${change.scope}:${change.path}`}
                change={change}
                resolveLabel={resolveLabel}
              />
            ))}
          </div>
        ))
      )}
    </section>
  );
}
