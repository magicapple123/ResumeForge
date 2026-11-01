// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位变体面板（W13 / #29a）：已有变体列表 + 选择性同步。
 *
 * 创建入口已合并到 VariantCreatePanel（Segmented 二选一 + 一个「创建变体」）；
 * 这里只保留列表与"同步到已有变体"。同步的路径来自**当前简历内容**
 * （`buildSyncPathOptions`）。契约 §3 的硬约束在这里落地：只提交勾选的变体与路径，
 * 其余岗位定制保持原样。
 */
import { Alert, App, Button, Checkbox, Space, Tag, Typography } from "antd";
import { CaretDownOutlined, CaretRightOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import EmptyState from "../../common/EmptyState";
import ErrorState from "../../common/ErrorState";
import LoadingBlock from "../../common/LoadingBlock";
import { t } from "../../../i18n";
import { buildSyncPathOptions, versionTimeText } from "../../../features/resume-versions/model";
import { fieldCatalogLabelResolver } from "../../../features/resume-document/fieldCatalog";
import { useFieldPlacementCatalog } from "../../../features/profile-library/fieldPlacement";
import type { ResumeDocument } from "../../../types/resumeDocument";
import type {
  VariantOut,
  VariantSyncOut,
  VariantSyncRequest,
  VersionOut,
} from "../../../features/resume-versions/types";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  variants: VariantOut[];
  loading: boolean;
  error: string;
  actionError: string;
  syncing: boolean;
  versions: VersionOut[];
  /** 当前 v2 文档：选择性同步的路径来源（`header.<itemId>` / `<sectionKey>.<entryId>`）。 */
  currentDocument?: ResumeDocument | null;
  onSync: (payload: VariantSyncRequest) => Promise<VariantSyncOut | null>;
  /** 刷新"已有变体"列表（页面里唯一的刷新入口）。 */
  onRefresh: () => void;
}

export default function VariantsPanel({
  variants,
  loading,
  error,
  actionError,
  syncing,
  versions,
  currentDocument,
  onSync,
  onRefresh,
}: Props) {
  useLocale();
  const { message } = App.useApp();
  const [targetIds, setTargetIds] = useState<number[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);

  // #29b：页眉字段名走字段目录本地化（「姓名」而不是 `name`）。
  const { catalog: syncCatalog } = useFieldPlacementCatalog();
  const pathOptions = useMemo(
    () => buildSyncPathOptions(currentDocument, fieldCatalogLabelResolver(syncCatalog)),
    [currentDocument, syncCatalog],
  );
  // 按板块分组（顺序 = 文档里的板块顺序，基本信息的 header 排最前）。
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { key: string; label: string; options: { path: string; label: string }[] }
    >();
    for (const option of pathOptions) {
      const group = map.get(option.group) ?? {
        key: option.group,
        label: option.groupLabel,
        options: [],
      };
      group.options.push({ path: option.path, label: option.label });
      map.set(option.group, group);
    }
    return [...map.values()];
  }, [pathOptions]);
  const allSelected =
    pathOptions.length > 0 && pathOptions.every((option) => selectedPaths.includes(option.path));

  const toggleGroup = (groupPaths: string[], checked: boolean) => {
    setSelectedPaths((current) => {
      const rest = current.filter((path) => !groupPaths.includes(path));
      return checked ? [...rest, ...groupPaths] : rest;
    });
  };

  const runSync = async () => {
    // 同步来源 = 当前简历（创建表单合并后不再有"基于哪份版本"的输入；命名版本同步走 API）。
    const result = await onSync({
      source_version_id: null,
      variant_ids: targetIds,
      paths: selectedPaths,
    });
    if (result) {
      message.success(t("versions.variants.syncSuccess", { count: result.items.length }));
      // 目标变体里没有这个 id（条目被删过）时后端不会写，`applied_paths` 会少一条：
      // 只说"已同步 N 个变体"会让用户以为全都写进去了。
      const applied = new Set(result.items.flatMap((item) => item.applied_paths));
      const missing = selectedPaths.filter((path) => !applied.has(path)).length;
      if (missing > 0) message.warning(t("versions.variants.syncPartial", { count: missing }));
      setSelectedPaths([]);
      setTargetIds([]);
    }
  };

  const toggleGroupCollapsed = (group: string) => {
    setCollapsedGroups((current) =>
      current.includes(group) ? current.filter((key) => key !== group) : [...current, group],
    );
  };

  const baseLabel = (variant: VariantOut): string => {
    if (variant.base_version_id == null) return t("versions.variants.base.current");
    const version = versions.find((item) => item.id === variant.base_version_id);
    return version
      ? t("versions.variants.base.version", { name: version.name })
      : t("versions.variants.base.current");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Space size={8} wrap>
        <Typography.Text strong>{t("versions.variants.list.title")}</Typography.Text>
        <Button size="small" icon={<ReloadOutlined />} onClick={onRefresh}>
          {t("versions.variants.refreshAction")}
        </Button>
      </Space>

      {actionError ? <Alert type="error" showIcon title={actionError} /> : null}

      {loading && variants.length === 0 ? (
        <LoadingBlock tip={t("versions.loading")} />
      ) : error ? (
        <ErrorState
          description={error}
          onRetry={onRefresh}
          retryLabel={t("versions.error.retry")}
        />
      ) : variants.length === 0 ? (
        <EmptyState inline description={t("versions.variants.empty")} />
      ) : (
        <ul style={{ margin: 0, padding: 0 }}>
          {variants.map((variant) => (
            <li
              key={variant.id}
              style={{
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: "10px 0",
                borderBottom: "1px solid var(--rf-border-subtle)",
              }}
            >
              <Space size={8} wrap>
                <Typography.Text strong>{variant.name}</Typography.Text>
                <Tag>{baseLabel(variant)}</Tag>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {variant.job_title
                    ? `${variant.job_title}${variant.company ? " · " + variant.company : ""}`
                    : t("versions.job.none")}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {variant.last_synced_version_id != null
                    ? t("versions.variants.lastSynced", {
                        id: variant.last_synced_version_id,
                      })
                    : t("versions.variants.neverSynced")}
                  {variant.synced_at ? ` · ${versionTimeText(variant.synced_at)}` : ""}
                </Typography.Text>
              </Space>
            </li>
          ))}
        </ul>
      )}

      {variants.length > 0 && pathOptions.length > 0 ? (
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: 12,
            border: "1px solid var(--rf-border-subtle)",
            borderRadius: "var(--rf-radius-control)",
            background: "var(--rf-surface-alt)",
          }}
        >
          <Typography.Text strong>{t("versions.variants.sync.title")}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("versions.variants.sync.groupHint")}
          </Typography.Text>
          <Typography.Text strong>{t("versions.variants.selectTargets")}</Typography.Text>
          <Checkbox.Group
            value={targetIds}
            onChange={(values) => setTargetIds(values.map((value) => Number(value)))}
            options={variants.map((variant) => ({
              label: variant.name,
              value: variant.id,
            }))}
          />
          <Space size={8} wrap>
            <Typography.Text strong>{t("versions.variants.selectPaths")}</Typography.Text>
            <Button
              size="small"
              type="link"
              onClick={() => setSelectedPaths(pathOptions.map((option) => option.path))}
              disabled={allSelected}
            >
              {t("versions.variants.selectAll")}
            </Button>
            <Button
              size="small"
              type="link"
              onClick={() => setSelectedPaths([])}
              disabled={selectedPaths.length === 0}
            >
              {t("versions.variants.clearAll")}
            </Button>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("versions.variants.selectedCount", { count: selectedPaths.length })}
            </Typography.Text>
          </Space>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {groups.map((group) => {
              const groupPaths = group.options.map((option) => option.path);
              const checkedInGroup = selectedPaths.filter((path) => groupPaths.includes(path));
              const allChecked = checkedInGroup.length === groupPaths.length;
              const collapsed = collapsedGroups.includes(group.key);
              return (
                <div
                  key={group.key}
                  style={{
                    borderTop: "1px solid var(--rf-border-subtle)",
                    paddingTop: 4,
                  }}
                >
                  <Space size={4} wrap>
                    <Button
                      type="text"
                      size="small"
                      aria-expanded={!collapsed}
                      aria-label={t("versions.variants.groupToggle", { name: group.label })}
                      icon={collapsed ? <CaretRightOutlined /> : <CaretDownOutlined />}
                      onClick={() => toggleGroupCollapsed(group.key)}
                    />
                    <Checkbox
                      checked={allChecked}
                      indeterminate={checkedInGroup.length > 0 && !allChecked}
                      onChange={(event) => toggleGroup(groupPaths, event.target.checked)}
                    >
                      <Typography.Text strong>{group.label}</Typography.Text>
                    </Checkbox>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t("versions.variants.groupCount", { count: groupPaths.length })}
                    </Typography.Text>
                  </Space>
                  {collapsed ? null : (
                    <Checkbox.Group
                      value={checkedInGroup}
                      onChange={(values) => {
                        setSelectedPaths((current) => {
                          const rest = current.filter((path) => !groupPaths.includes(path));
                          return [...rest, ...values.map((value) => String(value))];
                        });
                      }}
                      options={group.options.map((option) => ({
                        label: option.label || option.path,
                        value: option.path,
                      }))}
                      style={{ display: "flex", flexDirection: "column", marginInlineStart: 32 }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <Space>
            <Button
              type="primary"
              loading={syncing}
              disabled={targetIds.length === 0 || selectedPaths.length === 0}
              onClick={() => void runSync()}
            >
              {t("versions.variants.syncAction")}
            </Button>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("versions.variants.syncHint")}
            </Typography.Text>
          </Space>
        </section>
      ) : null}
    </div>
  );
}
