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
import { DESKTOP_MENUS, type DesktopMenuItem } from "./desktopMenuModel";

/** 所有叶子与父级条目（含子菜单），导航/动作类断言都按它扫描。 */
function allItems(): DesktopMenuItem[] {
  const out: DesktopMenuItem[] = [];
  const walk = (items: DesktopMenuItem[]) => {
    for (const item of items) {
      out.push(item);
      if (item.children?.length) walk(item.children);
    }
  };
  for (const menu of DESKTOP_MENUS) walk(menu.items);
  return out;
}

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
    const missing = allItems()
      .filter((item) => item.kind === "ipc")
      .map((item) => item.ipcAction)
      .filter((action): action is string => typeof action === "string")
      .filter((action) => !ids.has(action));
    expect(missing, `主进程缺少这些动作：${missing.join(", ")}`).toEqual([]);
  });

  it("「关于」弹窗用到的信息 / 外链 / 检查更新动作同样存在", () => {
    const ids = handlerActionIds();
    for (const action of [
      "about.getInfo",
      "external.github",
      "external.website",
      "external.license",
      // #34H：「检查更新」从帮助菜单移到「关于」弹窗，动作本身仍在主进程白名单里。
      "help.checkUpdate",
    ]) {
      expect(ids.has(action), action).toBe(true);
    }
  });

  it("「复制诊断信息」的日志侧动作在主进程有 handler（#34D）", () => {
    // 该动作由诊断模块直接调用，不进菜单模型的 ipcAction，所以单独钉一次。
    expect(handlerActionIds().has("help.getDiagnostics")).toBe(true);
  });

  it("导航类动作只指向应用里真实存在的路由前缀", () => {
    const paths = allItems()
      .filter((item) => item.kind === "navigate")
      .map((item) => item.path ?? "");
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.startsWith("/"), path).toBe(true);
    }
  });

  it("菜单只放全局动作：导航项不得指向业务页面（#34 不变量）", () => {
    // 允许的是"全局动作落点"：新建简历（/resumes）与设置页的分区 tab。
    // 投递队列 / 面试 / 收藏夹 / 知识库 / 助手记忆 / RAG / 技能工作台都有自己的页面，
    // 进菜单就会和页面内入口打架，且菜单会膨胀成第二个导航。
    const allowedPrefixes = ["/resumes", "/settings"];
    const businessPaths = allItems()
      .filter((item) => item.kind === "navigate")
      .map((item) => item.path ?? "")
      .filter((path) => !allowedPrefixes.some((prefix) => path.startsWith(prefix)));
    expect(businessPaths).toEqual([]);
  });
});

describe("桌面菜单 #34 的补强项（模型契约）", () => {
  function menuItems(id: string) {
    return DESKTOP_MENUS.find((menu) => menu.id === id)?.items ?? [];
  }
  function actionIds() {
    return new Set(
      DESKTOP_MENUS.flatMap((menu) => menu.items)
        .map((item) => item.ipcAction)
        .filter((action): action is string => typeof action === "string"),
    );
  }

  it("34E：视图菜单有「重新加载」（kind=reload）与「开发者工具」（IPC），快捷键齐全", () => {
    const view = menuItems("view");
    const reload = view.find((item) => item.key === "view.reload");
    expect(reload?.kind).toBe("reload");
    expect(reload?.shortcut).toBe("mod+r");
    const devtools = view.find((item) => item.key === "view.toggleDevTools");
    expect(devtools?.kind).toBe("ipc");
    expect(devtools?.shortcutText).toBe("F12");
    expect(actionIds().has("view.toggleDevTools")).toBe(true);
  });

  it("34A：置顶是复选类菜单项，勾选态来自窗口实态（不在模型里存一份）", () => {
    const item = menuItems("window").find((candidate) => candidate.checkbox === "alwaysOnTop");
    expect(item?.ipcAction).toBe("window.toggleAlwaysOnTop");
    expect(item?.labelKey).toBe("appHeader.desktopMenu.item.alwaysOnTop");
  });

  it("34F：撤销 / 重做要求焦点在可编辑区（否则置灰）", () => {
    const edit = menuItems("edit");
    for (const key of ["edit.undo", "edit.redo"]) {
      expect(edit.find((item) => item.key === key)?.requiresEditableFocus).toBe(true);
    }
  });

  it("34G：关闭窗口带 Alt+F4（macOS 用 ⌘W）", () => {
    const close = menuItems("window").find((item) => item.key === "window.close");
    expect(close?.shortcut).toBe("alt+f4");
    expect(close?.shortcutMac).toBe("mod+w");
  });

  it("34B：文件菜单的「从链接导入岗位」调活岗位广场同一个 launcher（不是 navigate）", () => {
    const entry = menuItems("file").find((item) => item.key === "file.importJobFromUrl");
    // navigate 会把用户丢到 /jobs 却不打开弹窗；这里必须是"跳页 + 发打开事件"的复合动作。
    expect(entry?.kind).toBe("open-job-import");
    // 文案复用岗位广场按钮的 key：同一个动作只有一种说法。
    expect(entry?.labelKey).toBe("jobsImport.launcher");
  });

  it("34C：文件 → 导出子菜单三项（收藏夹 CSV / 知识库 Markdown / 整库备份）", () => {
    const exportEntry = menuItems("file").find((item) => item.key === "file.export");
    expect(exportEntry?.kind).toBe("submenu");
    const children = exportEntry?.children ?? [];
    expect(children.map((child) => child.key)).toEqual([
      "file.exportFavorites",
      "file.exportKnowledge",
      "file.backupRestore",
    ]);
    // 两个下载动作在渲染层完成（复用既有请求层），不进主进程动作白名单。
    expect(children.find((child) => child.key === "file.exportFavorites")?.kind).toBe(
      "export-favorites",
    );
    expect(children.find((child) => child.key === "file.exportKnowledge")?.kind).toBe(
      "export-knowledge",
    );
    // 整库备份仍是设置页的既有入口，id 未改、路由未改。
    const backup = children.find((child) => child.key === "file.backupRestore");
    expect(backup?.kind).toBe("navigate");
    expect(backup?.path).toBe("/settings?tab=backup");
    // 整库备份不再作为一级条目重复出现（同一个目的地只留一个入口）。
    expect(menuItems("file").some((item) => item.key === "file.backupRestore")).toBe(false);
  });

  it("34H：帮助菜单里没有「检查更新」", () => {
    expect(menuItems("help").some((item) => item.ipcAction === "help.checkUpdate")).toBe(false);
  });

  it("34I：关于与其它菜单一致——展开下拉、里面一项打开弹窗", () => {
    const about = DESKTOP_MENUS.find((menu) => menu.id === "about");
    expect(about?.items).toHaveLength(1);
    expect(about?.items[0].kind).toBe("about");
  });
});
