import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";
import { BACKEND_URL, dismissGuide } from "./helpers";

/**
 * 交付存档的真实浏览器验收（RR-04 / RR-09）。
 *
 * jsdom 用例能证明组件会调接口，证明不了"点下去真的下载到了什么"——这条在真实
 * Chromium 里走完整链路：经 API 造一条**进度关联**的交付快照 → 在简历详情里看到
 * 「下载存档」→ 点它 → 抓下载流与响应头 → 断言 `sha256(实际字节) == X-Content-Sha256`。
 *
 * 哈希口径是 RR-04 的核心修复：以前那个头放的是存档里的旧产物哈希，用户核对不上。
 * 这里用真实下载的字节重算一遍，把"头永远指向本次返回的字节"变成浏览器级证据。
 */
test.describe.serial("交付存档", () => {
  test("简历详情里能下载投递存档，且响应头哈希与实际字节一致", async ({ page }) => {
    const api = await playwrightRequest.newContext();
    // 准备一份简历：优先用已载入的示例数据集，没有就载入一次。
    const listResumes = async () =>
      (await (await api.get(`${BACKEND_URL}/api/resumes`)).json()) as {
        items: { id: number; title: string }[];
      };
    let page1 = await listResumes();
    if (!Array.isArray(page1.items) || page1.items.length === 0) {
      const load = await api.post(`${BACKEND_URL}/api/settings/datasets/sample/load`);
      expect(load.ok()).toBeTruthy();
      page1 = await listResumes();
    }
    const resumes = page1.items;
    expect(resumes.length).toBeGreaterThan(0);
    const resume = resumes[0];

    // 造一条进度并关联这份简历：track 路径会冻结一份交付快照（不需要模型）。
    const created = await api.post(`${BACKEND_URL}/api/tracker`, {
      data: { company: "示例科技", title: `交付验收-${Date.now()}`, resume_id: resume.id },
    });
    expect(created.ok()).toBeTruthy();

    const deliveries = (await (
      await api.get(`${BACKEND_URL}/api/resumes/${resume.id}/deliveries`)
    ).json()) as { id: number }[];
    expect(deliveries.length).toBeGreaterThan(0);
    await api.dispose();

    await page.goto("/resumes");
    await dismissGuide(page);
    await page.getByText(resume.title, { exact: false }).first().click();

    const downloadButton = page.getByRole("button", { name: "下载存档" }).first();
    await expect(downloadButton).toBeVisible();

    const [download, response] = await Promise.all([
      page.waitForEvent("download"),
      page.waitForResponse((item) => /\/deliveries\/\d+\/download$/.test(item.url())),
      downloadButton.click(),
    ]);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);
    expect(bytes.length).toBeGreaterThan(0);

    const headerHash = response.headers()["x-content-sha256"];
    expect(headerHash).toBeTruthy();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(headerHash);
    // apply/track 快照还会带上"存档里那份内容"的规范化哈希（与本响应字节不同）。
    expect(response.headers()["x-source-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);
  });
});
