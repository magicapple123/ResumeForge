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
 * 3. **敏感信息不记**：手机号/身份证/密钥由后端 422 拒绝，提示文案挂在新增/编辑弹窗里
 *    （`form.sensitiveHint`）——那句提示只在**要输入内容的那一刻**有用，放在卡片底部
 *    隔着整屏，读到时已经填完了。
 *
 * ## 版面（I-03）：三段分区 + 动作收拢
 *
 * 改造前是 5 个 `Space size={12}` 平铺：`清空全部`（危险动作）与主操作并排、还压在列表
 * 上方；1 条数据也照样摆出搜索框和排序；敏感提示 Alert 隔着整屏。现在：
 *
 * - **开关区 / 列表区 / 底注**三段，用 `Divider` 切开，`清空全部` 移出列表区、进 `Card extra`；
 * - 列表头一行：左「生效 N 条」、右「添加记忆」；筛选器（搜索 + 排序）只在**超过 3 条**时
 *   出现——1 条数据时的搜索框只是噪音；
 * - 空态用 `inline` 空态（不套 192px 的 `.rf-state` 外壳），所以不会把整块撑满。
 *
 * F33 起「永不使用」= `suppressed`（置灰留在列表、可恢复），与删除（从列表消失）分开；
 * 置信度不再外露（四家官方产品都不显示），但仍留在库里参与排序。
 * 行内展示、`⋯` 菜单与历史弹窗在 `AssistantMemoryRow`，本文件只管取数、筛选与弹层编排。
 */
import { App, Button, Card, Divider, Flex, Input, Select, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import ErrorState from "../../components/common/ErrorState";
import EmptyState from "../../components/common/EmptyState";
import LoadingBlock from "../../components/common/LoadingBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { HintDetail } from "../../components/common/HintDetail";
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
import AssistantMemorySwitches from "./AssistantMemorySwitches";
import SettingsResetButton from "./SettingsResetButton";
import { useSettingsResetListener } from "./useSettingsResetListener";
import { memoryKindLabel } from "./assistantMemoryLabels";

type ModalState = { mode: "create" } | { mode: "edit"; memory: AssistantMemory } | null;
type SortMode = "recent" | "kind";

const FALLBACK_KIND_OPTIONS: MemoryKindOption[] = MEMORY_KINDS.map((kind) => ({
  kind,
  label: "",
}));

/**
 * I-10：这张卡能恢复默认的键。
 *
 * 两个开关都属于设置项（T23 起注入开关也在其中）——记忆条目本身是用户数据，恢复设置
 * **不会**也不该删掉它们，所以这里绝不把记忆列表放进重置范围。
 */
const MEMORY_RESET_KEYS = ["assistant_memory_auto_extract", "assistant_memory_inject"];

/**
 * 出现搜索/排序的最少条数。
 *
 * 4 条起：3 条以内一眼看得完，摆一个 140px 的搜索框只是在告诉用户"这里可能很复杂"。
 * 阈值写在这里而不是散在 JSX 里，是因为验收（"1 条数据时不存在搜索/排序"）读的就是它。
 */
const FILTER_MIN_COUNT = 3;

export default function AssistantMemoryCard() {
  useLocale();
  const { message, modal } = App.useApp();
  const [memories, setMemories] = useState<AssistantMemory[]>([]);
  const [kindOptions, setKindOptions] = useState<MemoryKindOption[]>(FALLBACK_KIND_OPTIONS);
  const [autoExtract, setAutoExtract] = useState(false);
  // T23：注入总开关默认开（与后端缺行 = 默认开同口径），读失败时保持开。
  const [inject, setInject] = useState(true);
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

  // 只重取「设置」这一侧：恢复默认不碰记忆条目，没必要多要一次全量列表。
  const loadSettings = useCallback(async () => {
    try {
      const settings = await getAssistantMemorySettings();
      setAutoExtract(settings.auto_extract);
      setInject(settings.inject);
    } catch {
      // 读不到开关就保持默认（自动整理关、注入开）：宁可维持原行为，也不假装改过。
    }
  }, []);

  // 挂载加载：列表失败走错误态；设置/类型清单失败分别兜底，不拖累列表。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await load();
      await loadSettings();
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
  }, [load, loadSettings]);

  // I-10：恢复默认后重取自动抽取开关（重置是删行，必须重新问一次才知道现在是关的）。
  useSettingsResetListener(() => void loadSettings());

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
      const saved = await saveAssistantMemorySettings({ auto_extract: checked });
      setAutoExtract(saved.auto_extract);
      setInject(saved.inject);
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

  /** T23：注入总开关。与自动整理共用一个 PUT，但只送自己这一项。 */
  const onToggleInject = async (checked: boolean) => {
    if (savingSettings) return;
    setSavingSettings(true);
    setInject(checked);
    try {
      const saved = await saveAssistantMemorySettings({ inject: checked });
      setAutoExtract(saved.auto_extract);
      setInject(saved.inject);
      message.success(
        t(checked ? "assistantMemory.inject.enableToast" : "assistantMemory.inject.disableToast"),
      );
    } catch (err) {
      setInject(!checked);
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
    <Card
      title={
        <Flex align="center" gap={8}>
          <span>{t("assistantMemory.title")}</span>
          {/* I-10：卡片级恢复默认（只复位两个开关，不动任何记忆条目）。 */}
          <SettingsResetButton keys={MEMORY_RESET_KEYS} />
        </Flex>
      }
      className="settings-card"
      extra={
        // T23 卡头右侧：信任语「只存在本机」。危险动作不再占这个位置（见列表底部）。
        <span className="rf-memory-trust">{t("assistantMemory.trust.local")}</span>
      }
    >
      <LoadingBlock spinning={loading}>
        {/* T23：intro 此前没有任何渲染点，现在是卡头下方那句信任语。 */}
        <Typography.Text type="secondary" className="rf-memory-intro">
          {t("assistantMemory.intro")}
        </Typography.Text>
        {/* ① 开关区：两行「标题 + 一句说明 + 开关」，控件本身不再写「开/关」。 */}
        <AssistantMemorySwitches
          autoExtract={autoExtract}
          inject={inject}
          saving={savingSettings}
          onToggleAutoExtract={(checked) => void onToggleAutoExtract(checked)}
          onToggleInject={(checked) => void onToggleInject(checked)}
        />

        <Divider className="rf-memory-divider" />

        {/* ② 列表区 */}
        <div className="rf-memory-list" data-testid="assistant-memory-list">
          {loadError ? (
            <ErrorState description={t("assistantMemory.loadFailed")} onRetry={() => void load()} />
          ) : memories.length === 0 ? (
            // 空态不占满整块：inline 空态没有 192px 最小高度，一个问题 + 一个动作就走完。
            <EmptyState
              inline
              description={t("assistantMemory.empty")}
              actionLabel={t("assistantMemory.action.add")}
              onAction={() => setModalState({ mode: "create" })}
            />
          ) : (
            <>
              <div className="rf-memory-list-head">
                <Typography.Text type="secondary" className="rf-memory-count">
                  {/* T23：「生效 N 条」→「记忆 · N 条」；N 是列表长度，不再只数 active。 */}
                  {t("assistantMemory.list.count", { count: memories.length })}
                </Typography.Text>
                <Button
                  type="primary"
                  size="small"
                  onClick={() => setModalState({ mode: "create" })}
                >
                  {t("assistantMemory.action.add")}
                </Button>
              </div>
              {memories.length > FILTER_MIN_COUNT ? (
                <div className="rf-memory-filters">
                  <Input.Search
                    allowClear
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("assistantMemory.search.placeholder")}
                    aria-label={t("assistantMemory.search.placeholder")}
                    style={{ width: 140 }}
                  />
                  <Select<SortMode>
                    value={sortMode}
                    onChange={setSortMode}
                    style={{ width: 140 }}
                    aria-label={t("assistantMemory.sort.label")}
                    options={[
                      { value: "recent", label: t("assistantMemory.sort.recent") },
                      { value: "kind", label: t("assistantMemory.sort.kind") },
                    ]}
                  />
                </div>
              ) : null}
              {visible.length === 0 ? (
                <EmptyState inline description={t("assistantMemory.empty")} />
              ) : (
                <ul className="rf-memory-rows">
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
              {/* T23：「清空全部」下沉到列表底部——危险动作不占卡头，也不与「添加」并排。 */}
              <div className="rf-memory-list-foot">
                <Button type="text" danger className="rf-memory-clear" onClick={confirmClearAll}>
                  {t("assistantMemory.action.clearAll")}
                </Button>
              </div>
            </>
          )}
        </div>

        <Divider className="rf-memory-divider" />

        {/* ③ 底注：隐私句在前，机制说明收进 ⓘ（不再用一整句解释注入算法）。 */}
        <div className="rf-memory-footnote">
          <Typography.Text type="secondary">
            {t("assistantMemory.footnote.privacy")}
          </Typography.Text>
          {/* I-28：同一条说明从 Tooltip 换到 HintDetail——默认仍是"点开看"，但 Alt+H
              下会原地展开（Tooltip 不参与提示模式）。文案与无障碍名都复用原键。 */}
          <HintDetail
            detail={t("assistantMemory.injection.info")}
            label={t("assistantMemory.injection.infoLabel")}
          />
        </div>
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
