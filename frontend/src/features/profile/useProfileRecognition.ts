// SPDX-License-Identifier: Apache-2.0
/**
 * 粘贴文本识别的状态机（F6，从 useProfilePage 抽出以守住单文件预算）。
 *
 * 两段式：识别结果**先落成校对清单**，用户点「确认填入」才写表单；取消则一个字都不动。
 * 识别只处理用户本次主动粘贴/上传的材料，不读旧库、不自动搬运旧数据。
 *
 * **新目录草稿（F4-BE 交付）**：/profile/parse-text 在旧响应上追加
 * `sections[{key,name,fields:[{field_id,label,value}]}]（可选 entries）`，由服务端
 * definition_catalog 产出。本文件只展示/校对这份草稿、按服务端下发的 field_id 写表单：
 * **不维护旧→新映射**，因此 CET4/CET6 等已移除字段不可能被识别复活（目录里没有它们）。
 */
import { App } from "antd";
import type { FormInstance } from "antd";
import { useRef, useState } from "react";
import type { ComponentProps } from "react";
import { isCancellation } from "../../api/client";
import { parseProfileText } from "../../api/profile";
import type ProfileTextModal from "../../components/profile/ProfileTextModal";
import type { RecognitionReviewRow } from "../../components/profile/RecognitionReviewList";
import { attachmentInputs, useRecognitionFiles } from "../../hooks/useRecognitionFiles";
import { t } from "../../i18n";
import type { ProfileTextParseResult, RecognitionSource } from "../../types";
import { makeTempEntryKey } from "../profile-library/ProfileEntrySection";
import type { ProfileEntryDraft, ProfileFormValues, WorkspaceOut } from "../profile-library/types";

interface Options {
  form: FormInstance<ProfileFormValues>;
  workspace: WorkspaceOut | null;
  onDirty: () => void;
  activateResumeWorkspace?: () => void;
}

export interface ProfileRecognitionApi {
  parsing: boolean;
  modal: ComponentProps<typeof ProfileTextModal>;
  openModal: () => void;
  close: () => void;
}

/** 服务端新目录草稿（与 backend/app/api/profile.py 的 ProfileDraft*Out 对齐）。 */
export interface ProfileDraftField {
  field_id: string;
  label: string;
  value: string;
}

export interface ProfileDraftEntry {
  fields: ProfileDraftField[];
}

export interface ProfileDraftSection {
  key: string;
  name: string;
  fields: ProfileDraftField[];
  /** 多条目分区解析出多条时出现，且**包含第一条**（见 profile_catalog_draft.py）。 */
  entries?: ProfileDraftEntry[] | null;
}

type ParseDraftResult = ProfileTextParseResult & { sections?: ProfileDraftSection[] };

const ROW_SEPARATOR = "::";

/** 草稿 → 校对清单：只出非空、且在当前工作区定义里可见的字段（hidden 不进清单）。 */
function rowsFromDraft(
  sections: ProfileDraftSection[],
  workspace: WorkspaceOut,
): RecognitionReviewRow[] {
  const byKey = new Map(workspace.sections.map((section) => [section.key, section]));
  const rows: RecognitionReviewRow[] = [];
  sections.forEach((section) => {
    const target = byKey.get(section.key);
    if (!target) return;
    const entries =
      section.entries && section.entries.length > 0
        ? section.entries
        : [{ fields: section.fields }];
    entries.forEach((entry, index) => {
      entry.fields.forEach((field) => {
        const value = (field.value ?? "").trim();
        if (!value) return;
        const definition = target.fields.find((item) => item.field_id === field.field_id);
        if (!definition || definition.hidden) return;
        rows.push({
          id: [section.key, String(index), field.field_id].join(ROW_SEPARATOR),
          section: section.name,
          label: field.label,
          value: field.value,
          multiline: definition.field_type === "multi_line",
        });
      });
    });
  });
  return rows;
}

interface RowGroup {
  sectionKey: string;
  entryIndex: number;
  values: Record<string, string>;
}

/** 校对清单 → 按 (分区, 条目序号) 分组的字段值；用户改过的值以清单为准。 */
function groupRows(rows: RecognitionReviewRow[]): RowGroup[] {
  const groups = new Map<string, RowGroup>();
  rows.forEach((row) => {
    const parts = row.id.split(ROW_SEPARATOR);
    if (parts.length !== 3) return;
    const [sectionKey, indexText, fieldId] = parts;
    const entryIndex = Number(indexText);
    if (!Number.isInteger(entryIndex) || entryIndex < 0) return;
    if (!(row.value ?? "").trim()) return;
    const key = sectionKey + ROW_SEPARATOR + String(entryIndex);
    const group = groups.get(key) ?? { sectionKey, entryIndex, values: {} };
    group.values[fieldId] = row.value;
    groups.set(key, group);
  });
  return [...groups.values()];
}

/** 把校对后的清单写进表单：单例合并进第 0 条；多条追加新草稿（与旧行为一致）。 */
function applyRowsToForm(
  form: FormInstance<ProfileFormValues>,
  workspace: WorkspaceOut,
  rows: RecognitionReviewRow[],
): number {
  const groups = groupRows(rows);
  let written = 0;
  const multi = new Map<string, RowGroup[]>();
  groups.forEach((group) => {
    const section = workspace.sections.find((item) => item.key === group.sectionKey);
    if (!section) return;
    const visible = Object.entries(group.values).filter(([fieldId]) => {
      const definition = section.fields.find((item) => item.field_id === fieldId);
      return Boolean(definition) && !definition?.hidden;
    });
    if (visible.length === 0) return;
    if (section.form === "singleton") {
      if (group.entryIndex !== 0) return;
      visible.forEach(([fieldId, value]) => {
        form.setFieldValue(["sections", section.key, 0, "values", fieldId], value);
        written += 1;
      });
      return;
    }
    multi.set(section.key, [...(multi.get(section.key) ?? []), group]);
  });
  multi.forEach((sectionGroups, sectionKey) => {
    const drafts: ProfileEntryDraft[] = [];
    sectionGroups
      .sort((left, right) => left.entryIndex - right.entryIndex)
      .forEach((group) => {
        const values = Object.fromEntries(
          Object.entries(group.values).filter(([, value]) => value.trim() !== ""),
        );
        if (Object.keys(values).length === 0) return;
        drafts.push({ entry_key: makeTempEntryKey(), values });
        written += 1;
      });
    if (drafts.length === 0) return;
    const current =
      (form.getFieldValue(["sections", sectionKey]) as ProfileEntryDraft[] | undefined) ?? [];
    form.setFieldValue(["sections", sectionKey], [...current, ...drafts]);
  });
  return written;
}

export function useProfileRecognition({
  form,
  workspace,
  onDirty,
  activateResumeWorkspace,
}: Options): ProfileRecognitionApi {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [recognized, setRecognized] = useState("");
  const [source, setSource] = useState<RecognitionSource | null>(null);
  const [rows, setRows] = useState<RecognitionReviewRow[] | null>(null);
  const { files, reading, addFiles, removeFile, clear, onPaste } = useRecognitionFiles();
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const reset = () => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setParsing(false);
    setUploadPercent(null);
    setRows(null);
    setWarnings([]);
    setRecognized("");
    setSource(null);
    clear();
  };

  const openModal = () => {
    setText("");
    reset();
    setOpen(true);
  };

  const close = () => {
    reset();
    setOpen(false);
  };

  const changeText = (value: string) => {
    setText(value);
    setRows(null);
    setWarnings([]);
    setRecognized("");
    setSource(null);
  };

  const cancelParse = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const parse = async () => {
    const content = text.trim();
    if (!content && files.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setParsing(true);
    const requestId = ++requestIdRef.current;
    setUploadPercent(0);
    try {
      const parsed = (await parseProfileText(
        {
          text: content,
          images: attachmentInputs(files, "image"),
          documents: attachmentInputs(files, "document"),
        },
        (percent) => {
          if (requestId === requestIdRef.current) setUploadPercent(percent);
        },
        controller.signal,
      )) as ParseDraftResult;
      if (requestId !== requestIdRef.current) return;
      setWarnings(parsed.warnings);
      setRecognized(parsed.recognized_text ?? "");
      setSource(parsed.parse_engine);
      // 只展示后端按目录产出的草稿；旧响应里多出来的字段一律不看（防止按旧名字对号入座）。
      setRows(workspace ? rowsFromDraft(parsed.sections ?? [], workspace) : []);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      if (!isCancellation(err)) {
        setRows(null);
        message.error(err instanceof Error ? err.message : t("profileLibrary.error.unknown"));
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setParsing(false);
        setUploadPercent(null);
      }
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const apply = () => {
    if (!workspace || !rows) return;
    const written = applyRowsToForm(form, workspace, rows);
    if (written === 0) {
      message.warning(t("profileLibrary.error.notFound"));
      return;
    }
    onDirty();
    activateResumeWorkspace?.();
    message.success(t("profileLibrary.save.success"));
    close();
  };

  const discard = () => {
    setRows(null);
    close();
  };

  const modal = {
    open,
    text,
    warnings,
    parsing,
    uploadPercent,
    recognizedText: recognized,
    recognitionSource: source,
    files,
    filesReading: reading,
    rows,
    onRowsChange: setRows,
    onApply: apply,
    onDiscard: discard,
    onCancelParse: cancelParse,
    onTextChange: changeText,
    onAddFiles: (incoming: File[]) => void addFiles(incoming),
    onRemoveFile: removeFile,
    onPasteFiles: onPaste,
    onClose: close,
    onParse: () => void parse(),
  } satisfies ComponentProps<typeof ProfileTextModal>;

  return { parsing, modal, openModal, close };
}
