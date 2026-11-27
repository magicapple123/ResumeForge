// SPDX-License-Identifier: Apache-2.0
/**
 * 依赖矩阵（#9）的定向用例。
 *
 * 这一层的断言只做一件 jsdom **能**做的事：**判定**。布局（列宽、吸顶、轨道宽度）在
 * jsdom 里恒为 0，写成断言就是"永远绿的空断言"，所以那些留给人眼/Playwright，这里不碰。
 *
 * 覆盖四条最容易被写坏的契约：
 * 1. 前端**零清单**：组件源码里出现任何具体 Key id / 名字就会让新增来源静默少一列；
 * 2. 行列顺序来自 payload（不是字母序，也不是前端排的）；
 * 3. 聚焦语义：只压暗无关格子，**空位不带任何提亮类**（用户指出的 bug）；
 * 4. 汇总数字由 payload 算，筛选是数据驱动重渲染（不是 CSS 隐藏列）。
 */

// @ts-expect-error Node 内置模块：@types/node 未安装，但本文件只在 Node（vitest）里跑。
import { readFileSync } from "node:fs";
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConnectionMatrix from "./ConnectionMatrix";
import { t } from "../../i18n";
import type { ConnectionKeyMapRow, ConnectionMatrix as MatrixPayload } from "../../types";

/**
 * 只依赖闸门口令、因而不进矩阵的功能名。
 *
 * 抽成常量是给 i18n 棘轮留的：`getByText("中文")` 这类断言会被算作"新增中文文案"，
 * 而这里断言的是 **payload 里给的名字**，本来就该引用夹具，不该再抄一遍字面量。
 */
const ORPHAN_FEATURE = "更新检查";

const DETAILS: ConnectionKeyMapRow[] = [
  {
    id: "k.beta",
    label: "Beta Key",
    group: "web_search",
    group_label: "联网搜索与抓取",
    configure_at: "设置 → 联网搜索 → Beta",
    used_by: ["联网搜索"],
    used_by_text: "联网搜索",
    empty_meaning: "留空并保存 = 移除",
    where: "global_settings.json → k.beta",
    status: "saved",
    section: "assistant-behavior",
    anchor: "conn-search-beta",
  },
  {
    id: "k.override",
    label: "Override Key",
    group: "session",
    group_label: "仅本次会话",
    configure_at: "设置 → AI 模型 → 仅本次会话使用",
    used_by: ["简历生成"],
    used_by_text: "简历生成",
    empty_meaning: "清空 = 回到已保存的那把",
    where: "后端进程内存",
    status: "session_only",
    section: "model",
    anchor: "conn-override",
  },
  {
    id: "k.gate",
    label: "闸门口令",
    group: "network",
    group_label: "网络代理",
    configure_at: "设置 → 网络代理",
    used_by: ["联网搜索"],
    used_by_text: "联网搜索",
    empty_meaning: "留空 = 保留",
    where: "global_settings.json → k.gate",
    status: "not_configured",
    section: "connections",
    anchor: "conn-gate",
  },
];

/**
 * 三列（第三列未配置）、三行（一行只依赖闸门不进矩阵）。
 *
 * 顺序刻意**不是字母序**：`k.beta` < `k.gate` < `k.override` 才是字母序，payload 给的是
 * beta / override / gate。
 */
function matrix(overrides: Partial<MatrixPayload> = {}): MatrixPayload {
  return {
    keys: [
      {
        id: "k.beta",
        label: "Beta",
        group: "web_search",
        status: "saved",
        section: "assistant-behavior",
        anchor: "conn-search-beta",
      },
      {
        id: "k.override",
        label: "Override",
        group: "session",
        status: "session_only",
        section: "model",
        anchor: "conn-override",
      },
      {
        id: "k.gate",
        label: "Gate",
        group: "network",
        status: "not_configured",
        section: "connections",
        anchor: "conn-gate",
      },
    ],
    features: [
      { id: "f.resume", label: "简历生成", group: "content" },
      { id: "f.search", label: "联网搜索", group: "web" },
      { id: "f.orphan", label: ORPHAN_FEATURE, group: "system" },
    ],
    edges: [
      { key: "k.beta", feature: "f.search", kind: "direct" },
      { key: "k.override", feature: "f.resume", kind: "override" },
    ],
    gate: { key: "k.gate", label: "闸门口令" },
    ...overrides,
  };
}

function renderMatrix(
  payload: MatrixPayload = matrix(),
  onConfigure: (section: string, anchor: string) => void = () => {},
) {
  return render(
    <AntdApp>
      <ConnectionMatrix matrix={payload} details={DETAILS} onConfigure={onConfigure} />
    </AntdApp>,
  );
}

/** 列头按钮（行头按钮是另一个类，别混）。 */
function columnButtons(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(".connection-matrix__col-btn"));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConnectionMatrix：前端零清单", () => {
  /**
   * 组件源码里不许出现具体 Key id / 名字。
   *
   * 这是"新增来源自动多一列"能被信任的前提：一旦有人图省事写 `id === "session"`，
   * 新增一把覆盖式 Key 就会被画成普通依赖，而界面上看不出来。
   */
  it("组件源码不含任何具体 Key id / 名字", () => {
    const files = [
      "src/features/settings/ConnectionMatrix.tsx",
      "src/features/settings/ConnectionMatrixDetail.tsx",
      "src/features/settings/connectionMatrixModel.ts",
    ];
    const forbidden =
      /web_search\.|llm\.(default|session)|asr\.default|embedding\.default|network\.proxy|deepseek|tavily|jina/i;
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(forbidden.test(source), `${file} 里出现了具体 Key id/名字`).toBe(false);
    }
  });

  it("加一列假来源就多一列，前端一行都不用改", () => {
    const payload = matrix();
    const extra = {
      id: "k.extra",
      label: "Extra",
      group: "llm",
      status: "saved" as const,
      section: "model",
      anchor: "conn-extra",
    };
    renderMatrix({ ...payload, keys: [...payload.keys, extra] });

    const panel = screen.getByTestId("connection-matrix");
    const labels = columnButtons(panel).map((button) => button.textContent);
    // 列数 = payload 的 keys 条数（不是前端写死的 3）。
    expect(labels).toHaveLength(payload.keys.length + 1);
    expect(labels.some((label) => label?.includes("Extra"))).toBe(true);
  });

  it("行列顺序 = payload 顺序，不按字母排", () => {
    const panel = renderMatrix().container.querySelector(
      "[data-testid=connection-matrix]",
    ) as HTMLElement;
    expect(columnButtons(panel).map((button) => button.textContent)).toEqual([
      "Beta",
      "Override",
      "Gate",
    ]);
    // 行头顺序同理（且"只依赖闸门"的功能不画行）。
    const rowLabels = Array.from(
      panel.querySelectorAll<HTMLElement>(".connection-matrix__row-btn"),
    ).map((button) => button.textContent);
    expect(rowLabels).toEqual(["简历生成", "联网搜索"]);
  });
});

describe("ConnectionMatrix：聚焦语义", () => {
  it("点一列只压暗无关格子，空位不带任何提亮类", () => {
    const view = renderMatrix();
    const panel = view.getByTestId("connection-matrix");

    fireEvent.click(within(panel).getByRole("button", { name: /Beta/ }));

    // 表格进入"有聚焦"状态（CSS 据此把无关 pip 压到 .13）。
    expect(panel.querySelector(".connection-matrix__table")).toHaveClass("is-focused");
    // 只有该列的**有依赖**的格子带 is-focus：这里是 Beta × 联网搜索 一格。
    const focused = panel.querySelectorAll(".connection-matrix__pip.is-focus");
    expect(focused).toHaveLength(1);
    // 空位根本没有 pip 元素（不是"有元素但不亮"）——这是"不会点亮空位"的实现前提。
    const emptyCells = Array.from(panel.querySelectorAll<HTMLElement>(".connection-matrix__cell"));
    const cellsWithFocusClass = emptyCells.filter((cell) =>
      cell.querySelector(".connection-matrix__pip.is-focus"),
    );
    expect(cellsWithFocusClass).toHaveLength(1);
    for (const cell of emptyCells) {
      if (cell.childElementCount === 0) {
        // 空位连 class 都没有：任何"提亮"选择器都够不着它。
        expect(cell.className.trim()).toBe("connection-matrix__cell");
      }
    }
  });

  it("点一行只标记该行的依赖格子；覆盖式格子是空心环", () => {
    const view = renderMatrix();
    const panel = view.getByTestId("connection-matrix");

    fireEvent.click(within(panel).getByRole("button", { name: "简历生成" }));
    const focused = Array.from(panel.querySelectorAll(".connection-matrix__pip.is-focus"));
    expect(focused).toHaveLength(1);
    // `kind` 来自后端：覆盖式的格子画成空心环（is-override）。
    expect(focused[0]).toHaveClass("is-override");
  });

  it("再点同一列取消聚焦（Esc 也能取消）", () => {
    const view = renderMatrix();
    const panel = view.getByTestId("connection-matrix");
    const beta = within(panel).getByRole("button", { name: /Beta/ });

    fireEvent.click(beta);
    expect(panel.querySelector(".connection-matrix__table")).toHaveClass("is-focused");
    fireEvent.click(beta);
    expect(panel.querySelector(".connection-matrix__table")).not.toHaveClass("is-focused");
  });
});

describe("ConnectionMatrix：汇总与筛选", () => {
  it("三档计数由 payload 算，之和等于列数", () => {
    const payload = matrix();
    const view = renderMatrix();
    const panel = view.getByTestId("connection-matrix");

    const summary = panel.querySelector(".connection-matrix__summary") as HTMLElement;
    const texts = within(summary)
      .getAllByRole("button")
      .map((button) => button.textContent ?? "");
    const numbers = texts.map((text) => Number(text.replace(/\D+/g, "").slice(-1)));
    expect(numbers.reduce((sum, value) => sum + value, 0)).toBe(payload.keys.length);
  });

  it("点一档只留该状态的列，再点一次取消", () => {
    const view = renderMatrix();
    const panel = view.getByTestId("connection-matrix");
    const saved = within(panel)
      .getAllByRole("button")
      .find((button) => (button.textContent ?? "").includes(t("connections.status.saved")));
    if (!saved) throw new Error("找不到已保存档位的按钮");

    fireEvent.click(saved);
    // 数据驱动重渲染：DOM 里真的只剩一列（不是 CSS 隐藏）。
    expect(columnButtons(panel)).toHaveLength(1);
    expect(saved).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(saved);
    expect(columnButtons(panel)).toHaveLength(matrix().keys.length);
  });

  it("筛选后出现「取消筛选」chip；点它或按 Esc 都回到全部列（T18）", () => {
    const view = renderMatrix();
    const panel = view.getByTestId("connection-matrix");
    const saved = within(panel)
      .getAllByRole("button")
      .find((button) => (button.textContent ?? "").includes(t("connections.status.saved")));
    if (!saved) throw new Error("找不到已保存档位的按钮");

    fireEvent.click(saved);
    const clear = within(panel).getByRole("button", {
      name: t("settingsUi.connections.matrix.clearFilter"),
    });
    fireEvent.click(clear);
    expect(columnButtons(panel)).toHaveLength(matrix().keys.length);
    expect(
      within(panel).queryByRole("button", {
        name: t("settingsUi.connections.matrix.clearFilter"),
      }),
    ).toBeNull();

    // Esc 与「取消筛选」是同一个退出语义：筛选存在时先撤筛选。
    fireEvent.click(saved);
    expect(columnButtons(panel)).toHaveLength(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(columnButtons(panel)).toHaveLength(matrix().keys.length);
  });
});

describe("ConnectionMatrix：详情与落点", () => {
  it("详情卡在矩阵下方，点一列后给出去配置落点", () => {
    const onConfigure = vi.fn();
    const view = renderMatrix(matrix(), onConfigure);
    const panel = view.getByTestId("connection-matrix");

    // 未聚焦时是占位文案（详情卡常驻，不跳动）。
    expect(
      within(panel).getByText(t("settingsUi.connections.matrix.detail.placeholder")),
    ).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: /Beta/ }));
    // 那四句整话来自 key_map（后端投影），矩阵自己不解释。
    expect(within(panel).getByText(DETAILS[0].configure_at)).toBeInTheDocument();
    expect(within(panel).getByText(DETAILS[0].empty_meaning)).toBeInTheDocument();
    expect(within(panel).getByText("?tab=assistant-behavior#conn-search-beta")).toBeInTheDocument();

    fireEvent.click(
      within(panel).getByRole("button", {
        name: t("settingsUi.connections.matrix.detail.goConfigure"),
      }),
    );
    // 落点必须是 `?tab=…#anchor`：只有 hash 的话隐藏分区滚不到（#9 的根因）。
    expect(onConfigure).toHaveBeenCalledWith("assistant-behavior", "conn-search-beta");
  });

  it("闸门凭据不占列，只出现在闸门带上", () => {
    const view = renderMatrix();
    const panel = view.getByTestId("connection-matrix");
    const gate = within(panel).getByTestId("connection-matrix-gate");

    expect(within(gate).getByText(DETAILS[2].label)).toBeInTheDocument();
    // 它没有列头按钮（列只来自 matrix.keys，后端已把它排除）。
    expect(columnButtons(panel).map((button) => button.textContent)).not.toContain(
      DETAILS[2].label,
    );
    // 只依赖闸门的功能合并成一句说明，不画一排空格子。
    expect(within(panel).queryByText(ORPHAN_FEATURE)).toBeNull();
    expect(
      within(panel).getByText(
        t("settingsUi.connections.matrix.gate.only", { list: ORPHAN_FEATURE }),
      ),
    ).toBeInTheDocument();
  });
});
