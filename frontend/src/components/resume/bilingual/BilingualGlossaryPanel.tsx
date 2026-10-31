// SPDX-License-Identifier: Apache-2.0
/**
 * 术语表面板（W16 / v2 工作区的「术语表」页签）：加载 / 新增 / 编辑 / 软删。
 *
 * 术语表是**数据集级**资源，与简历文档结构无关，所以从旧工作区里抽成独立组件：
 * 工作区容器只负责版本与翻译流程，术语表的加载与撤销提示不再和它搅在一条 500 行文件里。
 *
 * 删除语义（AGENTS）：术语进回收站第 18 类，能恢复 → 直接执行 + Toast 5 秒撤销，
 * 不前置确认弹窗。
 */
import { useCallback, useEffect, useState } from "react";
import { App } from "antd";
import ErrorState from "../../common/ErrorState";
import LoadingBlock from "../../common/LoadingBlock";
import { useToast } from "../../../hooks/useToast";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { restoreTrashItem } from "../../../api/trash";
import { bt } from "../../../features/resume-bilingual/i18n";
import {
  createGlossaryTerm,
  deleteGlossaryTerm,
  listGlossaryTerms,
  updateGlossaryTerm,
} from "../../../features/resume-bilingual/api";
import { glossaryOutToTerm, termToCreatePayload } from "../../../features/resume-bilingual/real";
import type { GlossaryTerm } from "../../../features/resume-bilingual/types";
import GlossaryTable from "./GlossaryTable";

interface Props {
  /** 源语言（当前文档语言）：新建术语时补语言对。 */
  sourceLanguage: "zh-CN" | "en-US";
  /** 目标语言（对侧）。 */
  targetLanguage: "zh-CN" | "en-US";
  /** 只读（无 revision / 宿主禁用）：只展示，不提供增删改。 */
  readOnly?: boolean;
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "";
}

export default function BilingualGlossaryPanel({
  sourceLanguage,
  targetLanguage,
  readOnly = false,
}: Props) {
  useLocale();
  const { message } = App.useApp();
  const toast = useToast();
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listGlossaryTerms();
      setTerms(data.items.map(glossaryOutToTerm));
      setError(null);
    } catch (caught) {
      setError(errorText(caught) || bt("bilingual.glossary.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load, reloadToken]);

  const handleSave = async (term: GlossaryTerm) => {
    setSaving(true);
    try {
      if (term.id > 0) {
        await updateGlossaryTerm(term.id, {
          source_term: term.source_term,
          target_term: term.target_term,
          category: term.category,
          locked: term.locked,
          note: term.note,
        });
      } else {
        await createGlossaryTerm(termToCreatePayload(term, sourceLanguage, targetLanguage));
      }
      message.success(bt("bilingual.glossary.saved"));
      setReloadToken((value) => value + 1);
    } catch (caught) {
      message.error(errorText(caught) || bt("bilingual.candidate.failed"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (term: GlossaryTerm) => {
    try {
      await deleteGlossaryTerm(term.id);
      setReloadToken((value) => value + 1);
      toast.undo(bt("bilingual.glossary.deleted"), {
        label: t("toast.undo.label"),
        onClick: async () => {
          await restoreTrashItem("glossary_term", term.id);
          setReloadToken((value) => value + 1);
        },
      });
    } catch (caught) {
      message.error(errorText(caught) || bt("bilingual.glossary.deleteFailed"));
    }
  };

  if (error) {
    return (
      <ErrorState
        description={error}
        onRetry={() => setReloadToken((value) => value + 1)}
        retryLabel={bt("bilingual.workspace.retry")}
      />
    );
  }
  if (loading && terms.length === 0) {
    return <LoadingBlock tip={bt("bilingual.glossary.loading")} />;
  }
  return (
    <GlossaryTable
      terms={terms}
      saving={saving}
      onSaveTerm={readOnly ? undefined : (term) => void handleSave(term)}
      onDeleteTerm={readOnly ? undefined : (term) => void handleDelete(term)}
    />
  );
}
