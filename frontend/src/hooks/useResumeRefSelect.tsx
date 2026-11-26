// SPDX-License-Identifier: Apache-2.0
/**
 * 「关联简历」统一选择器（`CONTRACT.md` 第 2 节，R14 的第一批消费方）：
 * **一个下拉、两组选项、复合值** —— 内部简历（`/api/resumes`）与外部简历
 * （`/api/external-resumes`）并行查，值域是 `ResumeRef` 序列化后的复合串
 * （`internal:12` / `external:7`，见 `types/resumeRef`）。
 *
 * 与 `useRemoteSearchSelect` 的三点不同（其余约定逐条沿用那个 hook）：
 *
 * 1. **值域是字符串复合值**，不是 `number`：两张表的 id 会撞号，裸数字无法区分来源；
 * 2. **并行查两端**（`Promise.allSettled`）：外部简历接口挂了不该让用户连内部简历都选不了；
 * 3. **分组输出 + 类型徽标**：`内部简历` / `外部简历` 两组（空组不渲染），外部项追加
 *    `PDF` / `DOCX` 等徽标（判定复用 `utils/fileKind`，与外部简历列表同一口径）。
 *
 * 防抖与竞态：300ms 防抖 + 请求序号丢弃过期响应（与 `useRemoteSearchSelect` 同一做法，
 * 项目约定不用 `AbortSignal.any`）。文案一律在渲染期求值（`useLocale()` 进依赖），
 * 否则切语言后下拉会停在旧语种。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tag } from "antd";
import type { ReactNode } from "react";
import { getExternalResume, listExternalResumes } from "../api/externalResumes";
import { getResume, listResumes } from "../api/resumes";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import {
  decodeResumeRef,
  encodeResumeRef,
  type ResumeKind,
  type ResumeRef,
} from "../types/resumeRef";
import { fileKindBadge, fileKindOf } from "../utils/fileKind";

/** 下拉搜索的每页条数：够扫一眼，继续缩范围靠输入关键词。 */
const SELECT_PAGE_SIZE = 50;
/** 输入每个字符都打请求会把本地后端打得很难看（与共享 hook 一致）。 */
const DEBOUNCE_MS = 300;

/** 一个下拉选项：`value` 是复合串，`label` 是渲染期拼好的节点（名字 + 类型徽标）。 */
export interface ResumeRefOption {
  value: string;
  label: ReactNode;
}

/** antd `Select` 的分组选项。 */
export interface ResumeRefGroup {
  label: string;
  options: ResumeRefOption[];
}

/** 选项背后的原始数据（缓存里只放它，展示文案到渲染期再生成）。 */
interface RawItem {
  ref: ResumeRef;
  /** 内部简历的 `title` / 外部简历的 `name`；空串走 `简历 #id` 兜底。 */
  title: string;
  /** 外部简历的原件 MIME（决定徽标）；内部简历为空串。 */
  mime: string;
  /** 回查 404：这条关联指向的记录已经不在了。 */
  missing: boolean;
}

type Items = Record<ResumeKind, RawItem[]>;

/** 分组顺序（内部在前：多数人先看自己做的简历）。 */
const KINDS: readonly ResumeKind[] = ["internal", "external"];

const EMPTY_ITEMS: Items = { internal: [], external: [] };

function internalItem(resume: { id: number; title: string }): RawItem {
  return {
    ref: { kind: "internal", id: resume.id },
    title: resume.title ?? "",
    mime: "",
    missing: false,
  };
}

function externalItem(resume: { id: number; name: string; mime: string }): RawItem {
  return {
    ref: { kind: "external", id: resume.id },
    title: resume.name ?? "",
    mime: resume.mime ?? "",
    missing: false,
  };
}

/** 纯文本名：名字 → 兜底 `简历 #id` →（已删除）。给"已选值"与详情展示共用。 */
function textOfItem(item: RawItem): string {
  const base = item.title.trim() || t("hooksUi.option.resumeFallback", { id: item.ref.id });
  return item.missing ? `${base}${t("trackerForm.resume.deleted")}` : base;
}

/** 选项节点：名 + （外部简历）文件类型徽标。 */
function labelOfItem(item: RawItem): ReactNode {
  const text = textOfItem(item);
  if (item.ref.kind !== "external") return text;
  const badge = fileKindBadge(fileKindOf(item.mime, item.title));
  if (!badge) return text;
  return (
    <span>
      {text} <Tag style={{ marginInlineStart: 6 }}>{badge}</Tag>
    </span>
  );
}

function findItem(items: Items, value: string | null | undefined): RawItem | undefined {
  const ref = decodeResumeRef(value);
  if (!ref) return undefined;
  return items[ref.kind].find((item) => item.ref.id === ref.id);
}

export function useResumeRefSelect() {
  // 订阅语言：选项文案在渲染期求值，切语言后必须重算。
  const locale = useLocale();
  const [items, setItemsState] = useState<Items>(EMPTY_ITEMS);
  const [loading, setLoading] = useState(false);
  // ref 与 state 同步维护：`ensure` 在异步回调里要读"当前已有的选项"，只读 state 会拿到
  // 闭包里的旧数组，同一份简历会被反复回查。
  const itemsRef = useRef<Items>(EMPTY_ITEMS);
  // 「钉住」的选项：`ensure` 回查出来的已选值。搜索结果是整体替换式更新，不钉住的话
  // 一次响应落地就会把已选值冲掉，下拉退回裸复合值 `external:7`。
  const pinnedRef = useRef<Items>({ internal: [], external: [] });
  const requestSeqRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const setItems = useCallback((updater: (previous: Items) => Items) => {
    const next = updater(itemsRef.current);
    itemsRef.current = next;
    setItemsState(next);
  }, []);

  /** 合并搜索结果与已钉住的已选项：结果在前，钉住项按 id 去重后补在后面。 */
  const withPinned = useCallback((kind: ResumeKind, listed: RawItem[]): RawItem[] => {
    const pinned = pinnedRef.current[kind];
    if (pinned.length === 0) return listed;
    const seen = new Set(listed.map((item) => item.ref.id));
    const extras = pinned.filter((item) => !seen.has(item.ref.id));
    return extras.length === 0 ? listed : [...listed, ...extras];
  }, []);

  const mergeItem = useCallback(
    (item: RawItem) => {
      const { kind, id } = item.ref;
      if (!pinnedRef.current[kind].some((existing) => existing.ref.id === id)) {
        pinnedRef.current = {
          ...pinnedRef.current,
          [kind]: [...pinnedRef.current[kind], item],
        };
      }
      setItems((previous) =>
        previous[kind].some((existing) => existing.ref.id === id)
          ? previous
          : { ...previous, [kind]: [item, ...previous[kind]] },
      );
    },
    [setItems],
  );

  const groups = useMemo<ResumeRefGroup[]>(() => {
    // `void locale`：label 是渲染期求值的，语言进依赖，否则切语言后停在旧语种。
    void locale;
    const result: ResumeRefGroup[] = [];
    for (const kind of KINDS) {
      const group = items[kind];
      // 空组不渲染：只剩外部简历时不该出现一个「内部简历」的空标题。
      if (group.length === 0) continue;
      result.push({
        label: t(
          kind === "internal"
            ? "trackerForm.resume.group.internal"
            : "trackerForm.resume.group.external",
        ),
        options: group.map((item) => ({
          value: encodeResumeRef(item.ref),
          label: labelOfItem(item),
        })),
      });
    }
    return result;
  }, [items, locale]);

  const runSearch = useCallback(
    (keyword: string) => {
      const requestId = ++requestSeqRef.current;
      setLoading(true);
      const params = { keyword, page_size: SELECT_PAGE_SIZE };
      void Promise.allSettled([listResumes(params), listExternalResumes(params)]).then(
        ([internal, external]) => {
          // 过期响应直接丢弃（序号比对，与共享 hook 同一约定）。
          if (requestId !== requestSeqRef.current) return;
          setItems((previous) => ({
            // 一路失败**不清空**整组：保留上一次结果，用户至少还能选到已有的那些。
            internal:
              internal.status === "fulfilled"
                ? withPinned("internal", internal.value.items.map(internalItem))
                : previous.internal,
            external:
              external.status === "fulfilled"
                ? withPinned("external", external.value.items.map(externalItem))
                : previous.external,
          }));
          setLoading(false);
        },
      );
    },
    [setItems, withPinned],
  );

  const onSearch = useCallback(
    (value: string) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => runSearch(value.trim()), DEBOUNCE_MS);
    },
    [runSearch],
  );

  /**
   * 重拉当前关键词的选项（打开弹窗 / 编辑前调用）。
   *
   * 先清空「钉住」项：所有调用点都会紧随其后 `ensure` 当前值把它钉回来——不清的话，
   * 上一条记录残留的"已删除"项会在新记录里冒出来。
   */
  const reload = useCallback(() => {
    pinnedRef.current = { internal: [], external: [] };
    runSearch("");
  }, [runSearch]);

  /**
   * 已选值保显示：按复合值回查单条并入对应分组。
   *
   * @param value 复合值（`internal:12` / `external:7`，也接受旧写法 `r:12` / `e:7`）。
   * @param fallbackTitle 回查 404 时的标题（调用方手上的标题快照 / 回显名）。
   * @returns 并入下拉的选项；空值或解析失败时 `null`。
   */
  const ensure = useCallback(
    async (
      value: string | null | undefined,
      fallbackTitle = "",
    ): Promise<ResumeRefOption | null> => {
      const ref = decodeResumeRef(value);
      if (!ref) return null;
      const cached = itemsRef.current[ref.kind].find((item) => item.ref.id === ref.id);
      let item: RawItem;
      if (cached) {
        // 命中缓存也要重新「钉住」：`reload()` 刚清过钉住项。
        item = cached;
      } else {
        try {
          item =
            ref.kind === "internal"
              ? internalItem(await getResume(ref.id))
              : externalItem(await getExternalResume(ref.id));
        } catch {
          // 404（已删除 / 在回收站）：用调用方给的标题降级，编辑旧记录不显示裸 id。
          item = {
            ref,
            title: fallbackTitle.trim() || `#${ref.id}`,
            mime: "",
            missing: true,
          };
        }
      }
      mergeItem(item);
      return { value: encodeResumeRef(item.ref), label: labelOfItem(item) };
    },
    [mergeItem],
  );

  // 卸载时清掉还没触发的防抖计时器，避免对已卸载组件 setState。
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  /**
   * 下拉值 → `ResumeRef`：表单提交时据此拆回 `resume_id` / `external_resume_id`
   * （见 `types/resumeRef.resumeRefIds`）。空值 / 非法值返回 `null`。
   */
  const refOf = useCallback((value: string | null | undefined): ResumeRef | null => {
    return decodeResumeRef(value);
  }, []);

  /** 已选值的纯文本名（详情抽屉 / 提醒卡用）；还没回查到时返回 `undefined`。 */
  const textOfRef = useCallback((value: string | null | undefined): string | undefined => {
    const item = findItem(itemsRef.current, value);
    return item ? textOfItem(item) : undefined;
  }, []);

  const selectProps = {
    showSearch: true,
    filterOption: false,
    onSearch,
    loading,
    options: groups,
    // 空态文案在渲染期取：本 hook 订阅了语言，切语言后会重新求值。
    notFoundContent: loading
      ? t("hooksUi.remoteSearch.searching")
      : t("hooksUi.remoteSearch.empty"),
  } as const;

  return { selectProps, groups, ensure, reload, refOf, textOfRef };
}
