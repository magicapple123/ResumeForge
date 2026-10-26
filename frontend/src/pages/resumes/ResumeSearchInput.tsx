// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心的关键词搜索框：输入停顿自动搜索（不必按 Enter）+ 受控回填 + 清空立即生效。
 *
 * **为什么单独成组件**：ResumesPage 已贴着 500 行生产代码预算，而搜索框自带两个状态
 * （输入草稿 / 已生效关键词）与一条定时器生命周期；把行为与页面拆开，页面只接
 * `onCommit`，也让这条防抖有独立、可测的唯一实现点（QA R.02 观察项：此前只有 Enter
 * 才发请求，用户打了字不回车会以为没过滤）。
 *
 * 四条边界：
 * - 输入停顿 `debounceMs`（默认 350ms）后自动提交一次；
 * - Enter 立即提交，不等防抖（提交后草稿与已生效值相等，防抖 effect 空转）；
 * - 点 × / 退格到空：立即提交空串（清筛选不需要等停顿）；
 * - 卸载或再次输入会清掉旧 timer，不会迟到覆盖新的关键词。
 */
import { Input } from "antd";
import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 输入停顿多久后自动提交（毫秒）：打字节奏的停顿与"感知不到延迟"之间的常用值。 */
export const SEARCH_DEBOUNCE_MS = 350;

interface Props {
  /** 已生效的关键词（来自 URL / 页面状态）：外部变化时回填输入框。 */
  keyword: string;
  /** 提交关键词：页面负责写 keyword 状态并把分页回到第 1 页（不动其它筛选）。 */
  onCommit: (value: string) => void;
  debounceMs?: number;
}

export default function ResumeSearchInput({
  keyword,
  onCommit,
  debounceMs = SEARCH_DEBOUNCE_MS,
}: Props) {
  useLocale();
  const [draft, setDraft] = useState(keyword);
  // 外部 keyword 变化（URL 深链恢复 / 页面重置）同步回输入框：渲染期守卫，避免 effect 级联。
  const [prevKeyword, setPrevKeyword] = useState(keyword);
  if (prevKeyword !== keyword) {
    setPrevKeyword(keyword);
    setDraft(keyword);
  }

  useEffect(() => {
    if (draft === keyword) return;
    const timer = window.setTimeout(() => onCommit(draft), debounceMs);
    return () => window.clearTimeout(timer);
  }, [draft, keyword, onCommit, debounceMs]);

  /** Enter / 点搜索按钮：立即提交（同时更新草稿，防抖 effect 随即空转）。 */
  const commit = (value: string) => {
    setDraft(value);
    onCommit(value);
  };

  return (
    <Input.Search
      placeholder={t("resumes.search.placeholder")}
      allowClear
      style={{ width: 300 }}
      value={draft}
      onChange={(event) => {
        const value = event.target.value;
        setDraft(value);
        // 清空立即生效（点 × 与退格到空同一条路径）；非空交给上面的防抖。
        if (value === "") onCommit("");
      }}
      onSearch={commit}
    />
  );
}
