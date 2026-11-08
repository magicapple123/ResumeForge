// SPDX-License-Identifier: Apache-2.0
/**
 * 设置 → 助手与 AI 行为 ·「求职偏好」卡（T14）。
 *
 * 偏好是**用户亲口设的约束**，不是资料/经历：这里只做"列出当前生效的版本 + 直接编辑"，
 * 写入路径与助手侧同一套服务（同 kind 旧 active → superseded；同值 no-op）。卡片本身不
 * 缓存编辑历史——撤销由后端按 has_previous 决定行上有没有按钮。
 *
 * 三态各自只有出口：LoadingBlock / EmptyState inline / ErrorState + 重试。
 */
import { Button, Card, Typography } from "antd";
import { useState } from "react";
import type { JobPreference, JobPreferenceKind } from "../../api/jobPreferences";
import EmptyState from "../../components/common/EmptyState";
import ErrorState from "../../components/common/ErrorState";
import LoadingBlock from "../../components/common/LoadingBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import JobPreferenceFormModal from "./JobPreferenceFormModal";
import JobPreferenceRow from "./JobPreferenceRow";
import { useJobPreferences } from "./useJobPreferences";
import "../../styles/job-preference.css";

/** 弹窗状态：null = 关闭；create = 新增；edit = 编辑某一条。 */
type EditorState = { mode: "create" } | { mode: "edit"; pref: JobPreference } | null;

export default function JobPreferenceCard() {
  useLocale();
  const { data, loading, error, reload, saving, create, update, remove, undo } =
    useJobPreferences();
  const [editor, setEditor] = useState<EditorState>(null);

  const items = data?.items ?? [];
  const catalog = data?.catalog ?? [];

  const submit = async (kind: JobPreferenceKind, value: unknown, note: string) => {
    const ok =
      editor?.mode === "edit"
        ? await update(editor.pref.pref_id, { value, note })
        : await create({ kind, value, note });
    if (ok) setEditor(null);
  };

  return (
    <Card
      title={t("jobPreference.title")}
      className="settings-card"
      extra={
        items.length > 0 ? (
          <Button
            size="small"
            onClick={() => setEditor({ mode: "create" })}
            data-testid="job-preference-add"
          >
            {t("jobPreference.action.add")}
          </Button>
        ) : undefined
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("jobPreference.intro")}
      </Typography.Paragraph>
      {loading && !data ? (
        <LoadingBlock />
      ) : error && !data ? (
        <ErrorState
          description={error || t("jobPreference.error.load")}
          onRetry={() => void reload()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          inline
          description={t("jobPreference.empty")}
          actionLabel={t("jobPreference.action.add")}
          onAction={() => setEditor({ mode: "create" })}
        />
      ) : (
        <ul className="job-preference-list" aria-label={t("jobPreference.title")}>
          {items.map((pref) => (
            <JobPreferenceRow
              key={pref.pref_id}
              pref={pref}
              saving={saving}
              onEdit={(target) => setEditor({ mode: "edit", pref: target })}
              onUndo={(target) => void undo(target)}
              onDelete={(target) => void remove(target)}
            />
          ))}
        </ul>
      )}
      {editor ? (
        <JobPreferenceFormModal
          initial={editor.mode === "edit" ? editor.pref : null}
          catalog={catalog}
          saving={saving}
          onCancel={() => setEditor(null)}
          onSubmit={submit}
        />
      ) : null}
    </Card>
  );
}
