// SPDX-License-Identifier: Apache-2.0
/**
 * 守卫的单元测试：**只测 jsdom 能测的部分**。
 *
 * 为什么不能在这里测"弹窗开着时卡片能打字"：antd 的焦点陷阱要求 `isFixedPos`
 * （`display: flex` + 定位），jsdom 里算不出来，陷阱根本不启用 —— 那里写一条
 * "绿"的用例只会掩盖真实缺陷。真实浏览器部分在
 * `frontend/tests/smoke/tou-tou-focus.spec.ts`（由维护者跑）。
 *
 * 这里守的是另外三件必须成立、且 jsdom 能精确判定的事：
 * 1. 幂等安装（StrictMode 双挂载 / HMR 不会双份注册）；
 * 2. 选择器判定（豁免区 / 内层弹层 / Esc 决策）；
 * 3. 拦截动作本身（`stopImmediatePropagation` 与 `stopPropagation` 的差别）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TOU_TOU_FOCUS_EXEMPT_SELECTOR,
  TOU_TOU_GUARD_KILL_SWITCH_KEY,
  TOU_TOU_NESTED_POPUP_TRIGGER_SELECTOR,
  areTouTouCardGuardsInstalled,
  hasOpenTouTouNestedPopup,
  installTouTouCardGuards,
  isInTouTouExemptZone,
  shouldTouTouCardCloseOnKeyDown,
  uninstallTouTouCardGuards,
} from "./touTouCardGuards";

/** 搭一棵最小 DOM：卡片 + 卡片内的输入框 + 卡片外的输入框。 */
function mountScene() {
  document.body.innerHTML = `
    <div class="ant-modal" role="dialog"><input id="modal-input" /></div>
    <section class="tt-assistant-card" role="dialog">
      <div class="assistant-composer"><textarea id="card-input"></textarea></div>
    </section>
    <button id="outside">外部按钮</button>
  `;
  const card = document.querySelector<HTMLElement>(".tt-assistant-card");
  const cardInput = document.getElementById("card-input");
  const outside = document.getElementById("outside");
  if (!card || !cardInput || !outside) throw new Error("场景搭建失败");
  return { card, cardInput, outside };
}

/** 造一个「已接管 Esc 的 Dropdown 触发器」。 */
function makeDropdownTrigger(expanded: "true" | "false"): HTMLButtonElement {
  const trigger = document.createElement("button");
  trigger.className = "ant-dropdown-trigger";
  trigger.setAttribute("aria-expanded", expanded);
  return trigger;
}

/** 派发一次会冒泡到 window 的 focusin。 */
function fireFocusIn(target: Element) {
  target.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
}

/**
 * 派发一次会冒泡到 window 的 keydown（返回事件本身，便于断言 `defaultPrevented`）。
 *
 * `cancelable: true` 不能省：原生 keydown 是可取消的，而不带它的合成事件
 * `preventDefault()` 是空操作，`defaultPrevented` 会恒为 false —— 那样
 * 「必须 preventDefault」的两条断言就变成永远失败的假红，而不是在测实现。
 */
function fireKeyDown(target: Element, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  uninstallTouTouCardGuards();
  delete (window as unknown as Record<string, unknown>)[TOU_TOU_GUARD_KILL_SWITCH_KEY];
  document.body.innerHTML = "";
});

describe("选择器常量与判定", () => {
  it("豁免区选择器只认卡片子树", () => {
    const { card, cardInput, outside } = mountScene();
    // 卡片本身与它的后代都算「在内」，卡片外的元素不算。
    expect(isInTouTouExemptZone(card)).toBe(true);
    expect(isInTouTouExemptZone(cardInput)).toBe(true);
    expect(isInTouTouExemptZone(outside)).toBe(false);
    expect(isInTouTouExemptZone(document.body)).toBe(false);
    // 非元素目标（`document` / 裸 EventTarget）不能抛。
    expect(isInTouTouExemptZone(document)).toBe(false);
    expect(isInTouTouExemptZone(new EventTarget())).toBe(false);
    expect(isInTouTouExemptZone(null)).toBe(false);
  });

  it("内层弹层只认「开着的 Dropdown 触发器」", () => {
    const { card } = mountScene();
    expect(hasOpenTouTouNestedPopup(card)).toBe(false);
    expect(hasOpenTouTouNestedPopup(null)).toBe(false);

    // 历史抽屉的开合按钮也是 aria-expanded，但它不该让卡片内的 Esc 失效。
    const drawerToggle = document.createElement("button");
    drawerToggle.setAttribute("aria-expanded", "true");
    card.appendChild(drawerToggle);
    expect(hasOpenTouTouNestedPopup(card)).toBe(false);

    const trigger = makeDropdownTrigger("true");
    card.appendChild(trigger);
    expect(hasOpenTouTouNestedPopup(card)).toBe(true);

    // 面板收起后（aria-expanded=false）Esc 重新归卡片。
    trigger.setAttribute("aria-expanded", "false");
    expect(hasOpenTouTouNestedPopup(card)).toBe(false);
  });
});

describe("Esc 决策（卡片根节点用）", () => {
  const base = { key: "Escape", isComposing: false, defaultPrevented: false };

  it("普通 Esc 关卡片；输入法组合中、被 preventDefault、内层弹层开着都不关", () => {
    const { card } = mountScene();
    expect(shouldTouTouCardCloseOnKeyDown(base, card)).toBe(true);
    expect(shouldTouTouCardCloseOnKeyDown({ ...base, isComposing: true }, card)).toBe(false);
    expect(shouldTouTouCardCloseOnKeyDown({ ...base, defaultPrevented: true }, card)).toBe(false);
    expect(shouldTouTouCardCloseOnKeyDown({ ...base, key: "Enter" }, card)).toBe(false);

    card.appendChild(makeDropdownTrigger("true"));
    expect(shouldTouTouCardCloseOnKeyDown(base, card)).toBe(false);
  });
});

describe("focusin 拦截", () => {
  it("卡片内的 focusin 到不了 window（stopImmediatePropagation）", () => {
    const { cardInput, outside } = mountScene();
    const onWindowFocusIn = vi.fn();
    window.addEventListener("focusin", onWindowFocusIn);
    installTouTouCardGuards();

    fireFocusIn(cardInput);
    expect(onWindowFocusIn).not.toHaveBeenCalled();

    // 卡片外不受影响：豁免是局部的，弹窗自己的焦点收敛照旧。
    fireFocusIn(outside);
    expect(onWindowFocusIn).toHaveBeenCalledTimes(1);

    window.removeEventListener("focusin", onWindowFocusIn);
  });

  it("同节点后注册的监听也被挡住（这正是不用 stopPropagation 的原因）", () => {
    const { cardInput } = mountScene();
    installTouTouCardGuards();
    // 模拟上游哪天把陷阱改挂到 document 冒泡：安装之后再注册到 document 上。
    const late = vi.fn();
    document.addEventListener("focusin", late);

    fireFocusIn(cardInput);
    expect(late).not.toHaveBeenCalled();
    document.removeEventListener("focusin", late);
  });
});

describe("keydown 拦截", () => {
  it("卡片内的 Esc 到不了 window 的 Esc 栈，其余按键与卡片外都不拦", () => {
    const { cardInput, outside } = mountScene();
    const onWindowKeyDown = vi.fn();
    window.addEventListener("keydown", onWindowKeyDown);
    installTouTouCardGuards();

    const inside = fireKeyDown(cardInput);
    expect(onWindowKeyDown).not.toHaveBeenCalled();
    // 与 document 上关闭守卫（`useDiscardGuard`）的握手：必须 preventDefault，
    // 否则它会把下层弹窗一起关掉（真实浏览器实测过）。
    expect(inside.defaultPrevented).toBe(true);

    // 输入法组合中的 Esc 是"取消候选"，必须原样放行。
    const composing = fireKeyDown(cardInput, { isComposing: true });
    expect(onWindowKeyDown).toHaveBeenCalledTimes(1);
    expect(composing.defaultPrevented).toBe(false);

    // 其他按键不拦（Tab 还要走 antd 的焦点循环）。
    fireKeyDown(cardInput, { key: "Tab" });
    expect(onWindowKeyDown).toHaveBeenCalledTimes(2);

    // 卡片外（例如弹窗自己的输入框）不拦，也不替它 preventDefault。
    const outsideEvent = fireKeyDown(outside);
    expect(onWindowKeyDown).toHaveBeenCalledTimes(3);
    expect(outsideEvent.defaultPrevented).toBe(false);

    window.removeEventListener("keydown", onWindowKeyDown);
  });

  it("同一节点上后注册的监听（FormModal 的 useDiscardGuard）被挡住", () => {
    const { cardInput } = mountScene();
    installTouTouCardGuards();
    // 弹窗打开晚于守卫安装，所以它的 document 监听排在守卫之后 ——
    // `stopPropagation()` 挡不住它，必须 `stopImmediatePropagation()`。
    const discardGuard = vi.fn();
    document.addEventListener("keydown", discardGuard);

    fireKeyDown(cardInput);
    expect(discardGuard).not.toHaveBeenCalled();

    // 卡片外照常收到（弹窗自己的 Esc 语义不受影响）。
    fireKeyDown(document.body);
    expect(discardGuard).toHaveBeenCalledTimes(1);

    document.removeEventListener("keydown", discardGuard);
  });

  it("`+` 面板开着时放行 document 上的监听（AddMenu 要能收面板），但仍挡住 window", () => {
    const { card, cardInput } = mountScene();
    installTouTouCardGuards();
    const addMenuHandler = vi.fn();
    const onWindowKeyDown = vi.fn();
    document.addEventListener("keydown", addMenuHandler);
    window.addEventListener("keydown", onWindowKeyDown);
    card.appendChild(makeDropdownTrigger("true"));

    const event = fireKeyDown(cardInput);
    expect(addMenuHandler).toHaveBeenCalledTimes(1);
    expect(onWindowKeyDown).not.toHaveBeenCalled();
    // 内层弹层接管的这一次同样要 preventDefault：否则 `useDiscardGuard` 顺手关弹窗。
    expect(event.defaultPrevented).toBe(true);

    document.removeEventListener("keydown", addMenuHandler);
    window.removeEventListener("keydown", onWindowKeyDown);
  });

  it("卡片在事件冒泡到 document 之前就被卸载，仍然拦得住（靠 capture 段的记录）", () => {
    const { cardInput } = mountScene();
    installTouTouCardGuards();
    const onWindowKeyDown = vi.fn();
    window.addEventListener("keydown", onWindowKeyDown);

    // 复刻真实时序：卡片根节点的 React `onKeyDown` 在 `#root` 上同步关卡片，
    // 事件继续冒泡时 target 已不在卡片子树里（`closest` 得到 null）。
    let detached = false;
    cardInput.addEventListener("keydown", () => {
      document.body.appendChild(cardInput);
      detached = true;
    });

    fireKeyDown(cardInput);

    expect(detached).toBe(true);
    // 冒泡阶段 DOM 里已经查不到卡片了 —— 只看 DOM 的实现会在这里漏掉。
    expect(isInTouTouExemptZone(cardInput)).toBe(false);
    expect(onWindowKeyDown).not.toHaveBeenCalled();

    window.removeEventListener("keydown", onWindowKeyDown);
  });
});

describe("安装幂等与反证开关", () => {
  it("重复安装只注册一份", () => {
    document.body.innerHTML = "";
    const addListener = vi.spyOn(document, "addEventListener");
    expect(areTouTouCardGuardsInstalled()).toBe(false);

    expect(installTouTouCardGuards()).toBe(true);
    expect(areTouTouCardGuardsInstalled()).toBe(true);
    // focusin / keydown 各一段 capture（只记录）与一段 bubble（才拦截）。
    expect(addListener).toHaveBeenCalledTimes(4);

    // StrictMode 的第二次挂载 / HMR 再执行一次：既不重复注册，也不报错。
    expect(installTouTouCardGuards()).toBe(false);
    expect(addListener).toHaveBeenCalledTimes(4);
  });

  it("反证开关打开后两个监听都放行（等价于注释掉拦截）", () => {
    const { cardInput } = mountScene();
    installTouTouCardGuards();
    const onWindowFocusIn = vi.fn();
    const onWindowKeyDown = vi.fn();
    window.addEventListener("focusin", onWindowFocusIn);
    window.addEventListener("keydown", onWindowKeyDown);

    (window as unknown as Record<string, unknown>)[TOU_TOU_GUARD_KILL_SWITCH_KEY] = true;
    fireFocusIn(cardInput);
    fireKeyDown(cardInput);
    expect(onWindowFocusIn).toHaveBeenCalledTimes(1);
    expect(onWindowKeyDown).toHaveBeenCalledTimes(1);

    delete (window as unknown as Record<string, unknown>)[TOU_TOU_GUARD_KILL_SWITCH_KEY];
    fireFocusIn(cardInput);
    fireKeyDown(cardInput);
    expect(onWindowFocusIn).toHaveBeenCalledTimes(1);
    expect(onWindowKeyDown).toHaveBeenCalledTimes(1);

    window.removeEventListener("focusin", onWindowFocusIn);
    window.removeEventListener("keydown", onWindowKeyDown);
  });

  it("常量就是契约本身：改动必须同步 T11 与真实浏览器用例", () => {
    expect(TOU_TOU_FOCUS_EXEMPT_SELECTOR).toBe(".tt-assistant-card");
    expect(TOU_TOU_NESTED_POPUP_TRIGGER_SELECTOR).toBe(
      ".ant-dropdown-trigger[aria-expanded='true']",
    );
    // 选择器与卡片 DOM 必须是同一个：这里直接拿 DOM 自证一次。
    const section = document.createElement("section");
    section.className = "tt-assistant-card";
    document.body.appendChild(section);
    expect(isInTouTouExemptZone(section)).toBe(true);
  });
});
