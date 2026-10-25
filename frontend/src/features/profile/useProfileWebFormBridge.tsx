// SPDX-License-Identifier: Apache-2.0
/**
 * 「网申资料」分页的接线（F6，从 ProfilePage 抽出以守住页面预算）。
 *
 * 网申草稿由 WebFormProfileWorkspace 自持（击键只重渲那一棵子树），页面只留**目录**
 * （提交时按它收窄字段）。保存仍走独立接口：资料表单与网申资料是两次提交，
 * 两次都成功才算「保存全部资料」成功（失败要如实说明存了一半）。
 */
import { App } from "antd";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { updateWebFormExtraProfile } from "../../api/webform";
import WebFormProfileWorkspace, {
  type WebFormProfileWorkspaceHandle,
} from "../../components/profile/WebFormProfileWorkspace";
import { t } from "../../i18n";
import type { WebFormExtraProfile } from "../../types";
import { useWebformParse } from "./useWebformParse";

interface Options {
  editing: boolean;
  saving: boolean;
  onDirty: () => void;
}

export type WebFormSubmitOutcome = "saved" | "skipped" | "failed";

export interface ProfileWebFormBridgeApi {
  extraSaving: boolean;
  content: ReactElement;
  webformTextModal: ReturnType<typeof useWebformParse>["modalProps"];
  openWebFormParse: () => void;
  submit: () => Promise<WebFormSubmitOutcome>;
  cancel: () => void;
}

export function useProfileWebFormBridge({
  editing,
  saving,
  onDirty,
}: Options): ProfileWebFormBridgeApi {
  const { message } = App.useApp();
  const [extraProfile, setExtraProfile] = useState<WebFormExtraProfile | null>(null);
  const [extraSaving, setExtraSaving] = useState(false);
  const workspaceRef = useRef<WebFormProfileWorkspaceHandle | null>(null);

  const handleCatalogLoaded = useCallback((profile: WebFormExtraProfile) => {
    setExtraProfile(profile);
  }, []);

  /** 自定义字段改名只改显示标签，保持 key 不变，避免已记住的值失去关联。 */
  const handleCatalogFieldLabelChange = useCallback((key: string, label: string) => {
    setExtraProfile((current) => {
      if (!current) return current;
      return {
        ...current,
        fields: current.fields.map((field) => (field.key === key ? { ...field, label } : field)),
      };
    });
  }, []);

  /** 删除交给「保存全部资料」统一提交；目录同步移除，提交白名单不会把它带回去。 */
  const handleCatalogFieldDelete = useCallback((key: string) => {
    setExtraProfile((current) => {
      if (!current) return current;
      const fields = current.fields.filter((field) => field.key !== key);
      const groups = current.groups.filter(
        (group) =>
          group !== t("profileLibrary.webform.customGroupName") ||
          fields.some((field) => field.group === group),
      );
      return { ...current, fields, groups };
    });
  }, []);

  const webformParse = useWebformParse({
    fields: extraProfile?.fields ?? [],
    applyRows: (rows) => workspaceRef.current?.applyParsedRows(rows),
  });

  const content = useMemo(
    () => (
      <WebFormProfileWorkspace
        ref={workspaceRef}
        editing={editing}
        saving={saving || extraSaving}
        onDirty={onDirty}
        onCatalogLoaded={handleCatalogLoaded}
        onCatalogFieldLabelChange={handleCatalogFieldLabelChange}
        onCatalogFieldDelete={handleCatalogFieldDelete}
      />
    ),
    [
      editing,
      extraSaving,
      handleCatalogFieldDelete,
      handleCatalogFieldLabelChange,
      handleCatalogLoaded,
      onDirty,
      saving,
    ],
  );

  const submit = useCallback(async (): Promise<WebFormSubmitOutcome> => {
    const draft = workspaceRef.current?.getDraft() ?? null;
    if (!extraProfile || !draft) return "skipped";
    setExtraSaving(true);
    try {
      const allowed = new Set(extraProfile.fields.map((field) => field.key));
      const payload: Record<string, string> = {};
      Object.entries(draft.values).forEach(([key, value]) => {
        if (allowed.has(key)) payload[key] = value;
      });
      const repeated = Object.fromEntries(
        draft.repeatedGroups.map((group) => [
          group.key,
          group.records.map((record) => ({ id: record.id, values: record.values })),
        ]),
      );
      const saved = await updateWebFormExtraProfile(payload, draft.details, repeated);
      setExtraProfile(saved);
      workspaceRef.current?.adoptSaved(saved);
      return "saved";
    } catch (err) {
      message.error(
        t("profileLibrary.save.webformFailed", {
          detail: err instanceof Error ? err.message : "-",
        }),
      );
      return "failed";
    } finally {
      setExtraSaving(false);
    }
  }, [extraProfile, message]);

  const cancel = useCallback(() => {
    workspaceRef.current?.cancel();
  }, []);

  return {
    extraSaving,
    content,
    webformTextModal: webformParse.modalProps,
    openWebFormParse: webformParse.openModal,
    submit,
    cancel,
  };
}
