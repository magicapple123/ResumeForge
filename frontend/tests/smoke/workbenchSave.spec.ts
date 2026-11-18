import { expect, type Page } from "@playwright/test";
import { dismissGuide, ensureProfile, test } from "./helpers";

/**
 * 制作台整体保存的**真实浏览器**证据（QW-2）。
 *
 * jsdom 用例（ResumeWorkbenchOverallSave.test.tsx）在 pipeline 层注入 rejection，已经钉住了
 * 状态机的两维结果；这里补的是浏览器 + 真实 HTTP 层那一段：用 `page.route` 把
 * `PUT /api/resumes/:id/content` 直接打成 500，验证：
 * 1. 版式那一步已落库、正文 500 时，动作条只出一条「版式已保存，正文未保存」；
 * 2. 「重试正文」可点，解掉拦截后只重发正文那一步（版式不再 PATCH 第二次）。
 *
 * 进入制作台的路径走用户真实的"新建简历 → 前往简历制作台"（空白草稿），
 * 不依赖预置数据；专属数据集由 scopedDataset fixture 建/删。
 */

/** 新建空白简历并直接进制作台（返回制作台 dialog）。 */
async function openBlankWorkbench(page: Page) {
  await page.goto("/resumes");
  await dismissGuide(page);
  await page.getByRole("button", { name: "新建简历" }).click();
  const creation = page.getByRole("dialog", { name: "从头编写通用简历" });
  await expect(creation).toBeVisible();
  await creation.getByRole("button", { name: "前往简历制作台" }).click();
  // 制作台是整页 Modal，里面还会叠自己的弹层（antd Drawer / 二次确认也是 role="dialog"），
  // 按标题文本找容器在 macOS runner 上会一次命中 3 个（Windows/Linux 只命中 1 个），
  // strict mode 直接判失败。这里改成锚在**动作条**上：本测试要断言的三样东西
  // （「保存修改」、「版式已保存，正文未保存」、「重试正文」）都在这一条里。
  const workbench = page.locator(".resume-wb-actionbar");
  await expect(workbench).toBeVisible();
  return workbench;
}

/** 改一处版式：打开第一张色卡的取色器，再点 antd 的预设色块。
 *
 * 结构随 I-09 变过一次：**2×2 色卡 + 单一取色器**（原来是"手风琴 + 四下色块列表"），
 * 旧的 `.resume-wb-swatches` / `.resume-wb-color-toggle` 已经不存在了。
 * 取色器只有一个实例、随 `pickerKey` 移动，所以"已经开着"就不要再点卡（会把它关掉）。
 */
async function changeLayout(page: Page) {
  if ((await page.locator(".ant-color-picker-presets-color").count()) === 0) {
    await page.locator(".resume-wb-color-main").first().click();
  }
  await page.locator(".ant-color-picker-presets-color").first().click();
}

/** 改一处正文：双击展开页眉的「名称」chip（预填值来自资料），再填新值。 */
async function changeName(page: Page, current: string, value: string) {
  const chip = page.getByRole("group", { name: new RegExp(current) }).first();
  const main = chip.getByRole("button").first();
  if ((await main.getAttribute("aria-expanded")) !== "true") await main.dblclick();
  await page.getByRole("textbox", { name: "名称" }).fill(value);
}

test("版式成功、正文 500：只出一条部分成功提示，重试正文才继续", async ({
  page,
  api,
  scopedDataset,
}) => {
  void scopedDataset;
  // 资料非空，新建弹窗才会预填「姓名」页眉字段（否则空白草稿没有可编辑的正文）。
  await ensureProfile(api);
  await page.setViewportSize({ width: 1440, height: 900 });
  const workbench = await openBlankWorkbench(page);

  await changeLayout(page);
  await changeName(page, "冒烟测试员", "冒烟测试员二号");
  const save = workbench.getByRole("button", { name: "保存修改" });
  await expect(save).toBeVisible();

  let contentAttempts = 0;
  let layoutAttempts = 0;
  let contentRequests = 0;
  await page.route("**/api/resumes/*/content", async (route) => {
    contentAttempts += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "injected failure" }),
    });
  });
  page.on("request", (request) => {
    if (request.method() === "PUT" && /\/api\/resumes\/\d+\/content$/.test(request.url())) {
      contentRequests += 1;
    }
    if (request.method() === "PATCH" && /\/api\/resumes\/\d+\/layout$/.test(request.url())) {
      layoutAttempts += 1;
    }
  });

  await save.click();

  // 只这一条，且不再出现笼统的「保存失败」。
  const partial = workbench.getByText("版式已保存，正文未保存");
  await expect(partial).toBeVisible();
  await expect(workbench.getByText("保存没有成功", { exact: false })).toHaveCount(0);
  await expect(workbench.getByRole("button", { name: "重试正文" })).toBeEnabled();
  expect(contentAttempts).toBe(1);
  expect(contentRequests).toBe(1);
  expect(layoutAttempts).toBe(1);

  // 解除拦截 → 重试：只重发正文，版式保持已落库的基线。
  await page.unroute("**/api/resumes/*/content");
  await workbench.getByRole("button", { name: "重试正文" }).click();
  await expect(partial).toHaveCount(0);
  await expect.poll(() => contentRequests).toBe(2);
  expect(contentAttempts).toBe(1);
  expect(layoutAttempts).toBe(1);
});
