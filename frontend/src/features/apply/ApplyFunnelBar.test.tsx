// SPDX-License-Identifier: Apache-2.0
/**
 * #14F 页头漏斗条的单测：四个数字 + 点击下钻。
 *
 * 判据里最容易错的两处：
 * 1. 四个数字必须来自 `/apply/summary`，不是前端自己数（口径在后端，前端重算就会漂）；
 * 2. 接口读不到时**整条不渲染**——它是增强信息，不该在页头挂一行报错。
 * 3. 「最近 7 天」这层上下文必须真的通过 `aria-describedby` 接上（见第三条用例）。
 *    为什么要有这条：CI 的 axe 只在中文跑，而 `label-content-name-mismatch` 只有英文会红
 *    （中文 `已投递0` 会被分词器切成两段，属侥幸），所以用单测把"描述接线"这个结构钉住，
 *    不依赖那条规则在哪个语言下被执行。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getApplySummary: vi.fn(),
}));

vi.mock("../../api/applyExtras", () => ({
  getApplySummary: apiMocks.getApplySummary,
}));

import { t } from "../../i18n";
import ApplyFunnelBar, { FUNNEL_DAYS } from "./ApplyFunnelBar";

function renderBar(onDrill = vi.fn()) {
  const view = render(
    <AntdApp>
      <ApplyFunnelBar onDrill={onDrill} />
    </AntdApp>,
  );
  return { ...view, onDrill };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getApplySummary.mockResolvedValue({
    applied: 12,
    succeeded: 7,
    failed: 3,
    interviewing: 2,
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ApplyFunnelBar 四个数字", () => {
  it("按后端给的四个值渲染，窗口是 7 天", async () => {
    renderBar();

    expect(await screen.findByText(t("applyUi.funnel.applied"))).toBeInTheDocument();
    expect(screen.getByText(t("applyUi.funnel.succeeded"))).toBeInTheDocument();
    expect(screen.getByText(t("applyUi.funnel.failed"))).toBeInTheDocument();
    expect(screen.getByText(t("applyUi.funnel.interviewing"))).toBeInTheDocument();
    // 数字本身也要如实显示（不是从别处算出来的）。
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(t("applyUi.funnel.hint", { days: FUNNEL_DAYS }))).toBeInTheDocument();
    expect(apiMocks.getApplySummary).toHaveBeenCalledWith(FUNNEL_DAYS);
  });

  it("点四个数字分别带上对应的下钻维度", async () => {
    const { onDrill } = renderBar();

    const drills = [
      [t("applyUi.funnel.applied"), "applied"],
      [t("applyUi.funnel.succeeded"), "succeeded"],
      [t("applyUi.funnel.failed"), "failed"],
      [t("applyUi.funnel.interviewing"), "interviewing"],
    ] as const;

    for (const [label, expected] of drills) {
      const button = await screen.findByRole("button", { name: new RegExp(label) });
      fireEvent.click(button);
      expect(onDrill).toHaveBeenLastCalledWith(expected);
    }
    expect(onDrill).toHaveBeenCalledTimes(4);
  });

  it("接口读不到时整条不渲染（不在页头挂一行错误）", async () => {
    apiMocks.getApplySummary.mockRejectedValue(new Error("summary 挂了"));

    const { container } = renderBar();

    // 等一轮微任务，确认不是"还没渲染"造成的假阴性。
    await Promise.resolve();
    expect(container.querySelector(".apply-funnel-bar")).toBeNull();
    expect(screen.queryByText(t("applyUi.funnel.applied"))).not.toBeInTheDocument();
  });

  it("四枚指标都通过 aria-describedby 接上「最近 7 天」那句描述", async () => {
    const { container } = renderBar();

    // 收窄到组件容器再查：`screen.findAllByRole` 是整文档范围，今天恰好只有这 4 枚按钮
    // 才成立；一旦外层或 antd 再渲染出别的按钮，断言就会在"不是本组件的问题"上翻车。
    // 接口未落地时整条不渲染，所以先 findAll 等它出现（不是 getAll 直接取，避免 0 枚假阴性）。
    const buttons = await within(container).findAllByRole("button");
    expect(buttons).toHaveLength(4);

    // 名字必须来自可见文字，**绝不能**再写 aria-label：axe 的 `label-content-name-mismatch`
    // 只在英文暴露（中文 `已投递0` 会被分词器切成两段，中文基线抓不到），所以"不写 aria-label"
    // 这件事只能靠这条单测钉住——否则日后有人加回 aria-label（哪怕 describedby 还在），
    // 下面几条仍会全绿，而英文 axe 会重新变红。
    expect(buttons.every((button) => !button.hasAttribute("aria-label"))).toBe(true);

    // 四枚共用同一句 hint，因此描述 id 必须非空且**完全相同**——这是有意的设计，
    // 不是漏给每枚按钮写各自的描述。
    const describedIds = buttons.map((button) => button.getAttribute("aria-describedby"));
    for (const id of describedIds) {
      expect(id).toBeTruthy();
    }
    expect(new Set(describedIds).size).toBe(1);

    // 光有 id 不算"接线成功"：被指向的节点必须真的存在于 DOM，且内容是那句 hint。
    // 这里刻意用 document 级查询——要验证的正是"这个 id 在全文档里能被解析到"。
    const hintNode = document.getElementById(describedIds[0] as string);
    expect(hintNode).not.toBeNull();
    expect(hintNode?.textContent).toContain(t("applyUi.funnel.hint", { days: FUNNEL_DAYS }));
  });
});
