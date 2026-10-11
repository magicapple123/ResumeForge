import {
  expect,
  request as playwrightRequest,
  test as base,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * 浏览器冒烟共享基建（RF-22）。
 *
 * - `dismissGuide`：首启动引导在全新浏览器上下文里必然弹出，统一等它出现再关掉
 *   （与既有 smoke.spec.ts 的内联实现同款，收敛到一处）。
 * - `scopedDataset`：每个用例经 API 自建一份专属空数据集并激活，teardown 删掉。
 *   激活态是后端全局状态，sample/load 那种"只建不删"的模式会让示例数据跨用例
 *   累积；专属数据集让新用例可以精确断言（列表为空/恰好一条）。
 * - `api`：一个用例生命周期的 APIRequestContext，免每个用例自己 new/dispose。
 *
 * 注意：一份数据集就是一整份数据库（岗位、资料、简历、**设置**全在里面），所以
 * 用例期间经 `PUT /api/settings/llm` 写入的 LLM 配置落在专属数据集库内，teardown
 * 删库即自动复位，无需读取并恢复原配置（原 GET 返回的是掩码密钥，回写反而会写坏）。
 */

export const BACKEND_URL = process.env.SMOKE_BACKEND_URL ?? "http://127.0.0.1:8123";

/** 等首启动引导弹出并关闭它；引导是 mount 后异步打开的，必须显式等。 */
export async function dismissGuide(page: Page) {
  const guide = page.getByRole("dialog").filter({ hasText: "欢迎使用简历通" });
  await guide.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
  if (await guide.isVisible().catch(() => false)) {
    await guide.getByRole("button", { name: /稍后查看/ }).click();
  }
  await expect(guide).toHaveCount(0);
}

/** 新建一份空数据集并激活（createDataset 语义：返回的就是"当前正在用"的那份）。 */
export async function createDataset(api: APIRequestContext, name: string): Promise<string> {
  const created = await api.post(`${BACKEND_URL}/api/settings/datasets`, { data: { name } });
  expect(created.ok()).toBeTruthy();
  const { id } = (await created.json()) as { id: string };
  const activated = await api.post(`${BACKEND_URL}/api/settings/datasets/${id}/activate`);
  expect(activated.ok()).toBeTruthy();
  return id;
}

/** 切回主数据集；删除数据集要求它不是当前激活的那份。 */
export async function activateMain(api: APIRequestContext) {
  const activated = await api.post(`${BACKEND_URL}/api/settings/datasets/main/activate`);
  expect(activated.ok()).toBeTruthy();
}

/** 删除一份数据集（后端移入回收目录，不做永久删除）。 */
export async function deleteDataset(api: APIRequestContext, id: string) {
  const removed = await api.delete(`${BACKEND_URL}/api/settings/datasets/${id}`);
  expect(removed.ok()).toBeTruthy();
}

/** 把 LLM 配置指向本机 stub server；base_url 走回环 HTTP 是后端明确允许的形态。 */
export async function setLlmConfig(api: APIRequestContext, stubBaseUrl: string, model: string) {
  const saved = await api.put(`${BACKEND_URL}/api/settings/llm`, {
    data: {
      provider: "custom",
      base_url: stubBaseUrl,
      api_key: "smoke-stub-key",
      model,
      temperature: 0.1,
    },
  });
  expect(saved.ok()).toBeTruthy();
}

/** 生成要求资料非空（姓名即可满足）；在专属数据集里填一个最小资料。 */
export async function ensureProfile(api: APIRequestContext) {
  const saved = await api.put(`${BACKEND_URL}/api/profile`, { data: { name: "冒烟测试员" } });
  expect(saved.ok()).toBeTruthy();
}

/** 简历记录列表（分页结构：{ items, total, ... }）。 */
export async function listResumes(
  api: APIRequestContext,
): Promise<{ items: { id: number; title: string }[]; total: number }> {
  const response = await api.get(`${BACKEND_URL}/api/resumes?page=1&page_size=50`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { items: { id: number; title: string }[]; total: number };
}

interface SmokeFixtures {
  api: APIRequestContext;
  /** 当前用例专属的空数据集 id；已激活，teardown 自动切回主数据并删除。 */
  scopedDataset: string;
}

// Playwright fixture 协议的 use(...) 形似 React Hook 但不是 Hook，插件按 React
// 规则误判；本文件是唯一的 fixture 定义处，豁免范围收敛在这里。
/* eslint-disable react-hooks/rules-of-hooks -- Playwright fixture 的 use 不是 React Hook */
export const test = base.extend<SmokeFixtures>({
  // Playwright 要求 fixture 第一个参数必须是解构模式（哪怕是空的），空模式会触发
  // no-empty-pattern——两边的约束都是硬的，只能在这里豁免。
  api: async ({}, use) => { // eslint-disable-line no-empty-pattern
    const api = await playwrightRequest.newContext();
    await use(api);
    await api.dispose();
  },
  scopedDataset: async ({ api }, use) => {
    const id = await createDataset(api, `smoke-${Date.now()}`);
    await use(id);
    await activateMain(api);
    await deleteDataset(api, id);
  },
});
