import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * 投投卡片在「弹窗开着」时的焦点行为（T3 / 台账第 1 条）。
 *
 * **必须跑在真实浏览器里**：jsdom 里 `isFixedPos` 为假（antd 的焦点陷阱要求
 * `display: flex` + 定位），陷阱根本不启用，所以单测只会给出假绿。jsdom 能测的
 * 那部分在 `src/features/tou-tou/touTouCardGuards.test.ts`。
 *
 * 前置：应用已在 `SMOKE_FRONTEND_URL`（或 playwright.config.ts 的 baseURL）活着，
 * locale 已钉中文（见配置）。用例自己开弹窗、自己开卡片，不依赖既有数据，也不写库。
 *
 * ## 四条判据（对应 brief）
 * 1. 卡片 textarea 能拿住焦点并打进字，`value` 真的含有输入；
 * 2. 卡片开着时在弹窗里按 Tab，焦点仍在 `.ant-modal` 内（证明没有"全局关陷阱"）；
 * 3. 卡片内 Esc 只收卡片、不关弹窗；再按 Esc 才关弹窗；
 * 4. 卡片 `+` 面板展开时 Esc 只收面板，卡片与弹窗都还在。
 *
 * ## 反证（改坏实验）
 *
 * 真实浏览器的反证要在**已构建的产物**上做，改源码就得重新构建，所以在守卫里留了
 * 运行时开关（`TOU_TOU_GUARD_KILL_SWITCH_KEY`）。跑：
 *
 * ```bash
 * RF_T3_DISABLE_GUARD=1 pnpm exec playwright test tests/smoke/tou-tou-focus.spec.ts -g "能拿住焦点"
 * ```
 *
 * 预期：第 1 条**精确变红**，诊断行里 `activeElement=BUTTON.ant-modal-close …`。
 * 不设该环境变量时全绿。等价于"把 focusin 拦截注释掉"。
 *
 * ## 产物
 *
 * 设 `RF_T3_EVIDENCE_DIR`（如 `deliverables/.../evidence/T3`）时，截图与 JSON 会
 * 复制到那里；不设就只留在 Playwright 的 `test-results/`（`testInfo.outputPath`）。
 */

const EVIDENCE_DIR = process.env.RF_T3_EVIDENCE_DIR ?? "";
/** 与 `TOU_TOU_GUARD_KILL_SWITCH_KEY` 同一个键；改动要两边一起改。 */
const GUARD_KILL_SWITCH_KEY = "__rfDisableTouTouFocusGuard";
/** 反证开关：`1` 表示按"守卫没装"跑（应当精确变红）。 */
const GUARD_DISABLED = process.env.RF_T3_DISABLE_GUARD === "1";

interface ActiveElementSnapshot {
  tag: string;
  cls: string;
  label: string;
  placeholder: string;
  value: string;
  inModal: boolean;
  inCard: boolean;
}

/** 当前焦点的完整快照。失败信息里带上它，反证时一眼看出"焦点落到 .ant-modal-close"。 */
async function readActiveElement(page: Page): Promise<ActiveElementSnapshot> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    const attribute = (name: string) => element?.getAttribute(name) ?? "";
    const value = (element as HTMLInputElement | HTMLTextAreaElement | null)?.value;
    return {
      tag: element?.tagName ?? "",
      cls: String(element?.className ?? "").slice(0, 120),
      label: attribute("aria-label"),
      placeholder: attribute("placeholder"),
      value: typeof value === "string" ? value.slice(0, 60) : "",
      inModal: Boolean(element?.closest(".ant-modal")),
      inCard: Boolean(element?.closest(".tt-assistant-card")),
    };
  });
}

/** 一行人话诊断：断言失败时贴进 message，红的时候不用再猜焦点在哪。 */
function describeActive(snapshot: ActiveElementSnapshot): string {
  return [
    `activeElement=<${snapshot.tag}>`,
    `class="${snapshot.cls}"`,
    `aria-label="${snapshot.label}"`,
    `placeholder="${snapshot.placeholder}"`,
    `value="${snapshot.value}"`,
    `inModal=${snapshot.inModal}`,
    `inCard=${snapshot.inCard}`,
  ].join(" ");
}

/** 把截图/JSON 落到证据目录（或 Playwright 输出目录），并附到报告上。 */
async function saveArtifacts(
  page: Page,
  testInfo: TestInfo,
  name: string,
  data: Record<string, unknown>,
): Promise<void> {
  const shotPath = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: shotPath });
  await testInfo.attach(`${name}.png`, { path: shotPath, contentType: "image/png" });

  const jsonPath = testInfo.outputPath(`${name}.json`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await testInfo.attach(`${name}.json`, { path: jsonPath, contentType: "application/json" });

  if (EVIDENCE_DIR) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.copyFileSync(shotPath, path.join(EVIDENCE_DIR, `${name}.png`));
    fs.copyFileSync(jsonPath, path.join(EVIDENCE_DIR, `${name}.json`));
  }
}

/** 关掉首启动引导（全新上下文里必然弹）。 */
async function dismissGuide(page: Page): Promise<void> {
  const guide = page.getByRole("dialog").filter({ hasText: "欢迎使用简历通" });
  await guide.waitFor({ state: "visible", timeout: 8_000 }).catch(() => {});
  if (await guide.isVisible().catch(() => false)) {
    await guide.getByRole("button", { name: /稍后查看/ }).click();
  }
}

/** 打开「跟踪进度 → 添加进度」弹窗：本卡固定的"任意 antd Modal"现场。 */
async function openTrackerModal(page: Page): Promise<void> {
  await page.goto("/tracker");
  await expect(page.locator(".app-shell")).toBeVisible();
  await dismissGuide(page);
  await page
    .getByRole("button", { name: /添加进度/ })
    .first()
    .click();
  await expect(page.locator(".ant-modal")).toBeVisible();
}

/** 点悬浮球打开投投卡片。 */
async function openAssistantCard(page: Page): Promise<void> {
  await page.locator(".tt-shell").first().click();
  await expect(page.locator(".tt-assistant-card")).toBeVisible();
  // 卡片里是懒加载的助手页面，textarea 会晚一点出现。
  await expect(page.locator(".tt-assistant-card textarea").first()).toBeVisible();
}

test.describe("投投卡片焦点豁免（弹窗开着时）", () => {
  test.beforeEach(async ({ page }) => {
    // 关掉首启动引导，免得它盖住弹窗；顺手把"已看过"写进存储，减少竞态。
    await page.addInitScript(() => {
      window.localStorage.setItem("resumeforge.user-guide.seen", "1");
    });
    if (GUARD_DISABLED) {
      // 反证：让守卫在运行期放行，等价于"把 focusin 拦截注释掉"。
      await page.addInitScript((key: string) => {
        (window as unknown as Record<string, unknown>)[key] = true;
      }, GUARD_KILL_SWITCH_KEY);
    }
  });

  test("弹窗开着时卡片输入框能拿住焦点并打进字", async ({ page }, testInfo) => {
    await openTrackerModal(page);
    await openAssistantCard(page);

    const textarea = page.locator(".tt-assistant-card textarea").first();
    // 打开即聚焦（判据 2 的另一半）：这一次不点也能直接打字。
    const afterOpen = await readActiveElement(page);
    expect(afterOpen.inCard, `打开卡片后焦点应在卡片内：${describeActive(afterOpen)}`).toBe(true);

    await textarea.click();
    const afterClick = await readActiveElement(page);
    expect(afterClick.tag, `点卡片输入框后焦点被抢走：${describeActive(afterClick)}`).toBe(
      "TEXTAREA",
    );

    await page.keyboard.type("abc", { delay: 60 });
    const afterType = await readActiveElement(page);
    // 这两条就是本卡的反证判据：守卫被关掉时焦点会停在 `.ant-modal-close`。
    expect(afterType.tag, `打字后焦点不在输入框：${describeActive(afterType)}`).toBe("TEXTAREA");
    expect(afterType.value, `输入没进到卡片里：${describeActive(afterType)}`).toContain("abc");
    await expect(textarea).toHaveValue(/abc/);

    await saveArtifacts(page, testInfo, "card-input-works", {
      scenario: "card-input",
      afterOpen,
      afterClick,
      afterType,
      guardDisabled: GUARD_DISABLED,
    });
  });

  test("卡片开着时在弹窗里按 Tab，焦点仍在弹窗内（没做成全局关陷阱）", async ({
    page,
  }, testInfo) => {
    await openTrackerModal(page);
    await openAssistantCard(page);

    const modalInput = page.locator(".ant-modal input").first();
    await modalInput.click();
    await page.keyboard.press("Tab");
    const snapshot = await readActiveElement(page);
    expect(
      snapshot.inModal,
      `Tab 后焦点跑出弹窗（说明陷阱被全局关掉了）：${describeActive(snapshot)}`,
    ).toBe(true);

    await saveArtifacts(page, testInfo, "tab-stays-in-modal", {
      scenario: "tab-in-modal",
      snapshot,
    });
  });

  test("卡片内 Esc 只收卡片，再按 Esc 才关弹窗", async ({ page }, testInfo) => {
    await openTrackerModal(page);
    await openAssistantCard(page);

    const textarea = page.locator(".tt-assistant-card textarea").first();
    await textarea.click();
    await page.keyboard.press("Escape");

    await expect(page.locator(".tt-assistant-card")).toHaveCount(0);
    // 关键：卡片收了，下层弹窗必须还在（没被 `@rc-component/portal` 的 Esc 栈一起关掉）。
    await expect(page.locator(".ant-modal")).toBeVisible();
    const afterFirstEsc = await readActiveElement(page);

    await page.keyboard.press("Escape");
    await expect(page.locator(".ant-modal")).toBeHidden();
    const afterSecondEsc = await readActiveElement(page);

    await saveArtifacts(page, testInfo, "esc-order", {
      scenario: "esc-order",
      afterFirstEsc,
      afterSecondEsc,
    });
  });

  test("卡片 `+` 面板展开时 Esc 只收面板，卡片与弹窗都还在", async ({ page }, testInfo) => {
    await openTrackerModal(page);
    await openAssistantCard(page);

    const card = page.locator(".tt-assistant-card");
    await card.locator(".composer-add-button").first().click();

    // `.composer-add-panel` 是 antd Dropdown 的浮层内容，被 **portal 到 body**，
    // 不在 `.tt-assistant-card` 子树里 —— `card.locator(".composer-add-panel")`
    // 永远命中 0 个，所以这里必须用 page 级选择器（不要为此改 `getPopupContainer`，
    // 那会把浮层塞回卡片里，改变产品行为与裁切表现）。
    const addPanel = page.locator(".composer-add-panel");
    await expect(addPanel.first()).toBeVisible();

    await page.keyboard.press("Escape");
    // 面板收起（`destroyOnHidden`，等它从 DOM 里消失）；同样是 page 级判定。
    await expect(addPanel).toHaveCount(0);
    await expect(card).toBeVisible();
    await expect(page.locator(".ant-modal")).toBeVisible();

    const snapshot = await readActiveElement(page);
    await saveArtifacts(page, testInfo, "add-menu-esc", {
      scenario: "add-menu-esc",
      snapshot,
      cardStillOpen: (await card.count()) === 1,
    });
  });
});
