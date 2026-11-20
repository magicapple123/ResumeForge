// SPDX-License-Identifier: Apache-2.0
/**
 * R3-02：点评栏收起 = **整块收成 44px 竖排窄轨**。
 *
 * 缺陷原形：点「收起点评」只把正文换成一行「点评已收起」，卡片仍满高满宽白占着
 * 260px 一列——用户看到的是一个空壳。所以这里验三件事：
 * 1. 收起后**正文整块不渲染**（不是换一行字）、`data-collapsed` 落到 `<aside>` 上；
 * 2. 窄轨本身可点、可键盘 Tab，`aria-expanded` 说清方向；
 * 3. 空态（`feedback` 为 null）仍常驻占位且**没有**收起按钮（I-17 的滚动锚定）。
 *
 * CSS 断言用 `fs` 读文件而不是 `?raw`：`vitest.config.ts` 的 `test.css.include` 只放行
 * 四张表，其余样式表 `?raw` 导入是空串（先例：`resume/preview/ResumePreviewCanvas.test.tsx`）。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { t } from "../../i18n";
import { LiveVoiceRoomReview } from "./LiveVoiceRoomReview";

declare const process: { cwd(): string };

const FEEDBACK = "Clear structure, but no measurable result.";

function readCss(name: string): string {
  return readFileSync(
    [process.cwd(), "src", "features", "interview-voice", name].join("/"),
    "utf8",
  );
}

describe("点评栏收起（R3-02）", () => {
  it("收起后整块变窄轨：正文不渲染，标题与展开按钮保留", () => {
    render(<LiveVoiceRoomReview feedback={FEEDBACK} />);
    const label = t("interviewVoice.room.review");
    expect(screen.getByRole("complementary", { name: label })).toHaveAttribute(
      "data-collapsed",
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: t("interviewVoice.room.reviewCollapse") }));

    const aside = screen.getByRole("complementary", { name: label });
    expect(aside).toHaveAttribute("data-collapsed", "true");
    // 关键：正文整块消失，而不是留一行「点评已收起」撑住满高卡片。
    expect(document.querySelector(".interview-live-room__review-body")).toBeNull();
    expect(aside.textContent).toBe(label);
    // 窄轨：箭头（CSS 画）+ 竖排标题，整条可点。
    const rail = screen.getByRole("button", { name: t("interviewVoice.room.reviewExpand") });
    expect(rail).toHaveAttribute("aria-expanded", "false");
    expect(rail.querySelector(".interview-live-room__review-chevron")).not.toBeNull();
  });

  it("再点窄轨能展开，正文与 aria-expanded 都回来", () => {
    render(<LiveVoiceRoomReview feedback={FEEDBACK} />);
    fireEvent.click(screen.getByRole("button", { name: t("interviewVoice.room.reviewCollapse") }));
    fireEvent.click(screen.getByRole("button", { name: t("interviewVoice.room.reviewExpand") }));

    expect(screen.getByRole("complementary")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByRole("complementary").textContent).toContain(FEEDBACK);
    expect(
      screen.getByRole("button", { name: t("interviewVoice.room.reviewCollapse") }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("空态仍常驻占位，且不出现收起按钮（I-17）", () => {
    render(<LiveVoiceRoomReview feedback={null} />);
    const aside = screen.getByRole("complementary");
    expect(aside).toHaveAttribute("data-collapsed", "false");
    expect(aside.textContent).toContain(t("interviewVoice.room.reviewEmpty"));
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("点评栏 / 房间头样式（R3-01、R3-02）", () => {
  const room = readCss("live-voice-room.css");
  const panels = readCss("liveVoiceRoomPanels.css");

  it("房间只在真有标题栏时让出那一截（浏览器 / 桌面全屏不让）", () => {
    // 基础规则仍是贴满视口：`--rf-titlebar-height` 在浏览器发行版里**也存在**
    // （desktop-titlebar.css 的 :root 随主包加载），靠 var 回退值判断不了有没有标题栏。
    const base = /\.interview-live-room \{[^}]*\}/.exec(room)?.[0] ?? "";
    expect(base).toContain("inset: 0;");
    expect(room).toContain(
      'html:has(.app-titlebar:not([data-hidden="true"])) .interview-live-room',
    );
    expect(room).toContain("inset-block-start: var(--rf-titlebar-height, 0px);");
  });

  it("房间头正好 44px：min-height 44 + 纵向内边距 6px（32 按钮 + 12）", () => {
    const header = /\.interview-live-room__header \{[\s\S]*?\n\}/.exec(room)?.[0] ?? "";
    expect(header).toContain("min-height: 44px");
    // 6px 而不是 8px：8px 会被 32px 的按钮撑成 48px（min-height 只是下限）。
    expect(header).toContain("padding: 6px 22px");
  });

  it("收起态把右列收到 44px（:has 读子元素属性）", () => {
    expect(room).toContain(
      '.interview-live-room__content:has(> .interview-live-room__review[data-collapsed="true"])',
    );
    expect(room).toContain("grid-template-columns: minmax(0, 1fr) 44px;");
  });

  it("窄轨贴顶 + 竖排，正文 120px 下限只在展开态", () => {
    expect(panels).toMatch(/\[data-collapsed="true"\] \{[^}]*align-self: start/);
    expect(panels).toContain("writing-mode: vertical-rl");
    expect(panels).toContain("text-orientation: upright");
    expect(panels).toContain('[data-collapsed="false"] .interview-live-room__review-body');
  });

  it("≤860px 堆叠时窄轨复位成通栏横条（不立柱子）", () => {
    const narrow = panels.slice(panels.indexOf("@media (max-width: 860px)"));
    expect(narrow).toMatch(/\[data-collapsed="true"\] \{[^}]*align-self: stretch/);
    expect(narrow).toContain("writing-mode: horizontal-tb");
  });
});
