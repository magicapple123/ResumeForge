// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位变体面板（W13）：派生变体 + 选择性同步。
 *
 * 选择性同步的路径来自**当前简历内容**（`buildSyncPathOptions`：顶层字段 + 数组板块的
 * 每条）。契约 §3 的硬约束在这里落地：只提交勾选的变体与路径，其余岗位定制保持原样。
 */
import { Alert, App, Button, Checkbox, Input, Select, Space, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import EmptyState from "../../common/EmptyState";
import ErrorState from "../../common/ErrorState";
import LoadingBlock from "../../common/LoadingBlock";
import { t } from "../../../i18n";
import { buildSyncPathOptions, versionTimeText } from "../../../features/resume-versions/model";
import type {
  VariantOut,
  VariantSyncOut,
  VariantSyncRequest,
  VersionOut,
} from "../../../features/resume-versions/types";

interface Props {
  variants: VariantOut[];
  loading: boolean;
  error: string;
  actionError: string;
  syncing: boolean;
  versions: VersionOut[];
  currentContent?: Record<string, unknown> | null;
  onCreate: (name: string, baseVersionId?: number | null) => Promise<VariantOut | null>;
  onSync: (payload: VariantSyncRequest) => Promise<VariantSyncOut | null>;
  onRefresh: () => void;
}

export default function VariantsPanel({
  variants,
  loading,
  error,
  actionError,
  syncing,
  versions,
  currentContent,
  onCreate,
  onSync,
  onRefresh,
}: Props) {
  const { message } = App.useApp();
  const [name, setName] = useState("");
  const [baseVersionId, setBaseVersionId] = useState<number | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [targetIds, setTargetIds] = useState<number[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);

  const pathOptions = useMemo(() => buildSyncPathOptions(currentContent), [currentContent]);
  const groups = useMemo(() => {
    const map = new Map<string, { path: string; label: string }[]>();
    for (const option of pathOptions) {
      const list = map.get(option.group) ?? [];
      list.push({ path: option.path, label: option.label });
      map.set(option.group, list);
    }
    return [...map.entries()];
  }, [pathOptions]);

  const submitCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    const created = await onCreate(name.trim(), baseVersionId ?? null);
    setCreating(false);
    if (created) setName("");
  };

  const toggleGroup = (groupPaths: string[], checked: boolean) => {
    setSelectedPaths((current) => {
      const rest = current.filter((path) => !groupPaths.includes(path));
      return checked ? [...rest, ...groupPaths] : rest;
    });
  };

  const runSync = async () => {
    const result = await onSync({
      source_version_id: baseVersionId ?? null,
      variant_ids: targetIds,
      paths: selectedPaths,
    });
    if (result) {
      message.success(t("versions.variants.syncSuccess", { count: result.items.length }));
      setSelectedPaths([]);
      setTargetIds([]);
    }
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
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          padding: 12,
          border: "1px solid var(--rf-border-subtle)",
          borderRadius: "var(--rf-radius-control)",
        }}
      >
        <Typography.Text strong>{t("versions.variants.create.title")}</Typography.Text>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("versions.variants.create.namePlaceholder")}
          aria-label={t("versions.variants.create.name")}
          style={{ width: 220 }}
          maxLength={256}
        />
        <Select
          allowClear
          value={baseVersionId}
          onChange={(value) => setBaseVersionId(value)}
          placeholder={t("versions.variants.base.current")}
          aria-label={t("versions.variants.base.current")}
          style={{ width: 200 }}
          options={versions.map((version) => ({ value: version.id, label: version.name }))}
        />
        <Button
          type="primary"
          loading={creating}
          disabled={!name.trim()}
          onClick={() => void submitCreate()}
        >
          {t("versions.variants.create.action")}
        </Button>
        <Button onClick={onRefresh}>{t("versions.action.refresh")}</Button>
      </div>

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
          <Typography.Text strong>{t("versions.variants.selectTargets")}</Typography.Text>
          <Checkbox.Group
            value={targetIds}
            onChange={(values) => setTargetIds(values.map((value) => Number(value)))}
            options={variants.map((variant) => ({
              label: variant.name,
              value: variant.id,
            }))}
          />
          <Typography.Text strong>{t("versions.variants.selectPaths")}</Typography.Text>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {groups.map(([group, options]) => {
              const groupPaths = options.map((option) => option.path);
              const allChecked = groupPaths.every((path) => selectedPaths.includes(path));
              return (
                <div key={group}>
                  <Checkbox
                    checked={allChecked}
                    onChange={(event) => toggleGroup(groupPaths, event.target.checked)}
                  >
                    <Typography.Text strong>{group}</Typography.Text>
                  </Checkbox>
                  <Checkbox.Group
                    value={selectedPaths.filter((path) => groupPaths.includes(path))}
                    onChange={(values) => {
                      setSelectedPaths((current) => {
                        const rest = current.filter((path) => !groupPaths.includes(path));
                        return [...rest, ...values.map((value) => String(value))];
                      });
                    }}
                    options={options.map((option) => ({
                      label: option.label || option.path,
                      value: option.path,
                    }))}
                    style={{ display: "flex", flexDirection: "column", marginInlineStart: 24 }}
                  />
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
