/**
 * 简历中心的岗位筛选下拉（R15）：远程搜索 + 深链回填。
 *
 * 三件必须同时成立的事，也是它独立成组件的原因：
 * 1. **远程搜索**：岗位可能上千条，一次性全量下拉既慢又难找；输入即搜（250ms 防抖）。
 * 2. **已选值保显示**：`?job_id=` 深链进来时那一页选项里通常没有这个岗位，必须按 id 回查。
 * 3. **失效也不静默**：回查失败（岗位进了回收站/真删了）时显示 `#id`——value 仍然有效，
 *    筛选照常生效，用户不会看到"筛选框空白但列表是过滤过的"这种自相矛盾的界面。
 */
import { Select } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getJob, listJobs } from "../../api/jobs";
import { jobOption } from "../../hooks/remoteSearchOptions";
import { useRemoteSearchSelect } from "../../hooks/useRemoteSearchSelect";

/** 每页 20 条：筛选靠继续输入收窄，不需要一屏列出全部岗位。 */
const FILTER_PAGE_SIZE = 20;
/** 输入停顿 250ms 才发请求：够快，又不至于每个字符打一次后端。 */
const SEARCH_DEBOUNCE_MS = 250;

interface Props {
  value?: number;
  onChange: (jobId: number | undefined) => void;
  /** 当前选中项的名称（父组件用来渲染 Tag）；查不到时收到 `#id`。 */
  onLabelChange?: (label: string) => void;
}

export default function JobFilterSelect({ value, onChange, onLabelChange }: Props) {
  // 取数函数用 useCallback 定住：hook 内部以引用做依赖，每次渲染换新函数会反复回查。
  const fetchOptions = useCallback(
    (keyword: string) =>
      listJobs({ keyword, page_size: FILTER_PAGE_SIZE }).then((page) => page.items.map(jobOption)),
    [],
  );
  const fetchById = useCallback(
    (id: number) =>
      getJob(id)
        .then(jobOption)
        .catch(() => null),
    [],
  );
  const { selectProps, options, ensure, reload } = useRemoteSearchSelect({
    fetchOptions,
    fetchById,
    debounceMs: SEARCH_DEBOUNCE_MS,
  });
  // 回查结果连带记下它对应的 id：换了个岗位就不该继续沿用旧名字（也不必在 effect
  // 里同步清空 state，那是级联渲染的来源）。
  const [resolved, setResolved] = useState<{ id: number; label: string } | null>(null);

  // 打开页面先拉一页：下拉第一次展开时不该是空的。
  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (value == null) return;
    let cancelled = false;
    void ensure(value).then((option) => {
      if (cancelled) return;
      setResolved({ id: value, label: option ? option.label : `#${value}` });
    });
    return () => {
      cancelled = true;
    };
  }, [ensure, value]);

  const fallbackLabel = resolved && resolved.id === value ? resolved.label : "";

  // 选中值不在选项里（深链/刚回查完）时补一条，保证 Select 显示得出名字或 #id。
  const mergedOptions = useMemo(() => {
    if (value == null) return options;
    if (options.some((option) => option.value === value)) return options;
    return [{ value, label: fallbackLabel || `#${value}` }, ...options];
  }, [fallbackLabel, options, value]);

  const label = useMemo(
    () => mergedOptions.find((option) => option.value === value)?.label ?? "",
    [mergedOptions, value],
  );

  useEffect(() => {
    onLabelChange?.(label);
  }, [label, onLabelChange]);

  return (
    <Select
      {...selectProps}
      allowClear
      placeholder="按岗位筛选"
      aria-label="按岗位筛选"
      style={{ width: 240 }}
      options={mergedOptions}
      value={value}
      onChange={(next) => onChange(next ?? undefined)}
    />
  );
}
