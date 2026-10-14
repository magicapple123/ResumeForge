import { createHash } from "node:crypto";
import { expect } from "@playwright/test";
import { activateMain, BACKEND_URL, createDataset, deleteDataset, dismissGuide, test } from "./helpers";

test("two real tabs keep the stale edit draft and cannot overwrite a same-ID job after A-B-A", async ({ page, api, context }) => {
  const a = await createDataset(api, "虚构双标签A");
  let b: string | undefined;
  const tabB = await context.newPage();
  try {
    const jobA = await api.post(`${BACKEND_URL}/api/jobs`, {
      data: { title: "虚构岗位A", description: "虚构岗位描述", note: "original A" },
    });
    expect(jobA.ok()).toBeTruthy();
    const idA = (await jobA.json()).id as number;
    await page.goto("/jobs");
    await dismissGuide(page);
    await page.getByText("虚构岗位A", { exact: true }).first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑岗位" });
    await expect(editor).toBeVisible();
    const draft = editor.getByLabel("备注（选填）", { exact: true });
    await draft.fill("stale synthetic draft retained");

    b = await createDataset(api, "虚构双标签B");
    const jobB = await api.post(`${BACKEND_URL}/api/jobs`, {
      data: { title: "虚构岗位B", description: "虚构岗位描述", note: "original B" },
    });
    expect(jobB.ok()).toBeTruthy();
    expect((await jobB.json()).id).toBe(idA);
    await tabB.goto("/jobs");
    await expect(tabB.getByText("虚构岗位B", { exact: true }).first()).toBeVisible();

    for (const expectedNote of ["original B", "original A"]) {
      const response = page.waitForResponse((item) => item.url().endsWith(`/api/jobs/${idA}`) && item.request().method() === "PUT");
      await editor.getByRole("button", { name: /保\s*存/ }).click();
      expect((await response).status()).toBe(409);
      await expect(draft).toHaveValue("stale synthetic draft retained");
      expect((await (await api.get(`${BACKEND_URL}/api/jobs/${idA}`)).json()).note).toBe(expectedNote);
      if (expectedNote === "original B") {
        expect((await api.post(`${BACKEND_URL}/api/settings/datasets/${a}/activate`)).ok()).toBeTruthy();
      }
    }
  } finally {
    await tabB.close();
    await page.close();
    await activateMain(api);
    await deleteDataset(api, a);
    if (b) await deleteDataset(api, b);
  }
});

test("a purged source resume is discoverable and downloadable from the independent archive UI", async ({ page, api, scopedDataset }) => {
  void scopedDataset;
  const created = await api.post(`${BACKEND_URL}/api/resumes/manual`, {
    data: { title: "虚构已删原件的交付证据", content: { name: "虚构测试员", summary: "虚构完整内容" } },
  });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).id as number;
  const track = await api.post(`${BACKEND_URL}/api/tracker`, {
    data: { company: "虚构公司", title: "虚构岗位", resume_id: id },
  });
  expect(track.ok()).toBeTruthy();
  expect((await api.delete(`${BACKEND_URL}/api/resumes/${id}`)).ok()).toBeTruthy();
  expect((await api.delete(`${BACKEND_URL}/api/trash/resume/${id}`)).ok()).toBeTruthy();
  expect((await api.get(`${BACKEND_URL}/api/resumes/${id}`)).status()).toBe(404);

  await page.goto("/resumes");
  await dismissGuide(page);
  await page.getByRole("button", { name: "交付存档", exact: true }).click();
  const archive = page.getByRole("dialog", { name: "交付存档", exact: true });
  await expect(archive.getByText("虚构已删原件的交付证据", { exact: true })).toBeVisible();
  await expect(archive.getByText(/彻底删除不清除交付快照/)).toBeVisible();
  const [download, response] = await Promise.all([
    page.waitForEvent("download"),
    page.waitForResponse((item) => /\/deliveries\/\d+\/download$/.test(item.url())),
    archive.getByRole("button", { name: "下载存档" }).click(),
  ]);
  const bytes: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) bytes.push(chunk as Buffer);
  const payload = Buffer.concat(bytes);
  expect(payload.toString("utf8")).toContain("虚构测试员");
  expect(createHash("sha256").update(payload).digest("hex")).toBe(response.headers()["x-content-sha256"]);
});
