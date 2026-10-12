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
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface RemoteSelectOption {
  value: number;
  label: string;
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
  const [options, setOptions] = useState<RemoteSelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const requestSeqRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const ensureCacheRef = useRef(new Map<number, RemoteSelectOption>());

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
          setOptions(next);
          setLoading(false);
        })
        .catch(() => {
          if (requestId !== requestSeqRef.current) return;
          setOptions([]);
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

  /** 已选值保显示：按 id 回查并并入选项头部（有缓存；不覆盖现有项）。 */
  const ensure = useCallback(
    (id: number | null | undefined) => {
      if (id == null) return;
      const cached = ensureCacheRef.current.get(id);
      if (cached) {
        setOptions((previous) =>
          previous.some((option) => option.value === id) ? previous : [cached, ...previous],
        );
        return;
      }
      void fetchById(id)
        .then((option) => {
          if (!option) return;
          ensureCacheRef.current.set(id, option);
          setOptions((previous) =>
            previous.some((existing) => existing.value === id) ? previous : [option, ...previous],
          );
        })
        .catch(() => {
          /* 回查失败静默：选不中就显示原值，与旧行为一致 */
        });
    },
    [fetchById],
  );

  const selectProps = {
    showSearch: true,
    filterOption: false,
    onSearch,
    loading,
    options,
    notFoundContent: loading ? "搜索中…" : "无匹配结果，可输入关键词搜索",
  } as const;

  return { selectProps, options, ensure, reload };
}
