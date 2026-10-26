// SPDX-License-Identifier: Apache-2.0
/**
 * 「我的资料 → 简历资料」页内的补充事实区块（A3）。
 *
 * 与旧资料表单的关系：**零耦合**。事实存独立表、走独立 CRUD（/api/profile/facts），
 * 不进入整页「保存全部资料」的 PUT——旧保存既不会清空新事实，新事实也不会改写旧字段。
 * 这就是计划 §8.2 要的隔离，本组件不 import 任何 profile 表单状态。
 *
 * 两项数据源各管各的：
 * - 事实列表 `useProfileFacts`；
 * - 字段设置 `useFactSchema`（隐藏默认字段 + 自定义字段定义）。
 * schema 加载失败时按"全部默认字段可见、无自定义字段"降级显示，并给一条可重试提示——
 * 新接口挂掉不应该让已经录好的事实不可用。
 *
 * 交互：新建/编辑/字段设置都是页面内视图切换（不用弹层）；删除是软删，提示"移入回收站"，
 * 因为本页拿不到回收站行的数字 id，所以不做 5 秒撤销按钮（见任务说明）。
 */
import { PlusOutlined, SettingOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Dropdown, Space, Tag, Typography } from "antd";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import EmptyState from "../../components/common/EmptyState";
import ErrorState from "../../components/common/ErrorState";
import LoadingBlock from "../../components/common/LoadingBlock";
import { PROFILE_FACTS_SECTION_KEY } from "../../components/profile/ProfileSectionConfig";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useToast } from "../../hooks/useToast";
import { FACT_KINDS, FACT_KIND_LABEL_KEYS } from "./constants";
import { fallbackKindSchema, fallbackSchema } from "./factFieldSchema";
import FactList from "./FactList";
import FieldSettingsView from "./FieldSettingsView";
import MaterialPickView from "./MaterialPickView";
import FactEditor from "./editors/FactEditor";
import type {
  FactCustomFieldDef,
  FactKind,
  FactPayload,
  ProfileFact,
  ProfileFactKindSchema,
  ProfileFactKindSchemaUpdate,
} from "./types";
import { useFactSchema } from "./useFactSchema";
import { useProfileFacts } from "./useProfileFacts";
import "./profile-facts.css";

type EditorState =
  | { mode: "create"; kind: FactKind; draft?: FactPayload }
  | { mode: "edit"; fact: ProfileFact }
  | { mode: "material" }
  | { mode: "settings" };

export default function ProfileFactsSection() {
  useLocale();
  const toast = useToast();
  const facts = useProfileFacts();
  const schemaState = useFactSchema();
  const [editor, setEditor] = useState<EditorState | null>(null);

  const effectiveSchema = useMemo(
    () => schemaState.schema ?? fallbackSchema(),
    [schemaState.schema],
  );
  const kindSchemas = useMemo(() => {
    const map = {} as Record<FactKind, ProfileFactKindSchema>;
    for (const kind of FACT_KINDS) {
      map[kind] =
        effectiveSchema.kinds.find((item) => item.kind === kind) ?? fallbackKindSchema(kind);
    }
    return map;
  }, [effectiveSchema]);
  const hiddenFieldsByKind = useMemo(() => {
    const map = {} as Record<FactKind, readonly string[]>;
    for (const kind of FACT_KINDS) map[kind] = kindSchemas[kind].hidden_fields;
    return map;
  }, [kindSchemas]);
  const customFieldDefsByKind = useMemo(() => {
    const map = {} as Record<FactKind, readonly FactCustomFieldDef[]>;
    for (const kind of FACT_KINDS) map[kind] = kindSchemas[kind].custom_fields;
    return map;
  }, [kindSchemas]);

  const openCreate = useCallback((kind: FactKind) => {
    setEditor({ mode: "create", kind });
  }, []);
  const closeEditor = useCallback(() => setEditor(null), []);

  const handleSave = async (kind: FactKind, payload: FactPayload) => {
    const label = t(FACT_KIND_LABEL_KEYS[editor?.mode === "edit" ? editor.fact.kind : kind]);
    if (editor?.mode === "edit") {
      await facts.update(editor.fact, payload);
    } else {
      await facts.create(kind, payload);
    }
    toast.success(t("profileFacts.toast.saved", { label }));
    setEditor(null);
  };

  const handleConflictRefresh = useCallback(() => {
    setEditor(null);
    void facts.reload();
  }, [facts]);

  const handleDelete = useCallback(
    async (fact: ProfileFact) => {
      const label = t(FACT_KIND_LABEL_KEYS[fact.kind]);
      try {
        await facts.remove(fact);
        toast.info(t("profileFacts.toast.deleted", { label }));
      } catch {
        toast.error(t("profileFacts.toast.deleteFailed", { label }));
      }
    },
    [facts, toast],
  );

  const handleSchemaSave = useCallback(
    async (kind: FactKind, input: ProfileFactKindSchemaUpdate) => {
      const updated = await schemaState.saveKind(kind, input);
      toast.success(t("profileFacts.settings.saved", { label: t(FACT_KIND_LABEL_KEYS[kind]) }));
      return updated;
    },
    [schemaState, toast],
  );

  const handleSchemaReset = useCallback(
    async (kind: FactKind, expectedRevision: number) => {
      const updated = await schemaState.resetKind(kind, expectedRevision);
      toast.success(t("profileFacts.settings.resetDone", { label: t(FACT_KIND_LABEL_KEYS[kind]) }));
      return updated;
    },
    [schemaState, toast],
  );

  const addMenu = {
    items: [
      ...FACT_KINDS.map((kind) => ({ key: kind, label: t(FACT_KIND_LABEL_KEYS[kind]) })),
      { type: "divider" as const },
      // A3：资料箱显式选入——只生成草稿，仍走编辑器核对后保存。
      { key: "from-material", label: t("profileFacts.material.open") },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "from-material") {
        setEditor({ mode: "material" });
        return;
      }
      openCreate(key as FactKind);
    },
  };

  let body: ReactNode;
  if (editor?.mode === "material") {
    body = (
      <MaterialPickView
        onPick={(kind, draft) => setEditor({ mode: "create", kind, draft })}
        onCancel={closeEditor}
      />
    );
  } else if (editor?.mode === "settings") {
    body = (
      <FieldSettingsView
        kindSchemas={kindSchemas}
        onSave={handleSchemaSave}
        onReset={handleSchemaReset}
        onRefresh={schemaState.reload}
        onBack={closeEditor}
      />
    );
  } else if (editor) {
    const draft = editor.mode === "create" ? editor.draft : undefined;
    body = (
      <FactEditor
        key={editor.mode === "edit" ? `edit-${editor.fact.fact_id}` : `create-${editor.kind}`}
        mode={editor.mode}
        initialKind={editor.mode === "edit" ? editor.fact.kind : editor.kind}
        fact={editor.mode === "edit" ? editor.fact : undefined}
        draft={draft}
        schemaByKind={kindSchemas}
        maxCustomFieldValueChars={effectiveSchema.max_custom_field_value_chars}
        onSave={handleSave}
        onCancel={closeEditor}
        onConflictRefresh={handleConflictRefresh}
      />
    );
  } else if ((facts.loading && facts.facts.length === 0) || schemaState.loading) {
    body = <LoadingBlock tip={t("profileFacts.section.loading")} />;
  } else if (facts.error) {
    body = (
      <ErrorState
        description={t("profileFacts.section.loadError", { detail: facts.error })}
        onRetry={() => void facts.reload()}
        retrying={facts.loading}
      />
    );
  } else if (facts.facts.length === 0) {
    body = (
      <EmptyState
        description={t("profileFacts.empty.description")}
        actionLabel={t("profileFacts.empty.action")}
        onAction={() => openCreate("publication")}
      />
    );
  } else {
    body = (
      <FactList
        facts={facts.facts}
        total={facts.total}
        loadingMore={facts.loadingMore}
        hiddenFieldsByKind={hiddenFieldsByKind}
        customFieldDefsByKind={customFieldDefsByKind}
        onEdit={(fact) => setEditor({ mode: "edit", fact })}
        onDelete={(fact) => void handleDelete(fact)}
        onLoadMore={() => void facts.loadMore()}
      />
    );
  }

  const busy = schemaState.loading || facts.loading;
  const showActions = !editor && !busy && !facts.error;
  const schemaWarning =
    !editor && !facts.error && schemaState.error && !schemaState.loading ? (
      <Alert
        type="warning"
        showIcon
        title={t("profileFacts.section.schemaWarning", { detail: schemaState.error })}
        action={
          <Button size="small" onClick={() => void schemaState.reload()}>
            {t("profileFacts.section.schemaRetry")}
          </Button>
        }
        style={{ marginBottom: 12 }}
      />
    ) : null;

  return (
    <Card
      size="small"
      className="profile-facts-section"
      id={`profile-section-${PROFILE_FACTS_SECTION_KEY}`}
      data-profile-section={PROFILE_FACTS_SECTION_KEY}
      title={
        <span className="profile-facts-head-title">
          <span className="profile-facts-head-name">{t("profileFacts.section.title")}</span>
          {facts.total > 0 ? (
            <Tag className="profile-facts-count">
              {t("profileFacts.section.count", { count: facts.total })}
            </Tag>
          ) : null}
        </span>
      }
      extra={
        showActions ? (
          <Space className="profile-facts-head-actions">
            {/* 编辑字段是次要入口（调整字段可见性），新建事实是主 CTA——两者共用
                默认高度、只靠 primary 区分层级。 */}
            <Button icon={<SettingOutlined />} onClick={() => setEditor({ mode: "settings" })}>
              {t("profileFacts.settings.open")}
            </Button>
            {facts.facts.length > 0 ? (
              <Dropdown menu={addMenu} trigger={["click"]}>
                <Button type="primary" icon={<PlusOutlined />}>
                  {t("profileFacts.add.button")}
                </Button>
              </Dropdown>
            ) : null}
          </Space>
        ) : null
      }
      style={{ marginTop: 16 }}
    >
      <Typography.Paragraph type="secondary" className="profile-facts-hint">
        {t("profileFacts.section.hint")}
      </Typography.Paragraph>
      {schemaWarning}
      {body}
    </Card>
  );
}
