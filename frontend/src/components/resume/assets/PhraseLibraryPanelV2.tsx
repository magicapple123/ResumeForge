// SPDX-License-Identifier: Apache-2.0
/**
 * 表达资产页签（v2 制作台左栏）：资产库列表 + 增删改 + 插入到当前简历（服务端落库）。
 *
 * 与 v1 容器的差别只在**插入的出口**：后端 v2 已把资产插入落库并返回 v2 ResumeOut，
 * 宿主用 onInsertDocument(document, revision) 整份替换（进历史、触发重排）。组件本身
 * 不写 document（纯受控）；409 = 记录在别处更新 → 提示重新打开后重试。
 */
import { useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { useToast } from "../../../hooks/useToast";
import { copyText } from "../../../utils/clipboard";
import { stripMarkers } from "../../resume-preview/richText";
import { restoreTrashItem } from "../../../api/trash";
import { at } from "../../../features/resume-assets/i18n";
import { usePhraseLibrary } from "../../../features/resume-assets/usePhraseLibrary";
import type {
  PhraseInsertOut,
  PhraseUpdatePayload,
  ResumePhrase,
} from "../../../features/resume-assets/types";
import type { ResumeDocument } from "../../../types/resumeDocument";
import PhraseLibraryPanel from "./PhraseLibraryPanel";
import PhraseEditorModal from "./PhraseEditorModal";
import PhraseInsertPreviewModal from "./PhraseInsertPreviewModal";

/** 可被资产插入的 v1 分析视图分区（与后端 POINT_FIELDS 一致）。 */
const INSERT_SECTIONS = new Set([
  "education",
  "experience",
  "campus_experience",
  "projects",
  "publications",
  "research_projects",
  "patents",
  "credentials",
  "skills",
  "languages",
  "awards",
]);

function parseTarget(path: string | null | undefined): { section: string; entryId: string } | null {
  if (!path) return null;
  const parts = path.split(".");
  if (parts.length < 2 || !INSERT_SECTIONS.has(parts[0])) return null;
  return { section: parts[0], entryId: parts[1] };
}

function isConflict(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { status?: number }).status === 409
  );
}

interface ResumePayload {
  content?: ResumeDocument;
  revision?: number;
}

interface Props {
  resumeId: number;
  document: ResumeDocument;
  /** 版式（宿主重排用；本组件不读，保留在契约里与工作台一致）。 */
  layout: unknown;
  revision: number | null;
  selectedPath?: string | null;
  /** 插入成功：服务端已落库 → 宿主替换文档并重排。 */
  onInsertDocument: (document: ResumeDocument, revision: number) => void;
  /** 插入后的新 item 由宿主选中并高亮。 */
  onSelectPath?: (path: string) => void;
  onApplyDocument?: (document: ResumeDocument) => void;
  disabled?: boolean;
}

export default function PhraseLibraryPanelV2({
  resumeId,
  revision,
  selectedPath = null,
  onInsertDocument,
  onSelectPath,
  onApplyDocument,
  disabled = false,
}: Props) {
  useLocale();
  const toast = useToast();
  const library = usePhraseLibrary();
  const [editing, setEditing] = useState<ResumePhrase | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [pendingInsert, setPendingInsert] = useState<ResumePhrase | null>(null);
  const [inserting, setInserting] = useState(false);
  const target = parseTarget(selectedPath);
  const canInsert = !disabled && Boolean(resumeId) && target !== null;

  const confirmInsert = async () => {
    if (!pendingInsert || !target) return;
    const phrase = pendingInsert;
    setPendingInsert(null);
    setInserting(true);
    try {
      const result: PhraseInsertOut = await library.insert(phrase.id, {
        resume_id: resumeId,
        section: target.section,
        entry_id: target.entryId,
        expected_revision: revision,
      });
      const resume = result.resume as ResumePayload | null;
      if (resume?.content) onInsertDocument(resume.content, resume.revision ?? revision ?? 0);
      if (result.inserted_point_id) {
        onSelectPath?.(`${target.section}.${target.entryId}.${result.inserted_point_id}`);
      } else if (onApplyDocument) onApplyDocument({} as ResumeDocument);
      toast.success(at("assets.insert.done"));
    } catch (error) {
      toast.error(isConflict(error) ? at("assets.insert.conflict") : at("assets.insert.failed"));
    } finally {
      setInserting(false);
    }
  };

  const saveEdit = async (payload: PhraseUpdatePayload) => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      await library.update(editing.id, payload);
      toast.success(at("assets.editor.saved"));
      setEditing(null);
    } catch {
      toast.error(at("assets.editor.saveFailed"));
    } finally {
      setSavingEdit(false);
    }
  };

  const removePhrase = async (phrase: ResumePhrase) => {
    try {
      await library.remove(phrase.id);
      toast.undo(at("assets.delete.done"), {
        label: t("toast.undo.label"),
        onClick: async () => {
          await restoreTrashItem("phrase", phrase.id);
          await library.reload();
        },
      });
    } catch {
      toast.error(at("assets.delete.failed"));
    }
  };

  const collectCurrent = async () => {
    if (!selectedPath) return;
    try {
      await library.collect(resumeId, selectedPath);
      toast.success(at("assets.collect.done"));
    } catch {
      toast.error(at("assets.collect.failed"));
    }
  };

  return (
    <div data-phrase-library-v2="1">
      <PhraseLibraryPanel
        phrases={library.phrases}
        loading={library.loading}
        error={library.error}
        retrying={library.loading}
        onRetry={() => void library.reload()}
        insertEnabled={canInsert}
        onInsert={(phrase) => setPendingInsert(phrase)}
        onEdit={(phrase) => setEditing(phrase)}
        onRequestDelete={(phrase) => void removePhrase(phrase)}
        onCopy={(phrase) => void copyText(stripMarkers(phrase.text))}
        onCollectCurrent={selectedPath ? () => void collectCurrent() : undefined}
      />
      {canInsert ? null : (
        <div className="resume-assets-footnote">
          {disabled ? at("assets.insert.locked") : at("assets.insert.noTarget")}
        </div>
      )}
      {editing ? (
        <PhraseEditorModal
          key={editing.id}
          open
          phrase={editing}
          saving={savingEdit}
          onCancel={() => setEditing(null)}
          onSave={(payload) => void saveEdit(payload)}
        />
      ) : null}
      <PhraseInsertPreviewModal
        open={pendingInsert !== null}
        phrase={pendingInsert}
        targetLabel={target ? target.section + " · " + target.entryId : ""}
        inserting={inserting}
        onCancel={() => setPendingInsert(null)}
        onConfirm={() => void confirmInsert()}
      />
    </div>
  );
}
