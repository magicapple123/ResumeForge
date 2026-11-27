// SPDX-License-Identifier: Apache-2.0
/**
 * 面试「简历材料」下拉（#25 / T33）：把**本应用的简历**与**外部简历（上传的）**合并成
 * 一个分组下拉。
 *
 * 这一层现在只是 `useResumeRefSelect` 的**薄封装**：取数、防抖 300ms、请求序号、空态文案
 * 全部复用那一份实现（`useDebouncedRemoteSearch` 内核）。本文件不再出现 `setTimeout`
 * 或自增序号——两套防抖并存的分歧不会报错，只会表现为"某个下拉偶尔停在旧结果上"。
 *
 * 面试比通用选择器多三件事：
 *
 * 1. **内部简历按岗位域过滤**：只给当前岗位关联的 + 通用简历（别的岗位的简历面试官不会看）。
 * 2. **外部简历要正文**：`has_text === false` 的项在下拉里就禁用并写明原因与怎么办
 *    （扫描件进不了面试，事后弹 warning 等于让用户白选一次）。
 * 3. **选中外部简历 = 深链那一套**：正文落到「导入文件」这一侧，`resume_material` 带着它
 *    进提示词；`?externalResumeId=` 深链与下拉共用 `applyExternalResume`，两条路径永远一致。
 * 4. **外部组跨岗位可见**：只对命中当前岗位的项打「关联此岗位」标签，不过滤（方案 25D）。
 *
 * 值域统一为 `types/resumeRef` 的复合引用：`internal:12` / `external:7`。旧写法 `r:` / `e:`
 * 只在**读**的时候被接受（`decodeResumeRef`），这里不再产出。
 */
import { App } from "antd";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { getExternalResume } from "../api/externalResumes";
import type { ExternalResumeDetail } from "../api/externalResumes";
import { t } from "../i18n";
import type { InterviewMaterialExtract } from "../types";
import { decodeResumeRef, encodeResumeRef, type ResumeRef } from "../types/resumeRef";
import { useResumeRefSelect, type ResumeRefMeta } from "./useResumeRefSelect";

/**
 * 旧前缀常量（只作为读侧的兼容说明保留）。
 *
 * 新代码写值一律用 `internal:` / `external:`；这两个常量不再被任何写路径使用，留着是为了
 * 让"旧值长什么样"在代码里有一处可查（测试也据此钉住"旧值仍能解析"）。
 */
export const INTERNAL_RESUME_PREFIX = "r:";
export const EXTERNAL_RESUME_PREFIX = "e:";

export type ResumeSelectionKind = "internal" | "external";

export interface ResumeSelection {
  kind: ResumeSelectionKind;
  id: number;
}

/** 内部简历在下拉里的 value（新写法 `internal:12`）。 */
export function internalResumeValue(id: number): string {
  return encodeResumeRef({ kind: "internal", id });
}

/** 外部简历在下拉里的 value（新写法 `external:7`）。 */
export function externalResumeValue(id: number): string {
  return encodeResumeRef({ kind: "external", id });
}

/**
 * 解析下拉 value。新旧前缀都认（旧写法只进不出），裸 id 与脏值一律算"没选"——猜"裸 id
 * 是内部还是外部"猜错就等于把一份外部简历当成内部简历提交，那是脏数据的来源。
 */
export function parseResumeValue(raw: string | null | undefined): ResumeRef | null {
  return decodeResumeRef(raw);
}

/** 外部简历 → 开面试时随请求带上的材料（与深链预填的形状逐字一致）。 */
export function externalResumeMaterial(record: {
  name: string;
  text: string;
}): InterviewMaterialExtract {
  // `warnings: []` 与 `parser: "text"` 是刻意的：正文是上传那一刻提取好的文本，
  // 不是这一侧现场识别的；带上上传警告会让写端点（`extra="forbid"`）拒收。
  return { name: record.name, text: record.text, warnings: [], parser: "text" };
}

/** `applyExternalResume` 的落地动作：由调用方提供，函数本身只管顺序与判据。 */
export interface ApplyExternalResumeDeps {
  /** 切到「导入文件」这一侧（记录侧整条不渲染，校验规则随之消失）。 */
  useFileSource: () => void;
  /** 写入材料（并由调用方记住"这份材料来自外部简历"）。 */
  useFileMaterial: (material: InterviewMaterialExtract) => void;
  /** 清掉记录侧的选择：否则会"界面显示已选、提交时没有字段"。 */
  clearRecordValue: () => void;
  /** 成功提示。 */
  notifyApplied: (name: string) => void;
  /** 没有正文：不落任何状态，只提示怎么做。 */
  notifyNoText: () => void;
}

/**
 * 把一份外部简历落到「导入文件」这一侧——**深链与下拉共用的唯一实现**。
 *
 * 顺序是固定的：先判有没有正文，再切来源、写材料、清记录侧的值。清值这一步最容易被漏：
 * 不清的话表单里还留着上一次选的内部简历，用户看到的"已选"和真正提交的材料不是一回事。
 *
 * 返回是否真的应用了（`false` = 没有正文，只提示）。
 */
export function applyExternalResume(
  record: ExternalResumeDetail,
  deps: ApplyExternalResumeDeps,
): boolean {
  if (!record.has_text || record.text.trim().length === 0) {
    deps.notifyNoText();
    return false;
  }
  deps.useFileSource();
  deps.useFileMaterial(externalResumeMaterial(record));
  deps.clearRecordValue();
  deps.notifyApplied(record.name);
  return true;
}

/**
 * 把 `applyExternalResume` 接到当前表单与材料状态上，得到一个**引用稳定**的落地函数。
 *
 * 引用稳定不是洁癖：深链 effect 把它列在依赖里，而 deps 里多是内联箭头函数（每次渲染都
 * 是新的）。ref 在**提交后**同步（不能在渲染期写 ref），回调本身因此不变，那些 effect 才
 * 不会"一渲染就重跑 → 上一次请求被清理标记成 cancelled → 永远不预填"。
 */
export function useExternalResumeApplier(
  deps: Omit<ApplyExternalResumeDeps, "notifyApplied" | "notifyNoText"> & {
    /** 拉详情失败（外部简历可能已被删除）：退回"从记录选"，不阻断继续设置。 */
    onLoadFailed?: () => void;
  },
) {
  const { message } = App.useApp();
  const latest = useRef(deps);
  useEffect(() => {
    latest.current = deps;
  });

  const apply = useCallback(
    (record: ExternalResumeDetail) =>
      applyExternalResume(record, {
        useFileSource: () => latest.current.useFileSource(),
        useFileMaterial: (material) => latest.current.useFileMaterial(material),
        clearRecordValue: () => latest.current.clearRecordValue(),
        notifyApplied: (name) =>
          message.info(t("interviewPage.setup.external.prefilled", { name })),
        notifyNoText: () => message.warning(t("interviewPage.setup.external.noText")),
      }),
    [message],
  );

  const notifyFailed = useCallback(() => {
    latest.current.clearRecordValue();
    message.warning(t("interviewPage.setup.external.loadFailed"));
    latest.current.onLoadFailed?.();
  }, [message]);

  return { apply, notifyFailed };
}

/**
 * 深链 `?externalResumeId=`：正整数才认，其余按"没带参"处理（与 `parseLinkedJobId`
 * 同一口径）。这个参数由简历中心的「用于面试」生成，指向一条**只读快照**外部简历。
 */
export function parseExternalResumeId(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * 「当前材料」这一行该显示什么（#25）。
 *
 * 放在这里而不是组件里：选中外部简历后记录侧下拉是**空的**（材料落在"导入文件"那一侧），
 * 这行提示是选完之后唯一常驻的来源说明，措辞与判据都值得单独测。
 */
export function describeCurrentMaterial(params: {
  /** 简历材料这一侧现在的来源。 */
  source: "record" | "file";
  /** 记录侧的展示名（下拉里那个选中项）。 */
  recordLabel?: string;
  /** 文件侧的材料名。 */
  fileName?: string;
  /** 文件侧的材料从哪来：导入的文件，或外部简历的正文。 */
  fileOrigin: "file" | "external" | null;
}): string {
  const empty = t("interviewPage.setup.currentMaterial.empty");
  if (params.source === "record") {
    return params.recordLabel
      ? t("interviewPage.setup.currentMaterial.record", { name: params.recordLabel })
      : empty;
  }
  if (!params.fileName) return empty;
  return t(
    params.fileOrigin === "external"
      ? "interviewPage.setup.currentMaterial.external"
      : "interviewPage.setup.currentMaterial.file",
    { name: params.fileName },
  );
}

interface Params {
  /** 当前关联岗位：决定内部候选范围（外部简历保留跨岗位选择，只打标签）。 */
  jobId: number | null;
  /** 表单里当前的选择（复合值）。用来把选中项钉在下拉里。 */
  value: string | undefined;
  /** 选中一份有正文的外部简历：交给 `applyExternalResume`（与深链同一个函数）。 */
  onExternal: (record: ExternalResumeDetail) => void;
  /** 外部简历详情拉不到（可能已被删除）。 */
  onExternalFailed: () => void;
  /** 选择变化（`internal:12` / `external:7` / `undefined`）：写回表单。 */
  onSelect: (value: string | undefined) => void;
}

/**
 * 面试「简历材料」下拉：在统一选择器上补"岗位域 / 要正文 / 面试分组名"。
 *
 * 返回的 `selectProps` 直接展开给 antd `Select`（表单里的 `name="resumeId"` 仍由
 * `Form.Item` 注入 value，本 hook 负责选项、搜索与 onChange 的分派）。
 */
export function useInterviewResumeSelect({
  jobId,
  value,
  onExternal,
  onExternalFailed,
  onSelect,
}: Params) {
  // 外部项的说明：岗位命中只打标签（不过滤），没有正文再补一个短标记。
  const externalNote = useCallback(
    (item: ResumeRefMeta): string | null => {
      const parts: string[] = [];
      if (jobId !== null && item.jobId === jobId) parts.push(t("interviewPage.setup.resumeJobTag"));
      if (!item.hasText) parts.push(t("interviewPage.setup.resumeNoTextBadge"));
      return parts.length > 0 ? parts.join(" · ") : null;
    },
    [jobId],
  );

  const shared = useResumeRefSelect({
    jobId,
    // 外部组保留跨岗位选择，只对命中当前岗位的项打标签（方案 25D）：面试官读的是用户
    // 手里那份文件，不该因为归属岗位不同就把它藏起来。
    externalJobScope: false,
    // 面试要保留外部组：即使这次列表是空的，"外部简历（上传的）"也是这个来源唯一的入口。
    keepEmptyGroups: true,
    groupLabels: {
      internal: "interviewPage.setup.resumeGroup.internal",
      external: "interviewPage.setup.resumeGroup.external",
    },
    externalRequiresText: { hint: t("interviewPage.setup.resumeNoText") },
    externalNote,
  });

  const { ensure, reload } = shared;

  // 已选值保显示：换岗位 / 换关键词都会重拉候选，选中项不能退化成裸复合值。
  // `reload` 会清空「钉住」项（共享 hook 的约定：调用方紧接着 ensure 把它钉回来），
  // 所以这里包一层，保证重拉后已选值的文案还在。
  useEffect(() => {
    if (value) void ensure(value);
  }, [ensure, value]);

  const reloadWithSelection = useCallback(() => {
    reload();
    if (value) void ensure(value);
  }, [ensure, reload, value]);

  const handleChange = useCallback(
    (raw: string | undefined) => {
      const ref = decodeResumeRef(raw);
      if (!ref) {
        onSelect(undefined);
        return;
      }
      if (ref.kind === "internal") {
        onSelect(encodeResumeRef(ref));
        return;
      }
      void getExternalResume(ref.id)
        .then((record) => {
          // 先落地材料（没有正文时由 applier 提示"为什么 + 怎么办"），再记选择值。
          onExternal(record);
          if (record.has_text && record.text.trim().length > 0) onSelect(encodeResumeRef(ref));
        })
        .catch(() => onExternalFailed());
    },
    [onExternal, onExternalFailed, onSelect],
  );

  /** 下拉里是否存在"没有正文"的外部项（面试页据此常驻一行说明，不只靠悬停）。 */
  const hasTextlessExternal = useMemo(
    () =>
      shared.groups
        .find((group) => group.kind === "external")
        ?.options.some((option) => option.disabled) ?? false,
    [shared.groups],
  );

  const selectProps = {
    ...shared.selectProps,
    onChange: handleChange,
  } as const;

  return {
    selectProps,
    reload: reloadWithSelection,
    /** 已选值的纯文本名（「当前材料」用；查不到时由调用方降级）。 */
    labelFor: shared.textOfRef,
    hasTextlessExternal,
  };
}
