// SPDX-License-Identifier: Apache-2.0
/**
 * 面试「简历材料」下拉（#25）：把**本应用的简历**与**外部简历（上传的）**合并成一个分组下拉。
 *
 * 为什么需要它：`?externalResumeId=` 深链早就支持把外部简历预填进「导入文件」这一侧，
 * 但下拉只查内部简历表，用户在下拉里根本看不到外部简历——能力存在、入口不可发现。
 *
 * 四条口径（方案详册 #25）：
 * 1. **两个数据源合并、分组**：内部走 `listResumes({ job_id, include_general })`，外部走
 *    `listExternalResumes({ keyword })`。该端点**没有 `job_id` 参数**，所以外部组不按岗位
 *    过滤，只对 `job_id === 当前岗位` 的条目打一个「关联此岗位」标签（只标记，不过滤）。
 * 2. **value 带前缀**：`r:<id>` / `e:<id>`。前缀就是分派依据——同一次 `onChange` 里两种来源
 *    要做的事完全不同（内部只写表单，外部要落材料）。
 * 3. **选中外部简历 = 深链那一套**：统一交给 `applyExternalResume`。两条路径共用同一个函数，
 *    否则迟早有一处漏清 `resumeId`，出现"显示已选、提交 undefined"的脏状态。
 * 4. **没有正文的外部简历在下拉里就禁用**：`has_text === false` 时选中也进不了面试（提示词
 *    要的是正文）。事后弹 warning 等于让用户白做一次选择动作。
 *
 * 两件容易被漏掉的事：
 * - **已选值的显示**：表单里存的是 `r:<id>`，而搜索结果随时会被下一次关键词替换掉。这里用
 *   一份 `pinned` 缓存把当前选中项单独钉住（`reload()` 之后同样有效），否则切一次关键词、
 *   或换岗位重载候选，下拉框就退化成显示原始的 `r:12`。
 * - **外部列表失败不能连坐**：外部简历只是"多一个来源"，`GET /api/external-resumes` 挂了就
 *   让那一组留空，内部简历照常可选（下拉不能因为可选的第二来源报错而整体不可用）。
 *
 * 文案在渲染期求值：`useLocale()` 让本 hook 在切语言后重算分组名，缓存里只放原始数据。
 */
import { App } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getExternalResume, listExternalResumes } from "../api/externalResumes";
import type { ExternalResumeDetail, ExternalResumeItem } from "../api/externalResumes";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import type { InterviewMaterialExtract } from "../types";
import { useResumeSearchSelectForJobOrGeneral } from "./remoteSearchOptions";

/** 下拉 value 的前缀：`r:` = 本应用的简历（内部表），`e:` = 外部简历（上传的快照）。 */
export const INTERNAL_RESUME_PREFIX = "r:";
export const EXTERNAL_RESUME_PREFIX = "e:";

/** 外部简历搜索每页条数（与内部简历的远程搜索同一档）。 */
const EXTERNAL_PAGE_SIZE = 50;

/** 与 `useRemoteSearchSelect` 保持同一个防抖口径，两组的搜索手感才一致。 */
const SEARCH_DEBOUNCE_MS = 300;

export type ResumeSelectionKind = "internal" | "external";

export interface ResumeSelection {
  kind: ResumeSelectionKind;
  id: number;
}

/** 内部简历在下拉里的 value（`r:12`）。 */
export function internalResumeValue(id: number): string {
  return `${INTERNAL_RESUME_PREFIX}${id}`;
}

/** 外部简历在下拉里的 value（`e:7`）。 */
export function externalResumeValue(id: number): string {
  return `${EXTERNAL_RESUME_PREFIX}${id}`;
}

/**
 * 解析下拉 value。**只认带前缀的正整数**：不猜"裸 id"是内部还是外部——猜错就等于把一份
 * 外部简历当成内部简历提交，那是脏数据的来源。
 */
export function parseResumeValue(raw: string | null | undefined): ResumeSelection | null {
  if (!raw) return null;
  const match = /^([re]):(\d+)$/.exec(raw);
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { kind: match[1] === "r" ? "internal" : "external", id };
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

/** 合并后的下拉项：`value` 是 `r:` / `e:` 前缀串，其余字段直接交给 antd。 */
export interface InterviewResumeOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** 禁用原因的悬停提示（原生 title）。 */
  title?: string;
}

export interface InterviewResumeGroup {
  label: string;
  options: InterviewResumeOption[];
}

/** 外部简历的展示名：名字 + （可选）岗位标签 + 无正文标记。 */
function externalResumeLabel(item: ExternalResumeItem, jobId: number | null): string {
  const parts = [item.name];
  // 只标记不过滤：外部简历没有按岗位查询的口径，全量给出来更好用。
  if (jobId !== null && item.job_id === jobId) parts.push(t("interviewPage.setup.resumeJobTag"));
  if (!item.has_text) parts.push(t("interviewPage.setup.resumeNoTextBadge"));
  return parts.join(" · ");
}

interface Params {
  /** 当前关联岗位：决定内部候选范围，也决定外部组里打不打「关联此岗位」标签。 */
  jobId: number | null;
  /** 表单里当前的选择（`r:<id>` / undefined）。只用来把选中项钉在下拉里。 */
  value: string | undefined;
  /** 选中一份外部简历：交给 `applyExternalResume`（与深链同一个函数）。 */
  onExternal: (record: ExternalResumeDetail) => void;
  /** 外部简历详情拉不到（可能已被删除）。 */
  onExternalFailed: () => void;
  /** 记录侧选中 / 清空时写回表单。 */
  onSelectInternal: (value: string | undefined) => void;
}

/**
 * 面试「简历材料」下拉：两路合并 + 分组 + 按前缀分派。
 *
 * 返回的 `selectProps` 直接展开给 antd `Select`（表单里的 `name="resumeId"` 仍由
 * `Form.Item` 注入 value，本 hook 只提供选项、搜索与 onChange 的分派）。
 */
export function useInterviewResumeSelect({
  jobId,
  value,
  onExternal,
  onExternalFailed,
  onSelectInternal,
}: Params) {
  // 订阅语言：分组名与无正文标记都是渲染期 `t()` 求值的。
  const locale = useLocale();
  const internal = useResumeSearchSelectForJobOrGeneral(jobId);

  const [externalItems, setExternalItems] = useState<ExternalResumeItem[]>([]);
  const [externalLoading, setExternalLoading] = useState(false);
  const externalSeqRef = useRef(0);
  const externalTimerRef = useRef<number | null>(null);
  const [pinned, setPinned] = useState<Record<string, InterviewResumeOption>>({});
  const ensuredRef = useRef(new Set<string>());

  const pinOption = useCallback((option: InterviewResumeOption) => {
    // 返回同一个对象时 React 会跳过重渲染：这个 setter 因此可以安全地被每渲染一次的
    // effect 调用（不会打转）。
    setPinned((previous) =>
      previous[option.value] ? previous : { ...previous, [option.value]: option },
    );
  }, []);

  const runExternalSearch = useCallback(async (keyword: string) => {
    const requestId = ++externalSeqRef.current;
    setExternalLoading(true);
    try {
      const page = await listExternalResumes({
        keyword: keyword || undefined,
        page_size: EXTERNAL_PAGE_SIZE,
      });
      if (requestId !== externalSeqRef.current) return;
      setExternalItems(page.items);
    } catch {
      // 见文件头「外部列表失败不能连坐」：整组留空，内部简历照常可选。
      if (requestId !== externalSeqRef.current) return;
      setExternalItems([]);
    } finally {
      if (requestId === externalSeqRef.current) setExternalLoading(false);
    }
  }, []);

  const searchExternal = useCallback(
    (keyword: string) => {
      if (externalTimerRef.current !== null) window.clearTimeout(externalTimerRef.current);
      externalTimerRef.current = window.setTimeout(() => {
        void runExternalSearch(keyword.trim());
      }, SEARCH_DEBOUNCE_MS);
    },
    [runExternalSearch],
  );

  // 卸载时清掉还没触发的防抖计时器（与 `useRemoteSearchSelect` 同一口径）。
  useEffect(
    () => () => {
      if (externalTimerRef.current !== null) window.clearTimeout(externalTimerRef.current);
    },
    [],
  );

  /**
   * 已选值保显示：表单里存的是 `r:<id>`，而候选里未必还有它（换岗位、换关键词都会重拉）。
   * 按 id 回查一次并钉住，`reload()` 之后同样有效。
   *
   * 这里**不设 cancelled 标记**（与其它 effect 不同）：`internal` 每次渲染都是新对象，
   * 这个 effect 会跟着重跑，用清理标记取消的话，回查刚落地就被下一次渲染取消掉，钉住的
   * 文案永远留不下来。用 `ensuredRef` 去重 + `pinOption` 的"已有就不改"兜住，重复执行无害。
   */
  useEffect(() => {
    const parsed = parseResumeValue(value);
    if (!value || parsed?.kind !== "internal" || ensuredRef.current.has(value)) return;
    ensuredRef.current.add(value);
    void internal.ensure(parsed.id).then((option) => {
      if (option) pinOption({ value, label: option.label });
    });
  }, [value, internal, pinOption]);

  const groups = useMemo<InterviewResumeGroup[]>(() => {
    // 语言进依赖（`void locale`）：分组名是渲染期求值的，不订阅就不会重算。
    void locale;
    const internalOptions: InterviewResumeOption[] = internal.options.map((option) => ({
      value: internalResumeValue(option.value),
      label: option.label,
    }));
    const known = new Set(internalOptions.map((option) => option.value));
    for (const option of Object.values(pinned)) {
      if (!known.has(option.value)) internalOptions.unshift(option);
    }
    const externalOptions: InterviewResumeOption[] = externalItems.map((item) => ({
      value: externalResumeValue(item.id),
      label: externalResumeLabel(item, jobId),
      // 没有正文就禁用：不是"能选但会报错"，而是根本选不到（方案 25C）。
      disabled: item.has_text ? undefined : true,
      title: item.has_text ? undefined : t("interviewPage.setup.resumeNoText"),
    }));
    // 空组保留：一组"外部简历（上传的）"即使暂时是空的，也是这个来源唯一的可发现入口。
    return [
      { label: t("interviewPage.setup.resumeGroup.internal"), options: internalOptions },
      { label: t("interviewPage.setup.resumeGroup.external"), options: externalOptions },
    ];
  }, [internal.options, externalItems, jobId, locale, pinned]);

  /** 按前缀分派：内部只写表单；外部先取正文再交给共用的落地函数。 */
  const handleChange = useCallback(
    (raw: string | undefined) => {
      const parsed = parseResumeValue(raw);
      if (!parsed) {
        // allowClear 给的是 undefined；认不出的脏值同样按"没选"处理。
        onSelectInternal(undefined);
        return;
      }
      if (parsed.kind === "internal") {
        onSelectInternal(internalResumeValue(parsed.id));
        return;
      }
      void getExternalResume(parsed.id)
        .then((record) => onExternal(record))
        .catch(() => onExternalFailed());
    },
    [onExternal, onExternalFailed, onSelectInternal],
  );

  const onSearch = useCallback(
    (keyword: string) => {
      internal.selectProps.onSearch(keyword);
      searchExternal(keyword);
    },
    [internal.selectProps, searchExternal],
  );

  /** 重载候选：内部跟随岗位、外部跟随关键词（外部组不随岗位变）。已选项由 `pinned` 保住。 */
  const reload = useCallback(() => {
    internal.reload();
    void runExternalSearch("");
  }, [internal, runExternalSearch]);

  /** 当前选中项在候选里的展示文案（「当前材料」用；查不到时由调用方降级）。 */
  const labelFor = (raw: string | undefined): string | undefined => {
    if (!raw) return undefined;
    const cached = pinned[raw]?.label;
    if (cached) return cached;
    const match = internal.options.find((option) => internalResumeValue(option.value) === raw);
    return match?.label;
  };

  const selectProps = {
    showSearch: true,
    filterOption: false,
    onSearch,
    onChange: handleChange,
    loading: internal.selectProps.loading || externalLoading,
    options: groups,
    // 空态文案沿用内部那一套（"没有结果"对两组是同一句话，不另写一份）。
    notFoundContent: internal.selectProps.notFoundContent,
  } as const;

  return { selectProps, reload, labelFor };
}
