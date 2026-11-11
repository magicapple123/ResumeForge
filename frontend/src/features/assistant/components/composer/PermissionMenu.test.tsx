// SPDX-License-Identifier: Apache-2.0
/**
 * 输入区四档权限下拉（T11 / #12）。
 *
 * 钉住的行为：选哪一档就回调哪一档（确认卡与提示条已分别上移 / 删除）、
 * 没有会话时只能「跟随全局」不可改、五项说明互不重复。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PermissionMenu from "./PermissionMenu";
import type { PermissionMenuProps } from "./PermissionMenu";
import {
  ASSISTANT_PERMISSION_DESC_KEYS,
  ASSISTANT_PERMISSION_LABEL_KEYS,
  ASSISTANT_PERMISSION_LEVELS,
  resetAssistantPermissionForTests,
  type AssistantPermissionLevel,
} from "../../assistantPermission";
import { t } from "../../../../i18n";

const CONVERSATION_ID = 7;

function renderMenu(overrides: Partial<PermissionMenuProps> = {}) {
  const onChange = vi.fn();
  const props: PermissionMenuProps = {
    conversationId: CONVERSATION_ID,
    choice: "follow",
    effectiveLevel: "read_only",
    editable: true,
    onChange,
    ...overrides,
  };
  return {
    onChange,
    ...render(
      <AntdApp>
        <PermissionMenu {...props} />
      </AntdApp>,
    ),
  };
}

/** 打开下拉并点某一档（按档位显示名）。 */
async function chooseLevel(level: AssistantPermissionLevel) {
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(t("assistantPermission.followGlobal")) }),
  );
  const item = await screen.findByText(t(ASSISTANT_PERMISSION_LABEL_KEYS[level]));
  fireEvent.click(item);
}

beforeEach(() => {
  resetAssistantPermissionForTests();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  // modal.confirm 的节点挂在 body 上的独立容器里，cleanup 不会收走它；不清掉会让
  // 下一个用例找到上一个用例的确认框（"Found multiple elements" / 关闭后仍非空）。
  document.body.innerHTML = "";
  resetAssistantPermissionForTests();
  window.localStorage.clear();
});

describe("PermissionMenu 四档切换", () => {
  it("触发区显示「跟随全局（当前档位）」", () => {
    renderMenu();
    expect(
      screen.getByRole("button", {
        name: new RegExp(
          t("assistantPermission.followGlobalWith", {
            level: t("assistantPermission.level.read_only"),
          }),
        ),
      }),
    ).toBeInTheDocument();
  });

  it("选了哪一档就回调哪一档：确认判定不在本组件里（#12 已上移）", async () => {
    const { onChange } = renderMenu();

    await chooseLevel("read_full");
    expect(onChange).toHaveBeenCalledWith("read_full");

    await chooseLevel("write_confirm");
    expect(onChange).toHaveBeenCalledWith("write_confirm");

    // 本组件不再自己弹确认框：卡片由 PermissionConfirmModal 承担，
    // 是否该弹由 useAssistantPermission.needsConfirm 判定（见 AssistantComposer.permission.test.tsx）。
    expect(screen.queryByText(t("assistantPermission.confirm.risk"))).toBeNull();
  });
});

describe("没有会话 id：只显示跟随全局、不可改", () => {
  it("按钮禁用，点不出四档菜单，并给出可发现性提示", async () => {
    renderMenu({ conversationId: null, editable: false });

    const trigger = screen.getByRole("button", {
      name: new RegExp(t("assistantPermission.followGlobal")),
    });
    expect(trigger).toBeDisabled();

    fireEvent.click(trigger);
    expect(screen.queryByText(t("assistantPermission.level.write_full"))).toBeNull();

    // 禁用按钮自己收不到鼠标事件：Tooltip 挂在外层包裹上（否则提示永远不出现）
    fireEvent.mouseEnter(trigger.parentElement as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      t("assistantPermission.followGlobalHint"),
    );
  });
});

describe("菜单五项说明互不重复（R03）", () => {
  /** 打开下拉并取回五项说明（DOM 顺序：跟随全局在最前，其后是四档）。 */
  async function openAndReadDescs(): Promise<string[]> {
    renderMenu({ choice: "follow", effectiveLevel: "read_only" });
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("assistantPermission.followGlobal")) }),
    );
    return waitFor(() => {
      const nodes = document.querySelectorAll(".assistant-permission-option-desc");
      expect(nodes).toHaveLength(5);
      return Array.from(nodes).map((node) => (node.textContent ?? "").trim());
    });
  }

  it("五项说明两两不同，且第一项点明「全局默认 / 只影响本对话」", async () => {
    const descs = await openAndReadDescs();

    // ① 五项说明两两不同：同一段说明出现在两档上，用户就看不出这两档的区别。
    expect(new Set(descs).size).toBe(5);

    // ② 第一项（跟随全局）的说明不能再复用任何一档的档位说明——它以前与「仅查看」
    //    逐字相同（都是"只读，敏感字段脱敏"），等于没有说明"这是全局默认"。
    const levelDescs = ASSISTANT_PERMISSION_LEVELS.map((level) =>
      t(ASSISTANT_PERMISSION_DESC_KEYS[level]),
    );
    expect(levelDescs).not.toContain(descs[0]);

    // ③ 说明里带出"当前生效档位"，用户才知道自己跟随的是什么。
    const followDesc = t("assistantPermission.followGlobal.desc", {
      level: t("assistantPermission.level.read_only"),
    });
    expect(descs[0]).toBe(followDesc);
    expect(followDesc).toContain(t("assistantPermission.level.read_only"));

    // ④ 说明必须点明"设置页的全局默认"这件事。关键词从已有的 menu.hint 文案里切出来，
    //    中英文都在测同一件事，也避免往测试里新增中文字面量（cjkRatchet 有行数预算）。
    const hintHalves = t("assistantPermission.menu.hint").split(/[；;]/);
    const globalKeyword = hintHalves[hintHalves.length - 1].trim().slice(0, 4);
    expect(globalKeyword.length).toBeGreaterThan(0);
    expect(followDesc).toContain(globalKeyword);
  });
});
