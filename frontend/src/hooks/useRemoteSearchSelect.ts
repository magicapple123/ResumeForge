// SPDX-License-Identifier: Apache-2.0
/**
 * 远程搜索选择器 hook（P0-1）：把「关键词 → 服务端搜索 → 选项」封装成 antd Select
 * 的 props，替代全站"第 1 页 100 条当全量"的下拉取数方式。
 *
 * 使用方式：
 *
 *   const jobSelect = useRemoteSearchSelect({
 *     fetchOptions: (keyword) => listJobs({ keyword, page_size: 50 }).then(mapJobOptions),
 *     fetchById: (id) => getJob(id).then(mapJob).catch(() => null),
 *   });
 *   // 打开表单 / 拿到编辑值时回查选中项，保证"已选值"在下拉里显示得出来：
 *   useEffect(() => { void jobSelect.ensure(track?.job_id); }, [track?.job_id]);
 *   <Select {...jobSelect.selectProps} />
 *
 * 设计要点：
 * - **防抖 300ms**：onSearch 里只更新计时器，停顿后才真正发请求。
 * - **竞态防护用请求序号**而不是 AbortController：过期响应直接丢弃（项目约定禁用
 *   AbortSignal.any；单请求无需 abort，序号比对同样能保证只采纳最后一次结果）。
 * - **已选值保显示**（ensure）：编辑场景的初始 id 往往不在第一页选项里，按 id 回查
 *   单条并入选项头部；回查结果有缓存，同一 id 不重复请求。
 * - **options 同时暴露**：个别消费方（详情抽屉、生成结果回填）需要按 id 找 label。
 * - **文案在渲染期求值**：选项缓存里只放原始数据（调用方给的纯文本 `label`，或
 *   `labelKey` + 参数），渲染时再 `t()` 生成展示文案。把已求值的文案存进 state 的话，
 *   切语言后它会一直停在旧语种——`useLocale()` 让本 hook 在切语言时重新渲染。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t, type MessageKey, type MessageParams } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

export interface RemoteSelectOption {
  value: number;
  /** 展示文案；给了 `labelKey` 时以语言包为准，这一项只作兜底。 */
  label: string;
  /**
   * 文案由语言包生成的选项（例如「简历 #{id}」这种兜底名）存 key 与参数，渲染期再
   * `t()`：纯数据文案（岗位标题、公司名）继续只给 `label` 即可。
   */
  labelKey?: MessageKey;
  labelParams?: MessageParams;
}

/** 展示文案一律在渲染期求值：缓存里只有原始数据（见文件头「文案在渲染期求值」）。 */
function resolveLabel(option: RemoteSelectOption): RemoteSelectOption {
  if (!option.labelKey) return option;
  return { ...option, label: t(option.labelKey, option.labelParams) };
}

interface Params {
  /** 按关键词取一页选项（实现方决定 page_size 与端点）。空串 = 默认首页。 */
  fetchOptions: (keyword: string) => Promise<RemoteSelectOption[]>;
  /** 按 id 回查单条（编辑场景保显示）；失败/不存在返回 null，不抛错。 */
  fetchById: (id: number) => Promise<RemoteSelectOption | null>;
  /** 防抖毫秒数，默认 300。 */
  debounceMs?: number;
}

export function useRemoteSearchSelect({ fetchOptions, fetchById, debounceMs = 300 }: Params) {
  // 订阅语言变化：切语言后 `labelKey` 与空态文案都要重新求值（模块级 t() 不自带订阅）。
  const locale = useLocale();
  const [storedOptions, setStoredOptions] = useState<RemoteSelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const requestSeqRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const ensureCacheRef = useRef(new Map<number, RemoteSelectOption>());

  // 缓存里是原始选项，展示文案到这里才生成；语言进依赖，否则切语言后不会重算。
  const options = useMemo(() => {
    // `void locale`：t() 读的是模块级快照，语言变了就必须重算一遍文案。
    void locale;
    return storedOptions.map(resolveLabel);
  }, [storedOptions, locale]);

  // 组件卸载时清掉还没触发的防抖计时器，避免对已卸载组件 setState。
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const runSearch = useCallback(
    (keyword: string) => {
      const requestId = ++requestSeqRef.current;
      setLoading(true);
      void fetchOptions(keyword)
        .then((next) => {
          if (requestId !== requestSeqRef.current) return;
          setStoredOptions(next);
          setLoading(false);
        })
        .catch(() => {
          if (requestId !== requestSeqRef.current) return;
          setStoredOptions([]);
          setLoading(false);
        });
    },
    [fetchOptions],
  );

  const onSearch = useCallback(
    (value: string) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => runSearch(value.trim()), debounceMs);
    },
    [debounceMs, runSearch],
  );

  /** 重新拉当前关键词的选项（打开弹窗/面板时调用一次做初始加载）。 */
  const reload = useCallback(() => runSearch(""), [runSearch]);

  /**
   * 已选值保显示：按 id 回查并并入选项头部（有缓存；不覆盖现有项）。
   *
   * 返回回查结果：需要"查不到就降级显示别的东西"的调用方（如简历中心的岗位筛选
   * 下拉把失效岗位显示成 `#id`）必须知道结局，否则只能猜。
   */
  const ensure = useCallback(
    async (id: number | null | undefined): Promise<RemoteSelectOption | null> => {
      if (id == null) return null;
      const cached = ensureCacheRef.current.get(id);
      if (cached) {
        setStoredOptions((previous) =>
          previous.some((option) => option.value === id) ? previous : [cached, ...previous],
        );
        return resolveLabel(cached);
      }
      try {
        const option = await fetchById(id);
        if (!option) return null;
        ensureCacheRef.current.set(id, option);
        setStoredOptions((previous) =>
          previous.some((existing) => existing.value === id) ? previous : [option, ...previous],
        );
        return resolveLabel(option);
      } catch {
        /* 回查失败静默：调用方自己决定降级显示，这里不抛错 */
        return null;
      }
    },
    [fetchById],
  );

  const selectProps = {
    showSearch: true,
    filterOption: false,
    onSearch,
    loading,
    options,
    // 空态文案在渲染期取：本 hook 订阅了语言，切语言后会重新求值。
    notFoundContent: loading
      ? t("hooksUi.remoteSearch.searching")
      : t("hooksUi.remoteSearch.empty"),
  } as const;

  return { selectProps, options, ensure, reload };
}
