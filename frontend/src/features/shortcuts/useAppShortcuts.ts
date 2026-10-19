/**
 * App 级快捷键落点（R8）：新建简历、切换数据集、翻页、聚焦助手。
 *
 * 为什么单独一个 hook 而不是写在 `App.tsx` 里：那里已经接近 500 行预算，而且这四件事
 * 全是"按了之后转交给谁"的编排逻辑，和布局、路由没有关系。放进 hook 后既能单独测试，
 * 也让 App 只留一行调用。
 *
 * 统一原则：**落点不存在就不拦截按键**——宁可让浏览器拿走，也不要吞掉一个什么都没
 * 发生的按键。
 */
import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { clickPaginationStep, triggerDatasetMenu, triggerNewResume } from "./runtimeTargets";
import { useShortcut } from "./useShortcutKeymap";

/**
 * ``openAssistant`` 由 App 传入：悬浮助手卡的开关是 App 的状态，hook 不该自己再存一份。
 * 路由信息在 hook 内部取（`useNavigate` / `useLocation`），调用方只传一个回调。
 */
export function useAppShortcuts(openAssistant: () => void): void {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const openNewResume = useCallback(() => {
    if (triggerNewResume()) return;
    // 不在简历页：先跳过去，等页面登记完落点再触发（最多重试 6 帧）。
    let attempts = 6;
    const tryOpen = () => {
      if (triggerNewResume()) return;
      attempts -= 1;
      if (attempts > 0) window.requestAnimationFrame(tryOpen);
    };
    window.requestAnimationFrame(tryOpen);
  }, []);

  useShortcut("newResume", (event) => {
    event.preventDefault();
    if (pathname === "/resumes") {
      openNewResume();
      return;
    }
    void navigate("/resumes");
    openNewResume();
  });

  useShortcut("switchDataset", (event) => {
    if (triggerDatasetMenu()) event.preventDefault();
  });

  // 翻页不逐页登记：直接点当前页面上的 antd 分页按钮（所有列表页通用）。
  useShortcut("prevPage", (event) => {
    if (clickPaginationStep("prev")) event.preventDefault();
  });
  useShortcut("nextPage", (event) => {
    if (clickPaginationStep("next")) event.preventDefault();
  });

  useShortcut("focusAssistant", (event) => {
    event.preventDefault();
    openAssistant();
    // 卡片异步挂载：等它出现再聚焦输入框，否则 focus 打在还没渲染的元素上。
    window.setTimeout(() => {
      const field = document.querySelector<HTMLElement>(
        ".tt-shell textarea, .tt-shell input, .tt-shell [contenteditable='true']",
      );
      field?.focus();
    }, 80);
  });
}
