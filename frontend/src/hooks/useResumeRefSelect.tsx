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
 * 防抖与竞态：**与 `useRemoteSearchSelect` 共用 `useDebouncedRemoteSearch`**（T29 把 T13
 * 复制过去的那段防抖 + 序号丢弃收回一份）；文案一律在渲染期求值（`useLocale()` 进依赖），
 * 否则切语言后下拉会停在旧语种。
 *
 * **谁在用**：提醒表单（`features/tracker/ReminderFormFields`）、助手输入区 `+` 面板
 * （`features/assistant/components/composer/AddMenu.tsx`，选中值原样进 `resume_ref`）、
 * 投递台（`features/apply/queue/QueueItemEditor`）、模拟面试（`useInterviewResumeSelect`）
 * 与进度表单（`features/tracker/useTrackResumeSelect`，本文件的一层薄封装）。
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { Tag } from "antd";
import type { ReactNode } from "react";
import { getExternalResume, listExternalResumes } from "../api/externalResumes";
import { getResume, listResumes } from "../api/resumes";
import { t, type MessageKey } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import {
  decodeResumeRef,
  encodeResumeRef,
  type ResumeKind,
  type ResumeRef,
} from "../types/resumeRef";
import { fileKindBadge, fileKindOf } from "../utils/fileKind";
import { remoteSearchEmptyText, useDebouncedRemoteSearch } from "./useDebouncedRemoteSearch";

/** 下拉搜索的每页条数：够扫一眼，继续缩范围靠输入关键词。 */
const SELECT_PAGE_SIZE = 50;

/** 一个下拉选项：`value` 是复合串，`label` 是渲染期拼好的节点（名字 + 类型徽标）。 */
export interface ResumeRefOption {
  value: string;
  label: ReactNode;
  /**
   * 同一项的**纯文本名**（不含徽标）。
   *
   * 给"要把已选简历写成一句话"的地方用（助手的上下文 chip、提醒卡片副行）：那些位置
   * 需要字符串，不能塞一个带 `Tag` 的 ReactNode 进 `title` / `refs` 快照。
   */
  text: string;
  /** 来源（`internal` / `external`）与那张表里的 id；值本身已含，拆开是给判据用。 */
  kind: ResumeKind;
  id: number;
  /**
   * 是否已有可用正文。内部简历恒为 `true`；外部简历看上传时提取出了多少字。
   * 面试 / 文本级匹配这类"要正文"的场景据此禁用没有文字的快照。
   */
  hasText: boolean;
  /** 外部简历关联的岗位 id（列表接口给的原值）；内部简历为 `null`。 */
  jobId: number | null;
  /** 要正文的场景里，没有正文的项禁用；点了也不会有值。 */
  disabled?: boolean;
  /** 禁用原因的悬停说明（原生 title）：禁用项不该只有灰色。 */
  title?: string;
}

/** 外部简历项对外暴露的判断材料（打「关联此岗位」标签 / 判有没有正文用）。 */
export interface ResumeRefMeta {
  id: number;
  name: string;
  mime: string;
  hasText: boolean;
  jobId: number | null;
}

/**
 * 可选配置。**不传时行为与 T29 完全一致**（全库内部简历、空组不渲染、tracker 分组名）。
 *
 * 只有"要正文"的消费方（模拟面试 / 文本级匹配）才需要打开其中几项。
 */
export interface UseResumeRefSelectConfig {
  /**
   * 按岗位收窄候选：本岗位关联的 + 通用的（`job_id` + `include_general`）。
   * 不传 = 全库；传 `null` 与不传同义（除非同时打开 `includeGeneral`）。
   * **内部简历**跟随本项；外部简历见 `externalJobScope`。
   */
  jobId?: number | null;
  /**
   * 未选岗位时也带 `include_general: true`（进度表单的全库口径）。
   *
   * 进度表单的「未选岗位 = 全库」与"本岗位 + 通用"是同一条查询语义，服务端只按
   * `include_general` 决定要不要并上通用简历；不传时默认只在给了 `jobId` 才带它。
   */
  includeGeneral?: boolean;
  /**
   * 外部简历是否也按 `jobId` 收窄（默认 `true`，与内部同一口径）。
   *
   * 模拟面试传 `false`：外部组要保留跨岗位选择，只对命中当前岗位的项打标签
   * （方案 25D）——面试官读的是用户手里那份文件，不该因为归属岗位不同就藏起来。
   */
  externalJobScope?: boolean;
  /** 保留空分组（面试要留「外部简历」组作为来源可发现入口）。默认 `false`。 */
  keepEmptyGroups?: boolean;
  /** 分组标题覆盖（各页用自己的语言包键）；默认 `trackerForm.resume.group.*`。 */
  groupLabels?: { internal: MessageKey; external: MessageKey };
  /** 外部简历没有正文就禁用，`hint` 作为禁用项的悬停说明（"为什么 + 怎么办"）。 */
  externalRequiresText?: { hint: string };
  /** 外部项名字后的附加说明（如「关联此岗位」/「无正文」）；返回 `null` 表示不加。 */
  externalNote?: (item: ResumeRefMeta) => string | null;
  /**
   * **紧贴名字之后**的附加说明（内部 / 外部都生效，不加分隔符）。
   *
   * 进度表单用它标「（不属于当前岗位）」——语言包里的这条文案自带括号，拼在名字后面
   * 才是 `Backend resume（不属于当前岗位）`；`externalNote` 会插一个 `·`，口径不同。
   */
  itemSuffix?: (item: ResumeRefMeta) => string | null;
}

/** antd `Select` 的分组选项。 */
export interface ResumeRefGroup {
  label: string;
  /** 这一组是哪张表（`internal` / `external`）；调用方不必再靠标题文案判断。 */
  kind: ResumeKind;
  options: ResumeRefOption[];
}

/** 选项背后的原始数据（缓存里只放它，展示文案到渲染期再生成）。 */
interface RawItem {
  ref: ResumeRef;
  /** 内部简历的 `title` / 外部简历的 `name`；空串走 `简历 #id` 兜底。 */
  title: string;
  /** 外部简历的原件 MIME（决定徽标）；内部简历为空串。 */
  mime: string;
  /** 有没有可用正文（内部简历恒 `true`）。 */
  hasText: boolean;
  /** 关联的岗位（内部 / 外部都取列表接口的原值）；通用简历为 `null`。 */
  jobId: number | null;
  /** 回查 404：这条关联指向的记录已经不在了。 */
  missing: boolean;
}

type Items = Record<ResumeKind, RawItem[]>;

/** 分组顺序（内部在前：多数人先看自己做的简历）。 */
const KINDS: readonly ResumeKind[] = ["internal", "external"];

const EMPTY_ITEMS: Items = { internal: [], external: [] };

function internalItem(resume: { id: number; title: string; job_id?: number | null }): RawItem {
  return {
    ref: { kind: "internal", id: resume.id },
    title: resume.title ?? "",
    mime: "",
    // 内部简历是结构化文档，出题 / 匹配读的是它的字段，不存在"没有正文"。
    hasText: true,
    // 岗位关联要取原值：进度表单用它标「不属于当前岗位」，恒 null 会让标注永远不出现。
    jobId: resume.job_id ?? null,
    missing: false,
  };
}

function externalItem(resume: {
  id: number;
  name: string;
  mime: string;
  has_text?: boolean;
  job_id?: number | null;
}): RawItem {
  return {
    ref: { kind: "external", id: resume.id },
    title: resume.name ?? "",
    mime: resume.mime ?? "",
    // 列表缺字段时按"有正文"处理：宁可让用户选到再由后端说不行，也不要凭空禁用。
    hasText: resume.has_text !== false,
    jobId: resume.job_id ?? null,
    missing: false,
  };
}

/** 纯文本名：名字 → 兜底 `简历 #id` →（已删除）。给"已选值"与详情展示共用。 */
function textOfItem(item: RawItem): string {
  const base = item.title.trim() || t("hooksUi.option.resumeFallback", { id: item.ref.id });
  return item.missing ? `${base}${t("trackerForm.resume.deleted")}` : base;
}

/** 选项节点：名 +（可选）附加说明 +（外部简历）文件类型徽标。 */
function labelOfItem(item: RawItem, note?: string | null, suffix?: string | null): ReactNode {
  const withNote = note ? `${textOfItem(item)} · ${note}` : textOfItem(item);
  const text = suffix ? `${withNote}${suffix}` : withNote;
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

export function useResumeRefSelect(config: UseResumeRefSelectConfig = {}) {
  const { jobId, includeGeneral, keepEmptyGroups, groupLabels, externalNote, itemSuffix } = config;
  const externalScoped = config.externalJobScope !== false;
  // 只取字符串参与依赖：调用方常把 options 写成内联对象，吃对象会让 ensure / groups 每次渲染都变。
  const externalHint = config.externalRequiresText?.hint;
  // 订阅语言：选项文案在渲染期求值，切语言后必须重算。
  const locale = useLocale();
  const [items, setItemsState] = useState<Items>(EMPTY_ITEMS);
  // 防抖 / 请求序号 / loading / 空态文案与 `useRemoteSearchSelect` 共用一份实现（T29）。
  const { loading, begin, isCurrent, settle, schedule } = useDebouncedRemoteSearch();
  // ref 与 state 同步维护：`ensure` 在异步回调里要读"当前已有的选项"，只读 state 会拿到
  // 闭包里的旧数组，同一份简历会被反复回查。
  const itemsRef = useRef<Items>(EMPTY_ITEMS);
  // 「钉住」的选项：`ensure` 回查出来的已选值。搜索结果是整体替换式更新，不钉住的话
  // 一次响应落地就会把已选值冲掉，下拉退回裸复合值 `external:7`。
  const pinnedRef = useRef<Items>({ internal: [], external: [] });

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
      // 空组默认不渲染：只剩外部简历时不该出现一个「内部简历」的空标题。
      // 面试这类"要让人知道还有一个来源"的场景用 `keepEmptyGroups` 打开。
      if (group.length === 0 && !keepEmptyGroups) continue;
      const labelKey: MessageKey =
        kind === "internal"
          ? (groupLabels?.internal ?? "trackerForm.resume.group.internal")
          : (groupLabels?.external ?? "trackerForm.resume.group.external");
      result.push({
        label: t(labelKey),
        kind,
        options: group.map((item) => {
          // 没有正文就禁用（面试 / 文本级匹配）：不是"能选但会报错"，而是根本选不到。
          const blocked = kind === "external" && externalHint !== undefined && !item.hasText;
          const meta = {
            id: item.ref.id,
            name: item.title,
            mime: item.mime,
            hasText: item.hasText,
            jobId: item.jobId,
          };
          const note = kind === "external" ? (externalNote?.(meta) ?? null) : null;
          return {
            value: encodeResumeRef(item.ref),
            label: labelOfItem(item, note, itemSuffix?.(meta) ?? null),
            text: textOfItem(item),
            kind: item.ref.kind,
            id: item.ref.id,
            hasText: item.hasText,
            jobId: item.jobId,
            disabled: blocked || undefined,
            title: blocked ? externalHint : undefined,
          };
        }),
      });
    }
    return result;
  }, [
    items,
    locale,
    keepEmptyGroups,
    groupLabels?.internal,
    groupLabels?.external,
    externalHint,
    externalNote,
    itemSuffix,
  ]);

  const runSearch = useCallback(
    (keyword: string) => {
      const requestId = begin();
      // 内部简历按岗位域过滤只在给了 jobId 时生效（`include_general` 也只与 job_id 组合
      // 有意义）；不传 = 全库，与 T29 的既有消费方一致。`includeGeneral` 让"未选岗位 =
      // 全库"的调用方（进度表单）也能显式带上它，服务端口径保持不变。
      const params =
        jobId === undefined || jobId === null
          ? includeGeneral
            ? { include_general: true, keyword, page_size: SELECT_PAGE_SIZE }
            : { keyword, page_size: SELECT_PAGE_SIZE }
          : { job_id: jobId, include_general: true, keyword, page_size: SELECT_PAGE_SIZE };
      // 两张表默认用**同一份**范围参数：外部简历列表同样支持 `job_id` + `include_general`
      // （见 `api/externalResumes.listExternalResumes`）。只收窄内部一组会让同一个下拉里
      // 「通用简历为什么只出现在一组」没法解释，也会让用户选到别的岗位的版本。
      // `externalJobScope: false` 是例外（模拟面试，方案 25D）：外部组跨岗位可见、只打标签。
      const externalParams = externalScoped
        ? params
        : { keyword, page_size: SELECT_PAGE_SIZE };
      void Promise.allSettled([listResumes(params), listExternalResumes(externalParams)]).then(
        ([internal, external]) => {
          // 过期响应直接丢弃（序号比对，与共享 hook 同一约定）。
          if (!isCurrent(requestId)) return;
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
          settle();
        },
      );
    },
    [begin, externalScoped, includeGeneral, isCurrent, jobId, setItems, settle, withPinned],
  );

  const onSearch = useCallback(
    (value: string) => schedule(value, runSearch),
    [runSearch, schedule],
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
            hasText: ref.kind === "internal",
            jobId: null,
            missing: true,
          };
        }
      }
      mergeItem(item);
      const meta = {
        id: item.ref.id,
        name: item.title,
        mime: item.mime,
        hasText: item.hasText,
        jobId: item.jobId,
      };
      const note = ref.kind === "external" ? (externalNote?.(meta) ?? null) : null;
      return {
        value: encodeResumeRef(item.ref),
        label: labelOfItem(item, note, itemSuffix?.(meta) ?? null),
        text: textOfItem(item),
        kind: item.ref.kind,
        id: item.ref.id,
        hasText: item.hasText,
        jobId: item.jobId,
        // 已选值不做禁用：哪怕它后来被判定"没有正文"，也要让用户看见自己选的是哪一份。
        title: !item.hasText && externalHint ? externalHint : undefined,
      };
    },
    [externalHint, externalNote, itemSuffix, mergeItem],
  );

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
    notFoundContent: remoteSearchEmptyText(loading),
  } as const;

  return { selectProps, groups, ensure, reload, refOf, textOfRef };
}
