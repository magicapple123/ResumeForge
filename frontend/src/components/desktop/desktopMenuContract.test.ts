// SPDX-License-Identifier: Apache-2.0
/**
 * 标题栏动作契约（问题清单 §19.8「IPC：每个菜单动作都有对应 handler」）。
 *
 * 标题栏是 React 渲染、动作表在主进程：中间只靠字符串 id 连接，漏一个主进程 handler
 * 的表现是"点了没反应"，任何渲染层测试都发现不了。这里直接读主进程动作表的源码，
 * 把模型里的每个 ipcAction 钉在它的 handlers 键上。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESKTOP_MENUS } from "./desktopMenuModel";

declare const process: { cwd(): string };

// vitest 的 cwd 是 frontend/；标题栏动作表在仓库根的 desktop/ 下。
const MENU_SOURCE = readFileSync(`${process.cwd()}/../desktop/lib/desktop-menu.js`, "utf8");

/** handlers 表里的动作 id（形如 "edit.undo": () => ...）。 */
function handlerActionIds(): Set<string> {
  const ids = new Set<string>();
  for (const match of MENU_SOURCE.matchAll(/^\s+"([a-z]+\.[A-Za-z]+)":/gm)) {
    ids.add(match[1]);
  }
  return ids;
}

describe("桌面菜单动作契约", () => {
  it("每个菜单项的 ipcAction 都在主进程动作表里有 handler", () => {
    const ids = handlerActionIds();
    expect(ids.size).toBeGreaterThan(10);
    const missing = DESKTOP_MENUS.flatMap((menu) => menu.items)
      .filter((item) => item.kind === "ipc")
      .map((item) => item.ipcAction)
      .filter((action): action is string => typeof action === "string")
      .filter((action) => !ids.has(action));
    expect(missing, `主进程缺少这些动作：${missing.join(", ")}`).toEqual([]);
  });

  it("「关于」弹窗用到的信息 / 外链动作同样存在", () => {
    const ids = handlerActionIds();
    for (const action of [
      "about.getInfo",
      "external.github",
      "external.website",
      "external.license",
    ]) {
      expect(ids.has(action), action).toBe(true);
    }
  });

  it("导航类动作只指向应用里真实存在的路由前缀", () => {
    const paths = DESKTOP_MENUS.flatMap((menu) => menu.items)
      .filter((item) => item.kind === "navigate")
      .map((item) => item.path ?? "");
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.startsWith("/"), path).toBe(true);
    }
  });
});
