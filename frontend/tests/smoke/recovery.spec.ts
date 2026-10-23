import { expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  BACKEND_URL,
  dismissGuide,
  ensureProfile,
  listResumes,
  setLlmConfig,
  test,
} from "./helpers";
import { startLlmStub, type LlmStub } from "./llmStub";

/**
 * 生成链路异常与恢复三态（RF-22）：真实浏览器 + 本机 LLM stub。
 *
 * LLM 调用发生在后端进程内，page.route 拦不到——用 llmStub 起本机 OpenAI 兼容
 * 服务，经设置 API 把 LLM 配置写进**当前专属数据集**指向 stub（一份数据集就是
 * 一整份数据库，设置也在里面，teardown 删库自动复位，不污染其它数据集）。
 *
 * 入口说明（2026-10-24）：「我的资料」页的通用简历区块（含「AI 生成」按钮）已随
 * GeneralResumeSection 一并下线，生成弹窗现在的唯一 UI 入口是岗位广场行上的
 * 「生成简历」（按岗位生成，弹窗内没有名称输入框，落库标题由后端按
 * `姓名-公司-岗位-时间戳` 自动生成）。恢复三态（后台继续/取消/断流重试）是
 * 弹窗级行为，与岗位无关，因此改走按岗位生成覆盖同一组路径。
 *
 * 重启恢复（后端重启后任务续跑）不在 smoke 层做：需要重启后端进程的编排，
 * 由既有 pytest 层 test_resume_generate_recovery.py 覆盖；这里补的是浏览器里
 * "关弹窗后台继续 / 取消 / 断流报错可重试"三条真实交互路径。
 */

let stub: LlmStub;

test.beforeAll(async () => {
  stub = await startLlmStub();
});

test.afterAll(async () => {
  await stub.close();
});

/** 建一个最小岗位（title 必填）；生成弹窗经它的行操作打开。 */
async function ensureJob(api: APIRequestContext) {
  const created = await api.post(`${BACKEND_URL}/api/jobs`, { data: { title: "冒烟岗位" } });
  expect(created.ok()).toBeTruthy();
}

/** 打开按岗位生成弹窗（岗位广场行上的「生成简历」入口），返回弹窗定位器。 */
async function openGenerateDialog(page: Page) {
  await page.goto("/jobs");
  await dismissGuide(page);
  await clickRowGenerate(page);
  return page.getByRole("dialog").filter({ hasText: "为「冒烟岗位」生成简历" });
}

/**
 * 点行上的「生成简历」。必须 exact：后台任务提醒的取消图标钮 aria-label 是
 * 「取消为「岗位」生成简历」，子串匹配会撞上 strict mode 双命中。
 */
async function clickRowGenerate(page: Page) {
  await page.getByRole("button", { name: "生成简历", exact: true }).click();
}

/** 在弹窗里点「开始生成」，同时捕获任务创建响应拿到 task id。 */
async function startGeneration(page: Page) {
  const dialog = page.getByRole("dialog").filter({ hasText: "为「冒烟岗位」生成简历" });
  const taskResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/resumes/generate/tasks") &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "开始生成" }).click();
  const taskResponse = await taskResponsePromise;
  expect(taskResponse.ok()).toBeTruthy();
  const task = (await taskResponse.json()) as { id: number };
  return { dialog, taskId: task.id };
}

test("生成中关闭弹窗：任务后台完成，重开弹窗接着显示进度并进入预览", async ({
  page,
  api,
  scopedDataset,
}) => {
  void scopedDataset;
  await ensureProfile(api);
  await ensureJob(api);
  await setLlmConfig(api, stub.url, "stub-slow");

  const dialog = await openGenerateDialog(page);
  const { taskId } = await startGeneration(page);
  // 进入生成中阶段后关闭弹窗 = 后台继续（不是取消）。
  await expect(dialog.getByText("生成已在后台开始")).toBeVisible();
  await dialog.getByRole("button", { name: "后台继续（关闭弹窗）" }).click();
  await expect(dialog).toHaveCount(0);

  // 任务仍在跑：重新打开弹窗应接着显示进度，而不是回到配置页。
  await clickRowGenerate(page);
  await expect(dialog.getByText("生成已在后台开始")).toBeVisible();

  // stub 慢速输出完毕 → 任务 completed → 弹窗自动进入预览（生成产物可见，
  // 这同时是 RF-16 的"后台完成有结果"联动断言）。
  await expect(dialog.getByRole("button", { name: /完\s*成/ })).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole("button", { name: /完\s*成/ }).click();

  // 落库标题是后端自动拼的「姓名-公司-岗位-时间戳」，断言岗位名在其中即可。
  const resumes = await listResumes(api);
  expect(resumes.total).toBe(1);
  expect(resumes.items[0]?.title).toContain("冒烟岗位");
  expect(taskId).toBeGreaterThan(0);
});

test("生成中取消：任务 cancelled，简历不落库", async ({ page, api, scopedDataset }) => {
  void scopedDataset;
  await ensureProfile(api);
  await ensureJob(api);
  await setLlmConfig(api, stub.url, "stub-slow");

  const dialog = await openGenerateDialog(page);
  const { taskId } = await startGeneration(page);
  await expect(dialog.getByText("生成已在后台开始")).toBeVisible();
  await dialog.getByRole("button", { name: "取消生成" }).click();

  // 取消后回到配置页（message.info「已取消生成」是瞬态提示，不作为判据）。
  await expect(dialog.getByRole("button", { name: "开始生成" })).toBeVisible({ timeout: 20_000 });

  const taskState = await api.get(`${BACKEND_URL}/api/resumes/generate/tasks/${taskId}`);
  expect(taskState.ok()).toBeTruthy();
  expect(((await taskState.json()) as { status: string }).status).toBe("cancelled");

  // 专属数据集原本就是空库：取消不落库 = 简历列表一条都没有。
  const resumes = await listResumes(api);
  expect(resumes.total).toBe(0);
});

test("模型断流：任务失败进入错误态，恢复后可重试成功", async ({ page, api, scopedDataset }) => {
  void scopedDataset;
  await ensureProfile(api);
  await ensureJob(api);
  await setLlmConfig(api, stub.url, "stub-broken");

  const dialog = await openGenerateDialog(page);
  const { taskId } = await startGeneration(page);
  // stub 半途断开连接 → 任务 failed → 弹窗进入错误态（错误信息 + 重试入口）。
  await expect(dialog.getByRole("button", { name: "重新生成" })).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole("alert").first()).toBeVisible();

  const taskState = await api.get(`${BACKEND_URL}/api/resumes/generate/tasks/${taskId}`);
  expect(taskState.ok()).toBeTruthy();
  expect(((await taskState.json()) as { status: string }).status).toBe("failed");
  expect((await listResumes(api)).total).toBe(0);

  // stub 换回正常模式（只改配置里的模型名）→ 点「重新生成」→ 这次走完进预览。
  await setLlmConfig(api, stub.url, "stub-ok");
  await dialog.getByRole("button", { name: "重新生成" }).click();
  await expect(dialog.getByRole("button", { name: /完\s*成/ })).toBeVisible({ timeout: 60_000 });

  const resumes = await listResumes(api);
  expect(resumes.total).toBe(1);
});
