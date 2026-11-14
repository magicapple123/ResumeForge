// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「助手记忆」卡（#31C 可见可改 + #18D 结构化画像手填入口 + F33 停用语义）。
 *
 * 一张表两个来源：source=manual（这里手填的画像）与 source=extracted（#31A 自动抽取）。
 * 为什么必须是同一张卡：两份「目标岗位」会互相打架（见 models/assistant_memory 的模块注释）。
 *
 * 三条产品红线（本卡是唯一人工维护入口）：
 * 1. **可见可改**：列表逐条展示内容/类型/来源/时间/来源摘录，可编辑、删除、停用、恢复；
 * 2. **自动抽取默认关**：开关写在后端 AppSetting，默认 false；开启前用户已经能看见并修改，
 *    才不存在"不可见不可改的记忆"；
 * 3. **敏感信息不记**：手机号/身份证/密钥由后端 422 拒绝，表单只做提示，不复制第二套校验。
 *
 * F33 起「永不使用」= `suppressed`（置灰留在列表、可恢复），与删除（从列表消失）分开；
 * 置信度不再外露（四家官方产品都不显示），但仍留在库里参与排序。
 * 行内展示与历史弹窗在 `AssistantMemoryRow`，本文件只管取数、筛选与弹层编排。
 */
import { App, Alert, Button, Card, Input, Select, Space, Switch, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import ErrorState from "../../components/common/ErrorState";
import EmptyState from "../../components/common/EmptyState";
import LoadingBlock from "../../components/common/LoadingBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import {
  MEMORY_KINDS,
  createAssistantMemory,
  deleteAssistantMemory,
  getAssistantMemorySettings,
  listAssistantMemories,
  listMemoryKinds,
  neverUseAssistantMemory,
  restoreAssistantMemory,
  saveAssistantMemorySettings,
  updateAssistantMemory,
  type AssistantMemory,
  type MemoryKindOption,
} from "./assistantMemoryApi";
import AssistantMemoryEditModal from "./AssistantMemoryEditModal";
import AssistantMemoryRow from "./AssistantMemoryRow";
import { memoryKindLabel } from "./assistantMemoryLabels";

type ModalState = { mode: "create" } | { mode: "edit"; memory: AssistantMemory } | null;
type SortMode = "recent" | "kind";

const FALLBACK_KIND_OPTIONS: MemoryKindOption[] = MEMORY_KINDS.map((kind) => ({
  kind,
  label: "",
}));

export default function AssistantMemoryCard() {
  useLocale();
  const { message, modal } = App.useApp();
  const [memories, setMemories] = useState<AssistantMemory[]>([]);
  const [kindOptions, setKindOptions] = useState<MemoryKindOption[]>(FALLBACK_KIND_OPTIONS);
  const [autoExtract, setAutoExtract] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [modalState, setModalState] = useState<ModalState>(null);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setMemories(await listAssistantMemories());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // 挂载加载：列表失败走错误态；设置/类型清单失败分别兜底，不拖累列表。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await load();
      try {
        const settings = await getAssistantMemorySettings();
        if (!cancelled) setAutoExtract(settings.auto_extract);
      } catch {
        // 读不到开关就保持默认关：宁可不开，也不假装已开。
      }
      try {
        const kinds = await listMemoryKinds();
        if (!cancelled && kinds.length > 0) setKindOptions(kinds);
      } catch {
        // 用本地七类兜底：白名单最终还是后端说了算。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const rows = keyword
      ? memories.filter((item) =>
          `${item.value} ${memoryKindLabel(item.kind, item.kind_label)}`
            .toLowerCase()
            .includes(keyword),
        )
      : [...memories];
    if (sortMode === "kind") {
      rows.sort((left, right) =>
        memoryKindLabel(left.kind, left.kind_label).localeCompare(
          memoryKindLabel(right.kind, right.kind_label),
          "zh-CN",
        ),
      );
    }
    return rows;
  }, [memories, query, sortMode]);

  const onToggleAutoExtract = async (checked: boolean) => {
    if (savingSettings) return;
    setSavingSettings(true);
    setAutoExtract(checked);
    try {
      const saved = await saveAssistantMemorySettings(checked);
      setAutoExtract(saved.auto_extract);
      message.success(
        t(
          checked
            ? "assistantMemory.autoExtract.enableToast"
            : "assistantMemory.autoExtract.disableToast",
        ),
      );
    } catch (err) {
      setAutoExtract(!checked);
      message.error(
        err instanceof Error ? err.message : t("assistantMemory.autoExtract.saveFailed"),
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const closeModal = () => setModalState(null);

  /** 提交（新建/编辑）：成功才关弹层；失败把原因抛回弹层内联展示。 */
  const submitModal = async (input: { kind: string; value: string; key: string }) => {
    if (modalState?.mode === "edit") {
      await updateAssistantMemory(modalState.memory.id, { value: input.value, key: input.key });
    } else {
      await createAssistantMemory({ kind: input.kind, value: input.value, key: input.key });
    }
    message.success(t("assistantMemory.toast.saved"));
    setModalState(null);
    await load();
  };

  const confirmDelete = (memory: AssistantMemory) => {
    modal.confirm({
      title: t("assistantMemory.deleteConfirm.title"),
      content: t("assistantMemory.deleteConfirm.body"),
      okText: t("assistantMemory.deleteConfirm.ok"),
      cancelText: t("assistantMemory.action.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteAssistantMemory(memory.id);
          message.success(t("assistantMemory.toast.deleted"));
          await load();
        } catch (err) {
          message.error(err instanceof Error ? err.message : t("assistantMemory.toast.failed"));
          throw err;
        }
      },
    });
  };

  const confirmNeverUse = (memory: AssistantMemory) => {
    modal.confirm({
      title: t("assistantMemory.neverUseConfirm.title"),
      content: t("assistantMemory.neverUseConfirm.body"),
      okText: t("assistantMemory.neverUseConfirm.ok"),
      cancelText: t("assistantMemory.action.cancel"),
      onOk: async () => {
        try {
          await neverUseAssistantMemory(memory.id);
          message.success(t("assistantMemory.toast.neverUse"));
          await load();
        } catch (err) {
          message.error(err instanceof Error ? err.message : t("assistantMemory.toast.failed"));
          throw err;
        }
      },
    });
  };

  const restore = async (memory: AssistantMemory) => {
    try {
      await restoreAssistantMemory(memory.id);
      message.success(t("assistantMemory.toast.restored"));
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("assistantMemory.toast.failed"));
    }
  };

  /** 清空全部：后端没有批量端点，逐条软删（数量上限 200，列表很小）。 */
  const confirmClearAll = () => {
    const count = memories.length;
    if (count === 0) return;
    modal.confirm({
      title: t("assistantMemory.clearConfirm.title"),
      content: t("assistantMemory.clearConfirm.body", { count }),
      okText: t("assistantMemory.clearConfirm.ok"),
      cancelText: t("assistantMemory.action.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        let removed = 0;
        for (const memory of memories) {
          try {
            await deleteAssistantMemory(memory.id);
            removed += 1;
          } catch {
            // 单条失败不中断：已删的立即生效，失败的最后如实报出来。
          }
        }
        await load();
        if (removed === count) {
          message.success(t("assistantMemory.toast.cleared", { count: removed }));
        } else {
          message.error(t("assistantMemory.toast.failed"));
        }
      },
    });
  };

  return (
    <Card title={t("assistantMemory.title")} className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {t("assistantMemory.intro")}
      </Typography.Paragraph>
      <LoadingBlock spinning={loading}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Space size={8} wrap>
            <Typography.Text strong>{t("assistantMemory.autoExtract.label")}</Typography.Text>
            <Switch
              checked={autoExtract}
              loading={savingSettings}
              checkedChildren={t("settingsUi.switch.on")}
              unCheckedChildren={t("settingsUi.switch.off")}
              aria-label={t("assistantMemory.autoExtract.label")}
              onChange={(checked) => void onToggleAutoExtract(checked)}
            />
          </Space>
          <Typography.Text type="secondary">
            {t("assistantMemory.autoExtract.hint")}
          </Typography.Text>

          <Space size={8} wrap>
            <Typography.Text type="secondary">
              {t("assistantMemory.count", { count: memories.length })}
            </Typography.Text>
            <Button type="primary" size="small" onClick={() => setModalState({ mode: "create" })}>
              {t("assistantMemory.action.add")}
            </Button>
            <Button size="small" danger disabled={memories.length === 0} onClick={confirmClearAll}>
              {t("assistantMemory.action.clearAll")}
            </Button>
          </Space>

          {memories.length > 0 ? (
            <Space size={8} wrap>
              <Input.Search
                allowClear
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("assistantMemory.search.placeholder")}
                aria-label={t("assistantMemory.search.placeholder")}
                style={{ width: 240 }}
              />
              <Select<SortMode>
                value={sortMode}
                onChange={setSortMode}
                style={{ width: 150 }}
                aria-label={t("assistantMemory.sort.label")}
                options={[
                  { value: "recent", label: t("assistantMemory.sort.recent") },
                  { value: "kind", label: t("assistantMemory.sort.kind") },
                ]}
              />
            </Space>
          ) : null}

          {loadError ? (
            <ErrorState description={t("assistantMemory.loadFailed")} onRetry={() => void load()} />
          ) : memories.length === 0 ? (
            <EmptyState
              inline
              description={t("assistantMemory.empty")}
              actionLabel={t("assistantMemory.action.add")}
              onAction={() => setModalState({ mode: "create" })}
            />
          ) : visible.length === 0 ? (
            <EmptyState inline description={t("assistantMemory.empty")} />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
              {visible.map((memory) => (
                <AssistantMemoryRow
                  key={memory.id}
                  memory={memory}
                  onEdit={(item) => setModalState({ mode: "edit", memory: item })}
                  onNeverUse={confirmNeverUse}
                  onRestore={(item) => void restore(item)}
                  onDelete={confirmDelete}
                />
              ))}
            </ul>
          )}
          <Alert
            type="info"
            showIcon
            title={t("assistantMemory.form.sensitiveHint")}
            style={{ marginTop: 4 }}
          />
        </Space>
      </LoadingBlock>
      {modalState ? (
        <AssistantMemoryEditModal
          mode={modalState.mode}
          memory={modalState.mode === "edit" ? modalState.memory : null}
          kindOptions={kindOptions}
          onCancel={closeModal}
          onSubmit={submitModal}
        />
      ) : null}
    </Card>
  );
}
