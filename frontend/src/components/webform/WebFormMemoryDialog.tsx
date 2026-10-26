// SPDX-License-Identifier: Apache-2.0
/** 「记住这条」的资料目标选择器。 */
import { CheckCircleFilled, DownOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { App, Button, Card, Input, Modal, Radio, Space, Tag, Typography } from "antd";
import EmptyState from "../common/EmptyState";
import { useMemo, useState } from "react";
import type { WebFormMemoryTarget, WebFormRememberPending } from "../../types";
import { useGroupTone } from "./webFormGroupTones";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { WEBFORM_CUSTOM_GROUP, webformGroupLabel } from "../../features/webform/groupIdentity";
import { webformFieldLabel } from "../../features/webform/webformFieldLabels";

export interface WebFormMemorySelection {
  target_id: string;
  value: string;
  label: string;
  reuse: "general";
}

interface Props {
  open: boolean;
  pending: WebFormRememberPending | null;
  targets: WebFormMemoryTarget[];
  loading: boolean;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (selection: WebFormMemorySelection) => void;
}

function fuzzyIncludes(text: string, keyword: string): boolean {
  const source = text.toLocaleLowerCase();
  const needle = keyword.toLocaleLowerCase();
  if (!needle) return true;
  if (source.includes(needle)) return true;
  let cursor = 0;
  for (const char of source) {
    if (char === needle[cursor]) {
      cursor += 1;
      if (cursor === needle.length) return true;
    }
  }
  return false;
}

function inputKind(target: WebFormMemoryTarget | undefined): "text" | "textarea" {
  return target?.kind === "longtext" ? "textarea" : "text";
}

export default function WebFormMemoryDialog({
  open,
  pending,
  targets,
  loading,
  saving,
  onCancel,
  onSubmit,
}: Props) {
  const { message } = App.useApp();
  const locale = useLocale();
  const webformProfileLabel = t("profileLibrary.tab.webform");
  // 分组色调跟随主题（R18）：深色下浅底 chip 会变成一块白砖。
  const groupTone = useGroupTone();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("custom");
  const [customLabel, setCustomLabel] = useState("");
  const [value, setValue] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // 打开时按"记忆的待填字段"预填选择。Compiler 规范：随 open/pending/targets 变化
  // 的回填用渲染期守卫式调整。
  const [prevSync, setPrevSync] = useState<{
    open: boolean;
    pending: WebFormRememberPending | null;
    targets: WebFormMemoryTarget[];
  } | null>(null);
  if (
    prevSync === null ||
    prevSync.open !== open ||
    prevSync.pending !== pending ||
    prevSync.targets !== targets
  ) {
    setPrevSync({ open, pending, targets });
    if (open && pending) {
      const preferred = targets.find((target) => target.field_key === pending.field_key);
      setSearch("");
      setSelectedId(preferred?.target_id ?? "custom");
      setCustomLabel(preferred ? "" : pending.field_label || pending.control_label || "");
      setValue(pending.value);
      setCollapsedGroups(
        new Set(
          targets.map((target) => target.group).filter((group) => group !== WEBFORM_CUSTOM_GROUP),
        ),
      );
    }
  }

  const selectedTarget = targets.find((target) => target.target_id === selectedId);
  const filteredTargets = useMemo(() => {
    void locale;
    return targets.filter((target) =>
      fuzzyIncludes(
        [
          webformGroupLabel(target.group),
          target.group,
          webformFieldLabel(target.field_key, target.label),
          target.value,
          target.field_key,
        ].join(" "),
        search.trim(),
      ),
    );
  }, [locale, search, targets]);

  const groupedTargets = useMemo(() => {
    const groups = new Map<string, WebFormMemoryTarget[]>();
    for (const target of filteredTargets) {
      const items = groups.get(target.group) ?? [];
      items.push(target);
      groups.set(target.group, items);
    }
    return [...groups.entries()];
  }, [filteredTargets]);

  const canSubmit = Boolean(value.trim() && (selectedId !== "custom" || customLabel.trim()));
  const searching = Boolean(search.trim());

  const toggleGroup = (group: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const selectTarget = (target: WebFormMemoryTarget) => {
    setSelectedId(target.target_id);
    setCollapsedGroups((current) => {
      const next = new Set(current);
      next.delete(target.group);
      return next;
    });
  };

  const handleSubmit = () => {
    if (!canSubmit) {
      message.warning(
        selectedId === "custom"
          ? t("profileLibrary.webform.fieldNameRequired")
          : t("profileLibrary.webform.valueRequired"),
      );
      return;
    }
    onSubmit({
      target_id: selectedId,
      value: value.trim(),
      label: selectedId === "custom" ? customLabel.trim() : (selectedTarget?.label ?? ""),
      reuse: "general",
    });
  };

  return (
    <Modal
      open={open}
      width={760}
      title={t("profileLibrary.webform.rememberTitle")}
      okText={t("profileLibrary.webform.rememberSave")}
      cancelText={t("profileLibrary.webform.rememberCancel")}
      confirmLoading={saving}
      okButtonProps={{ disabled: !canSubmit }}
      onCancel={onCancel}
      onOk={handleSubmit}
      // 可复用的已有资料列表可能很长：限高让超长内容只滚弹窗内部。
      styles={{
        body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto", overflowX: "hidden" },
      }}
      destroyOnHidden
    >
      {pending ? (
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          <Card size="small" style={{ background: "var(--rf-brand-wash)" }}>
            <Space orientation="vertical" size={4}>
              <Typography.Text type="secondary">
                {t("profileLibrary.webform.browserField")}
              </Typography.Text>
              <Typography.Text strong>
                {pending.control_label ||
                  pending.field_label ||
                  t("profileLibrary.webform.untitledField")}
              </Typography.Text>
              <Typography.Text>
                {t("profileLibrary.webform.rememberValue", { value: pending.value })}
              </Typography.Text>
              <Typography.Text type="secondary">
                {t("profileLibrary.webform.rememberHint")}
              </Typography.Text>
            </Space>
          </Card>

          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder={t("profileLibrary.webform.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <div style={{ maxHeight: 330, overflow: "auto", paddingRight: 4 }}>
            <Card
              size="small"
              hoverable
              style={{
                marginBottom: 12,
                borderColor: selectedId === "custom" ? "var(--rf-info)" : undefined,
                background: selectedId === "custom" ? "var(--rf-brand-wash)" : undefined,
              }}
              onClick={() => setSelectedId("custom")}
            >
              <Space align="start">
                <Radio checked={selectedId === "custom"} />
                <PlusOutlined style={{ color: "var(--rf-info)", marginTop: 4 }} />
                <Space orientation="vertical" size={2}>
                  <Space wrap size={6}>
                    <Typography.Text strong>
                      {t("profileLibrary.webform.addCustom")}
                    </Typography.Text>
                    <Tag color="blue">
                      {t("profileLibrary.tab.webform")} · {webformGroupLabel(WEBFORM_CUSTOM_GROUP)}
                    </Tag>
                  </Space>
                  <Typography.Text type="secondary">
                    {t("profileLibrary.webform.addCustomHint")}
                  </Typography.Text>
                </Space>
              </Space>
            </Card>

            {loading ? (
              <Typography.Text type="secondary">
                {t("profileLibrary.webform.directoryLoading")}
              </Typography.Text>
            ) : groupedTargets.length ? (
              groupedTargets.map(([group, items]) => {
                const expanded = searching || !collapsedGroups.has(group);
                const tone = groupTone(group);
                return (
                  <section key={group} style={{ marginBottom: 14 }}>
                    <Button
                      type="text"
                      block
                      aria-expanded={expanded}
                      aria-controls={`webform-memory-group-${group}`}
                      onClick={() => toggleGroup(group)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        justifyContent: "flex-start",
                        marginBottom: expanded ? 8 : 0,
                        padding: "7px 10px",
                        height: "auto",
                        border: `1px solid ${tone.border}`,
                        borderRadius: 8,
                        color: tone.color,
                        background: expanded ? tone.background : "var(--rf-surface)",
                        fontWeight: 700,
                      }}
                    >
                      <DownOutlined rotate={expanded ? 0 : -90} />
                      <span
                        style={{
                          minWidth: 0,
                          flex: 1,
                          textAlign: "left",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t("profileLibrary.tab.webform")} · {webformGroupLabel(group)}
                      </span>
                      <Tag
                        style={{
                          marginInlineEnd: 0,
                          color: tone.color,
                          borderColor: tone.border,
                          background: "var(--rf-surface)",
                        }}
                      >
                        {t("profileLibrary.webform.itemCount", { count: items.length })}
                      </Tag>
                    </Button>
                    {expanded ? (
                      <Space
                        id={`webform-memory-group-${group}`}
                        orientation="vertical"
                        size={8}
                        style={{ width: "100%" }}
                      >
                        {items.map((target) => {
                          const selected = target.target_id === selectedId;
                          return (
                            <Card
                              key={target.target_id}
                              size="small"
                              hoverable
                              style={{
                                borderColor: selected ? "var(--rf-info)" : undefined,
                                background: selected ? "var(--rf-brand-wash)" : undefined,
                              }}
                              onClick={() => selectTarget(target)}
                            >
                              <Space align="start" style={{ width: "100%" }}>
                                <Radio checked={selected} />
                                <Space
                                  orientation="vertical"
                                  size={2}
                                  style={{ minWidth: 0, flex: 1 }}
                                >
                                  <Space wrap size={6}>
                                    <Typography.Text strong>
                                      {webformFieldLabel(target.field_key, target.label)}
                                    </Typography.Text>
                                    <Tag color="orange">{webformProfileLabel}</Tag>
                                    {selected ? (
                                      <CheckCircleFilled style={{ color: "var(--rf-info)" }} />
                                    ) : null}
                                  </Space>
                                  <Typography.Text type="secondary" ellipsis>
                                    {t("profileLibrary.webform.currentValue", {
                                      value: target.value || t("profileLibrary.webform.notFilled"),
                                    })}
                                  </Typography.Text>
                                </Space>
                              </Space>
                            </Card>
                          );
                        })}
                      </Space>
                    ) : null}
                  </section>
                );
              })
            ) : (
              <EmptyState inline description={t("profileLibrary.webform.noMatch")} />
            )}
          </div>

          {selectedId === "custom" ? (
            /* addonBefore 已废弃（v6）：按官方指引以 Space.Compact + Space.Addon 重组。 */
            <Space.Compact block>
              <Space.Addon>{t("profileLibrary.webform.fieldName")}</Space.Addon>
              <Input
                autoFocus
                placeholder={t("profileLibrary.webform.fieldNamePlaceholder")}
                value={customLabel}
                onChange={(event) => setCustomLabel(event.target.value)}
                maxLength={40}
              />
            </Space.Compact>
          ) : null}

          <Space orientation="vertical" size={6} style={{ width: "100%" }}>
            <Typography.Text strong>{t("profileLibrary.webform.valueToSave")}</Typography.Text>
            {inputKind(selectedTarget) === "textarea" ? (
              <Input.TextArea
                rows={3}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            ) : (
              <Input value={value} onChange={(event) => setValue(event.target.value)} />
            )}
          </Space>

          <Typography.Text type="secondary">
            {t("profileLibrary.webform.reuseHint")}
          </Typography.Text>
        </Space>
      ) : null}
    </Modal>
  );
}
