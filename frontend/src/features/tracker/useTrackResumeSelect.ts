// SPDX-License-Identifier: Apache-2.0
/**
 * 进度表单「使用的简历」选择器（T6）：**一个下拉、两组选项、复合值**。
 *
 * 为什么不复用共享的 `useRemoteSearchSelect`：那个 hook 的值域是 `number`（单表 id），
 * 而这里要同时表达"内部简历"与"外部简历"两种来源——`resume_record` 与 `external_resume`
 * 是两张表，id 各自从 1 开始，**会撞号**。用裸数字当值的话，`3` 可能指内部第 3 份、
 * 也可能指外部第 3 份，保存时拆错字段就是把"投的是哪一版"记成别人。所以值域是复合串
 * `internal:3` / `external:3`（解析见 :func:`parseResumeRef`）。
 *
 * 另外三个与共享 hook 不同的地方：
 *
 * 1. **一次搜索并行拉两张表**（`Promise.allSettled`）：一路失败**不能**把整个下拉清空
 *    ——外部简历接口挂了不该让用户连内部简历都选不了；
 * 2. **分组输出**：`内部简历` / `外部简历` 两组，空组不渲染（一组都没有时不画一个空标题）；
 * 3. **`ensure(value, fallbackTitle)`**：编辑旧记录时按 id 回查已选值，保证下拉里显示的是
 *    名字而不是 `external:3`；404（简历已删）降级成 `fallbackTitle +（已删除）`。
 *
 * 换岗位**不自动替用户清空或改选**：值原样保留，只是给"不属于当前岗位"的那些 label
 * 追加一句说明（:func:`useTrackResumeSelect` 的 `notInJob` 标注）。静默改选会把错误版本
 * 写进投递记录，而这条记录的全部用途就是回答"我投的是哪一版"。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getExternalResume, listExternalResumes } from "../../api/externalResumes";
import { getResume, listResumes } from "../../api/resumes";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 下拉搜索的每页条数：搜索结果够扫一眼，继续缩范围靠输入关键词。 */
const SELECT_PAGE_SIZE = 50;
/** 与共享 hook 一致：输入每个字符都打请求会把本地后端打得很难看。 */
const DEBOUNCE_MS = 300;

export const RESUME_REF_INTERNAL = "internal";
export const RESUME_REF_EXTERNAL = "external";
export type ResumeRefKind = typeof RESUME_REF_INTERNAL | typeof RESUME_REF_EXTERNAL;

const KINDS: readonly ResumeRefKind[] = [RESUME_REF_INTERNAL, RESUME_REF_EXTERNAL];

/** 解析后的复合值：`internal:3` → `{ kind: "internal", id: 3 }`。 */
export interface ParsedResumeRef {
  kind: ResumeRefKind;
  id: number;
}

/** 下拉里的一个选项：`value` 是复合串，`label` 是渲染期求值的展示文案。 */
export interface TrackResumeOption {
  value: string;
  label: string;
}

/** antd `Select` 的分组选项。 */
export interface TrackResumeGroup {
  label: string;
  options: TrackResumeOption[];
}

/** 选项背后的原始数据（缓存里只放它，展示文案到渲染期再生成）。 */
interface RawItem {
  kind: ResumeRefKind;
  id: number;
  /** 内部简历的 `title` / 外部简历的 `name`；空串走 `简历 #id` 兜底。 */
  title: string;
  jobId: number | null;
  /** 回查 404：这条关联指向的记录已经不在（回收站里也看不到）。 */
  missing: boolean;
}

type Items = Record<ResumeRefKind, RawItem[]>;

const EMPTY_ITEMS: Items = { internal: [], external: [] };

/** 把 `internal:3` / `external:3` 拆成 `{kind, id}`；任何不合法的串一律 `null`（不抛）。 */
export function parseResumeRef(value: string | null | undefined): ParsedResumeRef | null {
  const text = (value ?? "").trim();
  const separator = text.indexOf(":");
  if (separator <= 0) return null;
  const kind = text.slice(0, separator);
  if (!KINDS.includes(kind as ResumeRefKind)) return null;
  const idText = text.slice(separator + 1);
  // 只认纯数字：`internal:3x` / `internal:-1` / `internal:3.5` 都不是合法 id。
  if (!/^\d+$/.test(idText)) return null;
  const id = Number(idText);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { kind: kind as ResumeRefKind, id };
}

/** 反向拼装：`("external", 3)` → `external:3`。 */
export function formatResumeRef(kind: ResumeRefKind, id: number): string {
  return `${kind}:${id}`;
}

/**
 * 一条进度记录的复合值：外部优先（两字段互斥，后端 422 守着），都没有则 `null`。
 *
 * 「都没有」是合法状态：表单里清空下拉 = 两个关联字段都置 null，后端保留标题快照。
 */
export function trackResumeRef(track: {
  resume_id: number | null;
  external_resume_id: number | null;
}): string | null {
  if (track.external_resume_id != null) {
    return formatResumeRef(RESUME_REF_EXTERNAL, track.external_resume_id);
  }
  if (track.resume_id != null) return formatResumeRef(RESUME_REF_INTERNAL, track.resume_id);
  return null;
}

/** 选项文案：名字 → 兜底名 →（外部）/（不属于当前岗位）/（已删除）标注。 */
function optionLabel(item: RawItem, jobId: number | null): string {
  const base = item.title.trim() || t("hooksUi.option.resumeFallback", { id: item.id });
  if (item.missing) {
    // 已删除时不知道它原来属于哪个岗位，所以只标注"已删除"，不猜岗位。
    return `${base}${t("trackerForm.resume.deleted")}`;
  }
  // 换了岗位之后仍保留已选值：不属于「本岗位 + 通用」的，如实说明，不改选。
  if (jobId != null && item.jobId != null && item.jobId !== jobId) {
    return `${base}${t("trackerForm.resume.notInJob")}`;
  }
  return base;
}

function internalItem(resume: { id: number; title: string; job_id: number | null }): RawItem {
  return {
    kind: RESUME_REF_INTERNAL,
    id: resume.id,
    title: resume.title ?? "",
    jobId: resume.job_id,
    missing: false,
  };
}

function externalItem(resume: { id: number; name: string; job_id: number | null }): RawItem {
  return {
    kind: RESUME_REF_EXTERNAL,
    id: resume.id,
    title: resume.name ?? "",
    jobId: resume.job_id,
    missing: false,
  };
}

/**
 * 进度表单的简历选择器。
 *
 * @param jobId 当前表单里选中的岗位；`null` = 未选岗位，候选退回**全库**（与整改前一致）。
 */
export function useTrackResumeSelect(jobId: number | null) {
  // 订阅语言：`optionLabel` 用的是模块级 `t()`，切语言后必须重算文案。
  const locale = useLocale();
  const [items, setItemsState] = useState<Items>(EMPTY_ITEMS);
  const [loading, setLoading] = useState(false);
  // ref 与 state 同步维护：`ensure` 需要在异步回调里读"当前已有的选项"，
  // 只靠 state 会读到闭包里的旧数组，同一份简历会被反复回查。
  const itemsRef = useRef<Items>(EMPTY_ITEMS);
  // 「钉住」的选项：`ensure` 回查到的已选值（含 404 降级出来的"已删除"项）。
  // 为什么需要它：`reload()` 的搜索结果是**整体替换**式更新，如果一次搜索的响应
  // 在 `ensure` 之后落地，就会把刚并入的已删除项冲掉，下拉里只剩裸值 `external:99`。
  // 换岗位时也要保留已选值（只改标注），所以这些项一旦钉住就跨搜索存活。
  const pinnedRef = useRef<Items>({ internal: [], external: [] });
  const requestSeqRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  /** 合并搜索结果与已钉住的已选项：结果在前，钉住项按 id 去重后补在后面。 */
  const withPinned = useCallback((kind: ResumeRefKind, listed: RawItem[]): RawItem[] => {
    const pinned = pinnedRef.current[kind];
    if (pinned.length === 0) return listed;
    const seen = new Set(listed.map((item) => item.id));
    const extras = pinned.filter((item) => !seen.has(item.id));
    return extras.length === 0 ? listed : [...listed, ...extras];
  }, []);

  const setItems = useCallback((updater: (previous: Items) => Items) => {
    const next = updater(itemsRef.current);
    itemsRef.current = next;
    setItemsState(next);
  }, []);

  const mergeItem = useCallback(
    (item: RawItem) => {
      // 先钉住：此后任何一次搜索响应落地，`withPinned` 都会把它补回去。
      if (!pinnedRef.current[item.kind].some((existing) => existing.id === item.id)) {
        pinnedRef.current = {
          ...pinnedRef.current,
          [item.kind]: [...pinnedRef.current[item.kind], item],
        };
      }
      setItems((previous) =>
        previous[item.kind].some((existing) => existing.id === item.id)
          ? previous
          : { ...previous, [item.kind]: [item, ...previous[item.kind]] },
      );
    },
    [setItems],
  );

  const options = useMemo<TrackResumeGroup[]>(() => {
    // `void locale`：label 是渲染期求值的，语言进依赖，否则切语言后停在旧语种。
    void locale;
    const groups: TrackResumeGroup[] = [];
    for (const kind of KINDS) {
      const group = items[kind];
      // 空组不渲染：只剩外部简历时不该出现一个「内部简历」的空标题。
      if (group.length === 0) continue;
      groups.push({
        label:
          kind === RESUME_REF_INTERNAL
            ? t("trackerForm.resume.group.internal")
            : t("trackerForm.resume.group.external"),
        options: group.map((item) => ({
          value: formatResumeRef(item.kind, item.id),
          label: optionLabel(item, jobId),
        })),
      });
    }
    return groups;
  }, [items, jobId, locale]);

  const runSearch = useCallback(
    (keyword: string) => {
      const requestId = ++requestSeqRef.current;
      setLoading(true);
      // 两张表同一条口径：`job_id` + `include_general`（本岗位 + 通用）。
      const params = {
        job_id: jobId ?? undefined,
        include_general: true,
        keyword,
        page_size: SELECT_PAGE_SIZE,
      };
      void Promise.allSettled([listResumes(params), listExternalResumes(params)]).then(
        ([internal, external]) => {
          // 过期响应直接丢弃（序号比对，不用 AbortController —— 与共享 hook 同一约定）。
          if (requestId !== requestSeqRef.current) return;
          setItems((previous) => ({
            // 一路失败**不清空**整组：保留上一次的结果，用户至少还能选到已有的那些。
            // 成功的一路则"搜索结果 + 已钉住的已选项"——否则已删除／跨岗位的已选值
            // 会被这次整体替换冲掉，下拉退回裸复合值。
            internal:
              internal.status === "fulfilled"
                ? withPinned(RESUME_REF_INTERNAL, internal.value.items.map(internalItem))
                : previous.internal,
            external:
              external.status === "fulfilled"
                ? withPinned(RESUME_REF_EXTERNAL, external.value.items.map(externalItem))
                : previous.external,
          }));
          setLoading(false);
        },
      );
    },
    [jobId, setItems, withPinned],
  );

  const onSearch = useCallback(
    (value: string) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => runSearch(value.trim()), DEBOUNCE_MS);
    },
    [runSearch],
  );

  /**
   * 重新拉当前关键词的选项（打开弹窗、换岗位时调用）。
   *
   * 先清空「钉住」的已选项：`reload` 的所有调用点都会紧随其后 `ensure` 当前值，
   * 把该显示的重新钉回来——不清的话，上一条记录残留的已删除项会在新记录里冒出来。
   * 用户手动输入触发的是 `runSearch`（不清钉住项），所以输入关键词不会丢掉已选值。
   */
  const reload = useCallback(() => {
    pinnedRef.current = { internal: [], external: [] };
    runSearch("");
  }, [runSearch]);

  /**
   * 已选值保显示：按 id 回查单条并入对应分组。
   *
   * @param value 复合值（`internal:3` / `external:3`）；解析失败返回 `null`，不抛错。
   * @param fallbackTitle 回查 404 时用的标题（调用方手上的 `resume_title` 快照）——
   *   没有它就只能显示 `#3`，用户看不懂那是什么。
   * @returns 并入下拉的那个选项；解析失败或空值时 `null`。
   */
  const ensure = useCallback(
    async (
      value: string | null | undefined,
      fallbackTitle = "",
    ): Promise<TrackResumeOption | null> => {
      const parsed = parseResumeRef(value);
      if (!parsed) return null;
      const cached = itemsRef.current[parsed.kind].find((item) => item.id === parsed.id);
      let item: RawItem;
      if (cached) {
        // 命中缓存也要走 mergeItem 重新「钉住」：`reload()` 刚清过钉住项，只返回不钉住
        // 的话，下一次搜索响应会把这条已选值冲掉。
        item = cached;
      } else {
        try {
          item =
            parsed.kind === RESUME_REF_INTERNAL
              ? internalItem(await getResume(parsed.id))
              : externalItem(await getExternalResume(parsed.id));
        } catch {
          // 404（已删除 / 在回收站）：用调用方给的标题快照降级，保证编辑旧记录不显示裸 id。
          item = {
            kind: parsed.kind,
            id: parsed.id,
            title: fallbackTitle.trim() || `#${parsed.id}`,
            jobId: null,
            missing: true,
          };
        }
      }
      mergeItem(item);
      return { value: formatResumeRef(item.kind, item.id), label: optionLabel(item, jobId) };
    },
    [jobId, mergeItem],
  );

  // 卸载时清掉还没触发的防抖计时器，避免对已卸载组件 setState。
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const selectProps = {
    showSearch: true,
    filterOption: false,
    onSearch,
    loading,
    options,
    notFoundContent: loading
      ? t("hooksUi.remoteSearch.searching")
      : t("hooksUi.remoteSearch.empty"),
  } as const;

  return { selectProps, options, ensure, reload };
}
