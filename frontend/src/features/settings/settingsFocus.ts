// SPDX-License-Identifier: Apache-2.0
/**
 * 搜索命中后的**定位与高亮**：滚到那张卡，并给它 2 秒的边框高亮。
 *
 * 为什么按标题文字找、而不是给 31 张卡各加一个 id：卡是各自独立的组件，加 id 要改 31 个
 * 文件（其中有别的任务正在改的卡），而索引里本来就有标题键——用标题找是零侵入的。
 * 标题来自同一份语言包，所以中英文界面下都能对上。
 */
const HIGHLIGHT_CLASS = "settings-card-target";
const HIGHLIGHT_MS = 2000;

/** 卡片的标题节点 → 整张卡；`Typography.Title` / 按钮这类非 Card 块退回自身。 */
function findSettingsCard(title: string): HTMLElement | null {
  // 只搜当前可见的那一组：非活动组仍留在 DOM 里（保留各自的取数状态），
  // 全文档搜会命中别的组里同名标题的卡。
  const scope =
    document.querySelector<HTMLElement>(".settings-section:not([hidden])") ?? document.body;
  const heads = scope.querySelectorAll<HTMLElement>(".ant-card-head-title");
  for (const head of heads) {
    if ((head.textContent ?? "").trim() === title) {
      return head.closest<HTMLElement>(".ant-card");
    }
  }
  const blocks = scope.querySelectorAll<HTMLElement>("h5, .ant-card, button");
  for (const block of blocks) {
    if ((block.textContent ?? "").trim() === title) {
      return block.closest<HTMLElement>(".ant-card, button");
    }
  }
  return null;
}

/**
 * 定位并高亮。找不到目标时静默返回：分组已经切过去了，用户至少能看到那一页。
 * 返回是否命中，便于测试断言"确实滚到了"。
 */
export function revealSettingsCard(title: string): boolean {
  const target = findSettingsCard(title);
  if (target === null) return false;
  target.scrollIntoView?.({ block: "start", behavior: "smooth" });
  // 同一张卡连点两次时也要重放动画：先摘掉、强制一次 reflow、再挂上。
  target.classList.remove(HIGHLIGHT_CLASS);
  void target.offsetWidth;
  target.classList.add(HIGHLIGHT_CLASS);
  window.setTimeout(() => target.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_MS);
  return true;
}
