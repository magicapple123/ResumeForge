import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * 拖动排序 vs. 「松开鼠标以搜索文本」（真实 Chromium 口径，2026-11-04 用户反馈）。
 *
 * ## 为什么必须进真浏览器
 *
 * 那条浮层是 Chromium 的原生手势：**按住的位置有文本选区**，松手就落成"拖动这段文字"。
 * jsdom 既不算布局、也不发原生拖拽，`getSelection()` 永远为空——在 vitest 里这条永远是
 * 绿的，所以这里用真鼠标（down → move）钉"选区是否诞生"。文件不依赖运行中的应用：
 * 它把编辑器/结构树的**真实样式表**读进来，配一份同构的 chip / 条目头 / 结构树行 DOM，
 * 只断言 CSS 与守卫的净效果。
 *
 * ## 判据
 *
 * 1. 在 chip 的标签文字、条目头、结构树行上按住拖动：`getSelection()` 必须为空
 *    （有选区 = Chrome 会弹浮层 + 条目拖不动）；
 * 2. 在字段值 textarea 里拖选：**必须能选中**——一刀切会连"改几个字"都做不了。
 */

const STYLES = [
  "components/resume-editor/document-editor.css",
  "components/resume-editor/document-item-editor.css",
  "components/resume/structure/structure.css",
]
  .map((relative) => readFileSync([process.cwd(), "src", ...relative.split("/")].join("/"), "utf8"))
  .join("\n");

const HARNESS = `
<div class="document-editor" data-document-editor>
  <div class="document-entry">
    <div class="document-entry-head" tabindex="0">
      <span class="document-entry-index">#2</span>
      <span class="document-chip-badge">已隐藏</span>
    </div>
    <div class="document-group-block">
      <span class="document-group-block-title">标题与元信息</span>
      <div class="document-group document-group-cells">
        <div class="document-chip-slot">
          <div class="document-chip" data-document-path="education.e1.i1">
            <button type="button" class="document-chip-main" draggable="true">
              <span class="document-chip-drag">⠿</span>
              <span class="document-chip-label">公司/机构</span>
              <span class="document-chip-value">示例科技有限公司</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <div class="document-item-editor">
      <div class="document-field-row">
        <span class="document-field-label">字段值</span>
        <textarea aria-label="value" rows="2">示例科技有限公司</textarea>
      </div>
    </div>
  </div>
</div>
<div class="rf-structure-tree"><div class="rf-structure-row"><span class="rf-structure-row-label">公司/机构</span></div></div>
`;

async function mount(page: Page): Promise<void> {
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>${STYLES}</style>${HARNESS}
     <script>
       window.__dragstart = 0;
       document.querySelectorAll('[data-document-path]').forEach((chip) => {
         // 与 useBlockSelectStart 同一份守卫：容器内不许起选区。
         chip.addEventListener('selectstart', (event) => event.preventDefault());
         chip.querySelector('[draggable="true"]')?.addEventListener('dragstart', (event) => {
           window.__dragstart += 1;
           event.dataTransfer.effectAllowed = 'move';
           event.dataTransfer.setData('text/plain', chip.dataset.documentPath);
         });
       });
     </script>`,
  );
}

/** 真鼠标拖拽：按下 → 分步移动（拖拽阈值）→ 读选区 → 松手。 */
async function dragFrom(page: Page, selector: string): Promise<string> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`找不到元素：${selector}`);
  const x = box.x + 3;
  const y = box.y + box.height / 2;
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 70, y + 12, { steps: 10 });
  const selection = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  await page.mouse.up();
  return selection;
}

test("chip 文字上按住拖动不会产生选区（不弹「搜索文本」），且拖拽本身照常起效", async ({
  page,
}) => {
  await mount(page);
  expect(await dragFrom(page, ".document-chip-label")).toBe("");
  expect(await dragFrom(page, ".document-chip-value")).toBe("");
  expect(
    await page.evaluate(() => (window as unknown as { __dragstart: number }).__dragstart),
  ).toBeGreaterThan(0);
  // 显式声明：chip 内每段文字都不可选中（不靠继承）。
  for (const selector of [".document-chip-main", ".document-chip-label", ".document-chip-value"]) {
    const value = await page
      .locator(selector)
      .first()
      .evaluate((node) => getComputedStyle(node).userSelect);
    expect(value, selector).toBe("none");
  }
});

test("条目头与结构树行也不会被拖出选区", async ({ page }) => {
  await mount(page);
  expect(await dragFrom(page, ".document-entry-index")).toBe("");
  expect(await dragFrom(page, ".document-group-block-title")).toBe("");
  expect(await dragFrom(page, ".rf-structure-row-label")).toBe("");
});

test("字段值 textarea 里拖选仍然可以（不一刀切）", async ({ page }) => {
  await mount(page);
  const textarea = page.locator("textarea");
  expect(await textarea.evaluate((node) => getComputedStyle(node).userSelect)).toBe("text");
  const box = await textarea.boundingBox();
  if (!box) throw new Error("找不到 textarea");
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 6, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  const selected = await textarea.evaluate((node) => {
    const area = node as HTMLTextAreaElement;
    return area.value.slice(area.selectionStart, area.selectionEnd);
  });
  expect(selected.length).toBeGreaterThan(0);
});
