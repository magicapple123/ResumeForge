// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心的关键词搜索框：输入停顿自动搜索（不必按 Enter）+ 受控回填 + 清空立即生效。
 *
 * **为什么单独成组件**：ResumesPage 已贴着 500 行生产代码预算，而搜索框自带两个状态
 * （输入草稿 / 已生效关键词）与一条定时器生命周期；把行为与页面拆开，页面只接
 * `onCommit`，也让这条防抖有独立、可测的唯一实现点（QA R.02 观察项：此前只有 Enter
 * 才发请求，用户打了字不回车会以为没过滤）。
 *
 * 五条边界：
 * - 输入停顿 `debounceMs`（默认 350ms）后自动提交一次；
 * - Enter 立即提交，不等防抖（提交后草稿与已生效值相等，防抖 effect 空转）；
 * - 点 × / 退格到空：立即提交空串（清筛选不需要等停顿）；
 * - 卸载或再次输入会清掉旧 timer，不会迟到覆盖新的关键词；
 * - **输入法组字期间一律不提交**（R7）：中文输入法把「shen」上屏成「沈」的过程里，
 *   `onChange` 已经带着拼音在跳，防抖 350ms 一到就会提交半截；某些输入法用 Enter
 *   选词，`onSearch` 也会跟着触发。两层守卫各管一条路：`compositionstart/end`
 *   管住防抖这条，`event.nativeEvent.isComposing` 管住 Enter 那条。
 */
import { Input } from "antd";
import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 输入停顿多久后自动提交（毫秒）：打字节奏的停顿与"感知不到延迟"之间的常用值。 */
export const SEARCH_DEBOUNCE_MS = 350;

/**
 * 事件是否发生在"输入法还在组字"的这一刻。
 *
 * 参数类型写成 `unknown` 而不是 antd 的联合事件类型：`Input.Search.onSearch` 的第二个
 * 参数可能是 change / click / keyboard 三种事件，只有 keyboard 那种带 `isComposing`，
 * 用具体类型会为了一个可选字段和 antd 的类型定义打架。这里只做运行时探测。
 */
function isComposingEvent(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const native = (event as { nativeEvent?: { isComposing?: unknown } }).nativeEvent;
  return Boolean(native?.isComposing);
}

interface Props {
  /** 已生效的关键词（来自 URL / 页面状态）：外部变化时回填输入框。 */
  keyword: string;
  /** 提交关键词：页面负责写 keyword 状态并把分页回到第 1 页（不动其它筛选）。 */
  onCommit: (value: string) => void;
  debounceMs?: number;
  placeholder?: string;
  width?: number;
}

export default function ResumeSearchInput({
  keyword,
  onCommit,
  debounceMs = SEARCH_DEBOUNCE_MS,
  placeholder,
  width = 300,
}: Props) {
  useLocale();
  const [draft, setDraft] = useState(keyword);
  /** 输入法正在组字（拼音阶段）：期间既不提交、也不让防抖计时器跑完。 */
  const [composing, setComposing] = useState(false);
  // 外部 keyword 变化（URL 深链恢复 / 页面重置）同步回输入框：渲染期守卫，避免 effect 级联。
  const [prevKeyword, setPrevKeyword] = useState(keyword);
  if (prevKeyword !== keyword) {
    setPrevKeyword(keyword);
    setDraft(keyword);
  }

  useEffect(() => {
    // R7：组字期间不排定时器。`composing` 变回 false（compositionend）时本 effect 会
    // 重跑，那时 draft 才是上屏后的真值，于是"选完词只发一次请求"。
    if (composing) return;
    if (draft === keyword) return;
    const timer = window.setTimeout(() => onCommit(draft), debounceMs);
    return () => window.clearTimeout(timer);
  }, [draft, keyword, onCommit, debounceMs, composing]);

  /** Enter / 点搜索按钮：立即提交（同时更新草稿，防抖 effect 随即空转）。 */
  const commit = (value: string, event?: unknown) => {
    // 组字中点 Enter 是"选词/上屏"，不是"搜索"；有些输入法不会发 compositionend 之前
    // 就触发 onSearch，所以这一层不能只靠 `composing`。
    if (composing || isComposingEvent(event)) return;
    setDraft(value);
    onCommit(value);
  };

  return (
    <Input.Search
      placeholder={placeholder ?? t("resumes.search.placeholder")}
      allowClear
      style={{ width }}
      value={draft}
      onChange={(event) => {
        const value = event.target.value;
        setDraft(value);
        // 清空立即生效（点 × 与退格到空同一条路径）；非空交给上面的防抖。
        // 组字中的空串不算"用户清空筛选"——上屏后 effect 会按最终值走一次。
        if (value === "" && !composing) onCommit("");
      }}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={() => setComposing(false)}
      onSearch={commit}
    />
  );
}
