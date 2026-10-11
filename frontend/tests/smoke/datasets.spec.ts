import { expect } from "@playwright/test";
import {
  BACKEND_URL,
  activateMain,
  createDataset,
  deleteDataset,
  dismissGuide,
  test,
} from "./helpers";

/**
 * 数据集备份恢复与隔离（RF-22）：全部经应用自己的数据集 API 操作，UI 只做
 * "数据真的回来了"的可见性验证。数据集激活是后端全局状态，用例收尾一律
 * 切回主数据集再删自己的库，给后续用例留一个干净的激活态。
 */

async function listJobTitles(api: import("@playwright/test").APIRequestContext): Promise<string[]> {
  const response = await api.get(`${BACKEND_URL}/api/jobs?page=1&page_size=50`);
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { items: { title: string }[] };
  return payload.items.map((item) => item.title);
}

test("备份导出→删除→导入恢复：岗位数据完整回来", async ({ page, api }) => {
  // A：写入一条岗位的"有数据的库"，导出为备份包。
  const datasetA = await createDataset(api, "冒烟-备份源");
  const jobCreated = await api.post(`${BACKEND_URL}/api/jobs`, {
    data: { title: "备份演练岗位", company: "冒烟备份公司" },
  });
  expect(jobCreated.ok()).toBeTruthy();

  const exported = await api.get(`${BACKEND_URL}/api/settings/datasets/${datasetA}/export`);
  expect(exported.ok()).toBeTruthy();
  const zip = Buffer.from(await exported.body());
  // zip 头部 magic bytes：导出链路给到的必须是合法备份包。
  expect(zip.subarray(0, 2).toString("latin1")).toBe("PK");

  // 删除要求"非当前激活"：切到一个中转空库再删 A（主数据不受影响）。
  const datasetB = await createDataset(api, "冒烟-腾位");
  await deleteDataset(api, datasetA);

  // 导入备份包 → 落成一份新数据集（不自动激活）→ 激活。
  const imported = await api.post(`${BACKEND_URL}/api/settings/datasets/import?name=冒烟-恢复`, {
    headers: { "Content-Type": "application/zip" },
    data: zip,
  });
  expect(imported.ok()).toBeTruthy();
  const restored = (await imported.json()) as { id: string };
  const activated = await api.post(`${BACKEND_URL}/api/settings/datasets/${restored.id}/activate`);
  expect(activated.ok()).toBeTruthy();

  // API 断言 + UI 断言：数据真的回来了。
  expect(await listJobTitles(api)).toContain("备份演练岗位");
  await page.goto("/jobs");
  await dismissGuide(page);
  await expect(page.getByText("备份演练岗位").first()).toBeVisible();

  // 收尾：切回主数据集再删掉用例库（激活中的数据集不允许删除）。
  await activateMain(api);
  await deleteDataset(api, restored.id);
  await deleteDataset(api, datasetB);
});

test("数据集隔离：切走再切回，数据各归各", async ({ page, api }) => {
  // A 里写一条岗位；切到空库 B 后它不可见，切回 A 数据还在。
  const datasetA = await createDataset(api, "冒烟-隔离A");
  const jobCreated = await api.post(`${BACKEND_URL}/api/jobs`, {
    data: { title: "隔离岗位A" },
  });
  expect(jobCreated.ok()).toBeTruthy();

  // createDataset 语义：建完即激活，所以现在已经在空库 B 里。
  const datasetB = await createDataset(api, "冒烟-隔离B");
  expect(await listJobTitles(api)).not.toContain("隔离岗位A");

  // UI 侧同样看不到（岗位广场空态，不出现 A 的岗位）。
  await page.goto("/jobs");
  await dismissGuide(page);
  await expect(page.getByText("隔离岗位A")).toHaveCount(0);

  await api.post(`${BACKEND_URL}/api/settings/datasets/${datasetA}/activate`);
  expect(await listJobTitles(api)).toContain("隔离岗位A");
  // 已打开的页面不会自己感知切换：重新加载后再验证 A 的数据可见。
  await page.reload();
  await dismissGuide(page);
  await expect(page.getByText("隔离岗位A").first()).toBeVisible();

  await activateMain(api);
  await deleteDataset(api, datasetA);
  await deleteDataset(api, datasetB);
});
