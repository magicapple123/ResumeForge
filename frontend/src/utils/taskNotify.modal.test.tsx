// SPDX-License-Identifier: Apache-2.0
/**
 * 完成弹窗必须**真的有内容**。
 *
 * 这一条必须用**真实 AntD**（而不是假宿主）来钉：假宿主如果照着我们的字段名记录，无论传
 * 什么都能"通过"；而这次的事故恰恰是字段名对不上 AntD——`modal.info` 认 `title`/`content`，
 * 我们传了 `message`/`description`，AntD 不报错，只是**弹出一个空白窗**。只有让真 AntD 把
 * 它渲染出来，才能保证以后不会又悄悄变空。
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  notifyTaskDone,
  registerNotifyHost,
  registerTaskNavigate,
  type NotifyHost,
} from "./taskNotify";

function NotifyHostBridge() {
  const { notification, modal } = AntdApp.useApp();
  useEffect(() => {
    registerNotifyHost({ notification, modal } as unknown as NotifyHost);
    return () => registerNotifyHost(null);
  }, [modal, notification]);
  return null;
}

function renderHost() {
  render(
    <AntdApp>
      <NotifyHostBridge />
    </AntdApp>,
  );
}

/**
 * 让弹窗走完**退场动画**（补一次 `transitionend` / `animationend`）。
 *
 * 为什么必须补：AntD 的弹窗离场走 `@rc-component/motion`，它要么等到真实的
 * `transitionend` / `animationend`，要么等 `motionDeadline` 兜底；而 **dialog 并没有设
 * `motionDeadline`**（`@rc-component/dialog` 里搜不到这个 prop）。jsdom 既不跑 CSS 动画、
 * 也不会派发这两个事件，所以面板会一直停在 `ant-zoom-leave-active` 上——`destroy()` 已经
 * 生效了，只是"动画永远放不完"，DOM 因此不摘。
 *
 * 补发的这一下正是真浏览器在动画结束时做的事，所以补完之后再断言 DOM 消失，语义与真实
 * 环境一致（而不是把断言放宽成"看不见就算了"）。
 *
 * 必须等到 `-leave-active` 再补：`rc-motion` 只在动画的 active 步才挂上这两个事件的监听
 * （见 `@rc-component/motion` 的 `useStatus`：`patchMotionEvents` 在 `STEP_ACTIVE` 才调用，
 * 且 `activeRef.current` 为 false 时事件被直接忽略）。退场 prepare 步的 class 里同样含有
 * `ant-zoom-leave`，所以"等到 leave 就派发"会打在空处。
 */
async function finishModalLeave(): Promise<void> {
  await waitFor(() => {
    expect(document.querySelector(".ant-modal")?.className).toContain("ant-zoom-leave-active");
  });
  const panel = document.querySelector(".ant-modal");
  if (!panel) return;
  // 弹窗的 zoom 动画是 CSS animation（`.ant-zoom` 用 keyframes），但两者都补一次最稳。
  fireEvent.transitionEnd(panel);
  fireEvent.animationEnd(panel);
}

afterEach(() => {
  cleanup();
  registerNotifyHost(null);
});

describe("完成提醒的真实呈现", () => {
  it("居中弹窗带标题与说明（不是空白窗）", async () => {
    renderHost();

    notifyTaskDone({
      modal: true,
      title: "简历已生成",
      description: "已自动保存到简历中心，可以继续微调或导出。",
      confirmLabel: "知道了",
    });

    // 直接查 AntD 的弹窗结构：标题与正文分别是 .ant-modal-title / .ant-modal-confirm-content。
    // （不用 findByText 是因为弹窗有入场动画，文本节点出现时机不稳定。）
    await waitFor(() => {
      expect(document.querySelector(".ant-modal-title")?.textContent).toBe("简历已生成");
    });
    expect(document.querySelector(".ant-modal-confirm-content")?.textContent).toContain(
      "已自动保存到简历中心",
    );
    expect(screen.getByRole("button", { name: /知\s*道\s*了/ })).toBeInTheDocument();
  });

  it("右上角卡片同样带上标题与说明", async () => {
    renderHost();

    notifyTaskDone({ title: "岗位解读完成", description: "结果已经可以查看了。" });

    await waitFor(() => {
      expect(document.querySelector(".ant-notification-notice-title")?.textContent).toBe(
        "岗位解读完成",
      );
    });
    expect(document.querySelector(".ant-notification-notice-description")?.textContent).toContain(
      "结果已经可以查看了",
    );
  });

  it("弹窗里也会保留调用方给的动作按钮", async () => {
    renderHost();

    notifyTaskDone({
      modal: true,
      title: "官网采集完成",
      description: "共抓取 12 条岗位。",
      actions: <button type="button">去看岗位</button>,
    });

    await waitFor(() => {
      expect(document.querySelector(".ant-modal-title")?.textContent).toBe("官网采集完成");
    });
    expect(screen.getByRole("button", { name: "去看岗位" })).toBeInTheDocument();
  });

  it("弹窗上的「去查看」会跳到深链并把弹窗收掉", async () => {
    const visited: string[] = [];
    registerTaskNavigate((path) => visited.push(path));
    renderHost();

    notifyTaskDone({
      modal: true,
      title: "简历已生成",
      description: "已自动保存到简历中心。",
      deepLink: "/resumes?resume_id=42",
      viewLabel: "查看简历",
    });

    const view = await screen.findByRole("button", { name: "查看简历" });
    fireEvent.click(view);

    // 跳转地址来自 `utils/taskDeepLinks`，这里只验证"点了真的去了那里"。
    expect(visited).toEqual(["/resumes?resume_id=42"]);

    // 弹窗收掉：否则用户会停在"已完成"上，不知道自己已经跳走了。
    // 分两步看，两个条件缺一不可：
    // 1) 点完按钮弹窗已经进入**退场态**（证明「去查看」确实调到了 `destroy()`，而不是
    //    按钮只是跳了个页面、弹窗留在原地等用户手动关）；
    // 2) 退场结束后面板真的从 DOM 上摘掉。
    await finishModalLeave();
    await waitFor(() => expect(document.querySelector(".ant-modal-title")).toBeNull());
    registerTaskNavigate(null);
  });

  it("右上角卡片同样给出「去查看」", async () => {
    const visited: string[] = [];
    registerTaskNavigate((path) => visited.push(path));
    renderHost();

    notifyTaskDone({
      title: "岗位适配度分析完成",
      description: "已完成 3 个岗位。",
      deepLink: "/jobs?match_batch=history",
    });

    const view = await screen.findByRole("button", { name: /去\s*查\s*看/ });
    fireEvent.click(view);
    expect(visited).toEqual(["/jobs?match_batch=history"]);
    registerTaskNavigate(null);
  });
});
