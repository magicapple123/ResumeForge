// SPDX-License-Identifier: Apache-2.0
/**
 * 「写作增强」的结果版本栈：**会话内**最多 5 版，关掉卡片即丢（不落库、不进 localStorage）。
 *
 * 为什么只要 5 版：用户真正会回看的只有"刚才那一版"和"最初那一版"，再多版本条会挤占
 * 结果区的宽度（弹窗只有 560px）。超出时挤掉**最早**的一版而不是拒绝新增——用户在意的是
 * 最新一版能不能进来。
 *
 * ## 编辑落在版本栈里，而不是"未保存的草稿"
 *
 * 结果框是可编辑的：改完直接写回当前版本（`edit`）。这样切到 v1 再切回 v3，v3 上的改动
 * 还在——比"切换时提示未保存并丢弃"少一次数据损失，也不需要额外的确认弹窗。
 * 代价是"当前版本被改过"需要显式标出来，所以每个版本带 `edited`。
 */
import { useCallback, useMemo, useState } from "react";

/** 一版结果：文本 + 是否被用户手动改过。 */
export interface WritingVersion {
  text: string;
  edited: boolean;
}

/** 版本栈上限（见文件头）。 */
export const MAX_WRITING_VERSIONS = 5;

interface VersionState {
  versions: WritingVersion[];
  active: number;
}

const EMPTY: VersionState = { versions: [], active: 0 };

export interface WritingVersions {
  versions: WritingVersion[];
  /** 当前选中版本的下标；`versions` 为空时是 0（无意义）。 */
  active: number;
  /** 当前选中版本；没有结果时为 `null`。回填/迭代都读它。 */
  current: WritingVersion | null;
  /** 推入新的一版并选中它（生成、迭代都走这里）。 */
  push: (text: string) => void;
  /** 切换到某一版（供版本条点击）。 */
  select: (index: number) => void;
  /** 把当前版本原地改成 `text`，并标记为已修改。 */
  edit: (text: string) => void;
  /** 清空（换成话术三版时用：单条结果的版本栈不再适用）。 */
  clear: () => void;
}

export function useWritingVersions(): WritingVersions {
  const [state, setState] = useState<VersionState>(EMPTY);

  const push = useCallback((text: string) => {
    setState((prev) => {
      const next = [...prev.versions, { text, edited: false }];
      const versions =
        next.length > MAX_WRITING_VERSIONS ? next.slice(next.length - MAX_WRITING_VERSIONS) : next;
      return { versions, active: versions.length - 1 };
    });
  }, []);

  const select = useCallback((index: number) => {
    setState((prev) =>
      index >= 0 && index < prev.versions.length ? { ...prev, active: index } : prev,
    );
  }, []);

  const edit = useCallback((text: string) => {
    setState((prev) => {
      if (!prev.versions[prev.active]) return prev;
      const versions = prev.versions.map((version, index) =>
        index === prev.active ? { text, edited: true } : version,
      );
      return { versions, active: prev.active };
    });
  }, []);

  const clear = useCallback(() => setState(EMPTY), []);

  return useMemo(
    () => ({
      versions: state.versions,
      active: state.active,
      current: state.versions[state.active] ?? null,
      push,
      select,
      edit,
      clear,
    }),
    [state, push, select, edit, clear],
  );
}
