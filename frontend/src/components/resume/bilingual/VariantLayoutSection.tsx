// SPDX-License-Identifier: Apache-2.0
/**
 * W16 变体独立排版的容器：取 export-input 的有效排版 → 编辑 → PATCH layout。
 *
 * 数据源单一：`GET /variants/{id}/export-input`（layout + layout_source），不自己拼
 * render_context 的"看起来像排版"字段；写回只发 layout 覆盖，null = 恢复继承。
 */
import { App } from "antd";
import { useCallback, useEffect, useState } from "react";
import ErrorState from "../../common/ErrorState";
import LoadingBlock from "../../common/LoadingBlock";
import { bt } from "../../../features/resume-bilingual/i18n";
import { useLocale } from "../../../i18n/i18nContext";
import {
  fetchVariantExportInput,
  patchVariantLayout,
  type VariantDetailOut,
  type VariantExportInputOut,
} from "../../../features/resume-bilingual/api";
import {
  layoutIsVariantOwned,
  sameVariantLayout,
  variantLayoutFieldsFrom,
  variantLayoutPatch,
  type VariantLayoutFields,
} from "../../../features/resume-bilingual/variantLayout";
import VariantLayoutEditor from "./VariantLayoutEditor";

interface Props {
  resumeId: number;
  variant: VariantDetailOut;
  /** 排版保存成功（宿主可刷新列表的 has_layout 标记）。 */
  onChanged?: (variant: VariantDetailOut) => void;
}

export default function VariantLayoutSection({ resumeId, variant, onChanged }: Props) {
  useLocale();
  const { message } = App.useApp();
  const [input, setInput] = useState<VariantExportInputOut | null>(null);
  const [fields, setFields] = useState<VariantLayoutFields>(() =>
    variantLayoutFieldsFrom(variant.layout, {
      template: String(variant.render_context?.template ?? ""),
    }),
  );
  const [saved, setSaved] = useState<VariantLayoutFields>(fields);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchVariantExportInput(resumeId, variant.id);
      setInput(next);
      const fallback = { template: String(variant.render_context?.template ?? "") };
      const resolved = variantLayoutFieldsFrom(next.layout, fallback);
      setFields(resolved);
      setSaved(resolved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "");
    } finally {
      setLoading(false);
    }
  }, [resumeId, variant.id, variant.render_context]);

  // effect 只负责"开始取数"：setState 放进 async 回调（避免同步级联渲染告警）。
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load, tick]);

  const save = useCallback(
    async (layout: Record<string, unknown> | null) => {
      setSaving(true);
      try {
        const updated = await patchVariantLayout(resumeId, variant.id, { layout });
        onChanged?.(updated);
        message.success(bt("bilingual.layout.saved"));
        setTick((value) => value + 1);
      } catch (caught) {
        message.error(
          caught instanceof Error && caught.message
            ? caught.message
            : bt("bilingual.layout.failed"),
        );
      } finally {
        setSaving(false);
      }
    },
    [message, onChanged, resumeId, variant.id],
  );

  if (error) {
    return (
      <ErrorState
        description={error}
        onRetry={() => setTick((value) => value + 1)}
        retryLabel={bt("bilingual.layout.retry")}
      />
    );
  }
  if (loading && input === null) {
    return <LoadingBlock tip={bt("bilingual.layout.loading")} />;
  }
  const inherited = !layoutIsVariantOwned(input?.layout_source);
  return (
    <VariantLayoutEditor
      fields={fields}
      inherited={inherited}
      dirty={!sameVariantLayout(fields, saved)}
      saving={saving}
      onChange={setFields}
      onSave={() => void save(variantLayoutPatch(fields))}
      onResetInherit={() => void save(null)}
    />
  );
}
