// SPDX-License-Identifier: Apache-2.0
/**
 * 「表达资产库」容器（W17-FE 真实 API）：数据加载、增删改、收藏、插入、删除撤销。
 *
 * ## 为什么要有这一层
 *
 * `PhraseLibraryPanel` 是纯展示组件（不 import API）；本容器把 `usePhraseLibrary` 的数据
 * 与三个真实动作接上：
 * - **插入**：POST `/resume-phrases/{id}/insert`（后端生成新 object_id/point_id + 条件写），
 *   成功后把 `PhraseInsertOut` 交回宿主（宿主刷新编辑器/预览，并记为一步历史）；
 * - **收藏**：POST `/collect`（需要当前选中的 `data-resume-path`；没有选中就不显示入口）；
 * - **删除**：软删进回收站第 17 类，随后用 `toast.undo` 给 5 秒撤销（撤销调既有
 *   `restoreTrashItem("phrase", id)`）；
 * - **编辑**：正文有改动时先在弹窗里看词级 diff（更新先看差异），确认才 PATCH；
 * - **插入**：先展示"当前文本 → 将插入文本"的确认层，确认后才写库。
 *
 * 失败一律给错误 Toast，不假装成功；没有简历上下文时插入按钮禁用并说明原因。
 */
import { useState } from "react";
import { useToast } from "../../../hooks/useToast";
import { t } from "../../../i18n";
import { copyText } from "../../../utils/clipboard";
import { restoreTrashItem } from "../../../api/trash";
import { stripMarkers } from "../../resume-preview/richText";
import PhraseLibraryPanel from "./PhraseLibraryPanel";
import PhraseEditorModal from "./PhraseEditorModal";
import PhraseInsertPreviewModal from "./PhraseInsertPreviewModal";
import { at } from "../../../features/resume-assets/i18n";
import { usePhraseLibrary } from "../../../features/resume-assets/usePhraseLibrary";
import type {
  PhraseInsertOut,
  PhraseUpdatePayload,
  ResumePhrase,
} from "../../../features/resume-assets/types";

/** 插入目标：宿主告诉容器"插到哪一栏、哪一条、哪个位置"。 */
export interface PhraseInsertTarget {
  section: string;
  entryId?: string | null;
  pointIndex?: number | null;
}

interface Props {
  /** 当前打开的简历 id；空 = 没有插入上下文（按钮禁用）。 */
  resumeId?: number | null;
  /** 当前选中的要点路径（收藏入口用）；空 = 不显示收藏按钮。 */
  selectedPath?: string | null;
  /** 选中要点的当前文本（插入确认层里的"当前文本"）；缺省只展示新增。 */
  selectedText?: string | null;
  /** 插入目标；空 = 插入按钮禁用并说明原因。 */
  insertTarget?: PhraseInsertTarget | null;
  /**
   * 宿主有未保存草稿时为 true：插入会整份替换服务端内容，先把本地编辑保存掉。
   * 只锁插入，收藏/复制/删除不受影响。
   */
  insertLocked?: boolean;
  /** 宿主当前 revision（插入走条件写，409 时正文不改）。 */
  expectedRevision?: number | null;
  /** 插入成功：把新身份与保存结果交回宿主。 */
  onInserted?: (result: PhraseInsertOut) => void;
  className?: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "";
}

export default function PhraseLibraryContainer({
  resumeId = null,
  selectedPath = null,
  selectedText = null,
  insertTarget = null,
  insertLocked = false,
  expectedRevision = null,
  onInserted,
  className,
}: Props) {
  const toast = useToast();
  const library = usePhraseLibrary();
  const [lastInserted, setLastInserted] = useState<PhraseInsertOut | null>(null);
  const [pendingInsert, setPendingInsert] = useState<ResumePhrase | null>(null);
  const [editing, setEditing] = useState<ResumePhrase | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // 插入锁优先：宿主有未保存草稿时，插入会覆盖服务端内容，必须先保存。
  const canInsert = Boolean(resumeId && insertTarget && !insertLocked);
  const canCollect = Boolean(resumeId && selectedPath);

  const handleInsert = async (phrase: ResumePhrase) => {
    if (!resumeId || !insertTarget) return;
    try {
      const result = await library.insert(phrase.id, {
        resume_id: resumeId,
        section: insertTarget.section,
        entry_id: insertTarget.entryId ?? null,
        point_index: insertTarget.pointIndex ?? null,
        expected_revision: expectedRevision,
      });
      setLastInserted(result);
      onInserted?.(result);
      toast.success(at("assets.insert.done"));
    } catch (error) {
      toast.error(messageOf(error) || at("assets.insert.failed"));
    }
  };

  const requestInsert = (phrase: ResumePhrase) => {
    if (!canInsert) return;
    setPendingInsert(phrase);
  };

  const confirmInsert = async () => {
    if (!pendingInsert) return;
    const phrase = pendingInsert;
    setPendingInsert(null);
    await handleInsert(phrase);
  };

  const handleSaveEdit = async (payload: PhraseUpdatePayload) => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      await library.update(editing.id, payload);
      toast.success(at("assets.editor.saved"));
      setEditing(null);
    } catch (error) {
      toast.error(messageOf(error) || at("assets.editor.saveFailed"));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCollect = async () => {
    if (!resumeId || !selectedPath) return;
    try {
      await library.collect(resumeId, selectedPath);
      toast.success(at("assets.collect.done"));
    } catch (error) {
      toast.error(messageOf(error) || at("assets.collect.failed"));
    }
  };

  const handleCopy = async (phrase: ResumePhrase) => {
    const copied = await copyText(stripMarkers(phrase.text));
    if (copied) toast.success(at("assets.action.copied"));
    else toast.error(at("assets.action.copied"));
  };

  const handleDelete = async (phrase: ResumePhrase) => {
    try {
      await library.remove(phrase.id);
      toast.undo(at("assets.delete.done"), {
        label: t("toast.undo.label"),
        onClick: async () => {
          await restoreTrashItem("phrase", phrase.id);
          await library.reload();
        },
      });
    } catch (error) {
      toast.error(messageOf(error) || at("assets.delete.failed"));
    }
  };

  const resolveTargetError = (): string | undefined => {
    if (insertLocked) return at("assets.insert.locked");
    if (!resumeId) return at("assets.action.insertUnavailable");
    if (!insertTarget) return at("assets.insert.noTarget");
    return undefined;
  };

  return (
    <div className={className} data-phrase-library="1">
      <PhraseLibraryPanel
        phrases={library.phrases}
        loading={library.loading}
        error={library.error}
        retrying={library.loading}
        onRetry={() => void library.reload()}
        insertEnabled={canInsert}
        onInsert={requestInsert}
        onEdit={(phrase) => setEditing(phrase)}
        onRequestDelete={(phrase) => void handleDelete(phrase)}
        onCopy={(phrase) => void handleCopy(phrase)}
        onCollectCurrent={canCollect ? () => void handleCollect() : undefined}
      />
      {lastInserted ? (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--rf-text-secondary)" }}>
          {at("assets.insert.done")} ·{" "}
          {at("assets.insert.newObject", { id: lastInserted.inserted_object_id })}
        </div>
      ) : null}
      {resolveTargetError() ? (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--rf-text-secondary)" }}>
          {resolveTargetError()}
        </div>
      ) : null}
      {editing ? (
        <PhraseEditorModal
          key={editing.id}
          open
          phrase={editing}
          saving={savingEdit}
          onCancel={() => setEditing(null)}
          onSave={(payload) => void handleSaveEdit(payload)}
        />
      ) : null}
      {pendingInsert ? (
        <PhraseInsertPreviewModal
          open
          phrase={pendingInsert}
          targetLabel={
            insertTarget
              ? insertTarget.section + (insertTarget.entryId ? " · " + insertTarget.entryId : "")
              : ""
          }
          currentText={selectedText ?? ""}
          onCancel={() => setPendingInsert(null)}
          onConfirm={() => void confirmInsert()}
        />
      ) : null}
    </div>
  );
}
