// SPDX-License-Identifier: Apache-2.0
/**
 * 投投卡片对 antd 弹窗焦点陷阱的「局部豁免」守卫（问题 1）。
 *
 * ## 为什么需要它
 *
 * antd 的 Modal 默认开焦点陷阱：`antd 6.6.8` 的 `modal/Modal.js` 把 `focusable.trap`
 * 合进 Dialog 的 props，`@rc-component/dialog 1.10.0` 的 `Dialog/Content/Panel.js`
 * 调 `useLockFocus(visible && isFixedPos && focusTrap !== false, …)`，最终由
 * `@rc-component/util 1.14.0` 的 `Dom/focus.js` 在 **window 冒泡阶段**注册
 * `focusin → syncFocus`：焦点一旦不在被锁的弹窗子树里，就被拉回弹窗内第一个可聚焦
 * 元素（实测是右上角的关闭按钮）。
 *
 * 投投卡片是 `AppShell` 里的常驻面板，渲染在 `role="dialog"` 的 `<section>` 里、
 * **不在** `.ant-modal` 子树内。它也不能 portal 进弹窗：那会重挂 `AssistantPage`，
 * 草稿、滚动位置与流式状态全丢。于是点卡片的输入框，焦点被拉回弹窗 ——
 * 用户看到的是「卡片明明在，字却一个也打不进去」。
 *
 * ## 怎么做（局部豁免，不是全局关陷阱）
 *
 * 监听都挂在 **document** 上，分两段：**capture 段只记录判定**（那一刻 DOM 还是完整的），
 * **bubble 段才动手**（这时 React 已经跑完，卡片可能已被卸载）。只在事件来自卡片时生效。
 *
 * 1. `focusin` → `stopImmediatePropagation()`。document 是 window 的祖先，冒泡阶段的
 *    document 监听必然早于上面那个 window 监听，事件根本到不了陷阱。
 *    用 `stopImmediatePropagation` 而非 `stopPropagation`：万一上游哪天改成在
 *    document 冒泡监听，同一节点上后注册的监听也一并挡住。
 *    为什么是冒泡而不是捕获拦截：React 17+ 把合成事件挂在 `#root`（document 的后代），
 *    卡片内的 `onFocus` / Tooltip 等焦点逻辑照常跑完，只是不再往 window 冒。
 * 2. `keydown`（`Escape` 且**不在输入法组合中**）→ 见 `handleKeyDown` 的三步：
 *    `preventDefault()`（与 document 上的关闭守卫握手）→ 内层弹层开着时只
 *    `stopPropagation()` → 其余 `stopImmediatePropagation()`。
 *    **绝不能把这个监听挂在卡片节点上**：那样事件到不了 `#root`，卡片内自己的
 *    React 键盘处理器（`AddMenu` 的二级菜单 Esc、拖动把手的方向键）会全部失效。
 *
 * 为什么 `stopPropagation()` 一条不够（这条是实测补上的）：`FormModal` 的 Esc 入口
 * `components/common/useDiscardGuard.ts` 挂在 **document** 冒泡上，而 `stopPropagation`
 * 只挡后续节点（window），**挡不住同一节点上后注册的监听** —— 于是"卡片内 Esc"会把
 * 下层弹窗一起关掉。它第一句是 `if (… || event.defaultPrevented) return;`，
 * 所以守卫在冒泡段先 `preventDefault()`：既让它放手，也保留 `AddMenu` 在 document 上
 * 收起 `+` 面板的能力（那一步不能被 `stopImmediatePropagation` 掐掉）。
 *
 * 豁免面 = 「卡片子树」+「卡片挂了豁免标记的浮层」（`TOU_TOU_FOCUS_EXEMPT_SELECTOR`）。
 * 为什么要第二段（T11）：卡片 `+` 面板是一个 antd `Dropdown`，面板本体 portal 到 body，
 * **不在**卡片子树内；面板里的岗位 / 简历是 `showSearch` 远程搜索，输入框在面板里、
 * 下拉列表又是一层 body 上的 `.ant-select-dropdown`。只豁免卡片子树的话，点搜索框的
 * 一瞬间焦点就被陷阱抢回右上角关闭按钮，一个字都打不进（实测
 * `activeElement=BUTTON.ant-modal-close`）。
 *
 * 标记只由卡片自己挂（`TouTouPopupExemptionProvider` → `AddMenu` 的 `exemptPopups`），
 * 页面内的同款控件不带标记、照样被陷阱接管 —— 这是"局部豁免"的边界，别扩大。
 *
 * ## 安装时机
 *
 * 必须在应用启动时装（`AppShell` 的挂载 effect），**不能**等卡片打开才装：React
 * 子组件的 effect 先于父组件执行，晚装的话自动聚焦那一次会先被陷阱抢走。函数幂等
 * （模块级标志），StrictMode 双挂载与 HMR 都不会重复注册，所以调用方不需要清理。
 *
 * ## 失效条件（升级 antd 必须跑 `frontend/tests/smoke/tou-tou-focus.spec.ts`）
 *
 * - 上游若改成 **capture 阶段**监听 `focusin`，本方案失效（不破坏 React 事件模型的
 *   前提下没有更早的拦截点）。
 * - 已验证版本：`antd 6.6.8` / `@rc-component/util 1.14.0` / `@rc-component/dialog 1.10.0`。
 *   这三个版本号是结论的一部分，不是装饰。
 */

/**
 * 卡片本体的类名选择器。**全局只写这一处**（组件 `className` 与测试都从这里取）。
 *
 * 与豁免区分开是因为两件事的语义不同：豁免区要认「卡片 + 卡片挂标记的浮层」，
 * 而"卡片内有没有开着的弹层"只该问卡片本体（触发器在卡片里，浮层在 body 上）。
 */
export const TOU_TOU_CARD_SELECTOR = ".tt-assistant-card";

/**
 * 卡片挂给**自己那些 portal 到 body 的浮层**的标记类。
 *
 * 用它的地方只有三处：本文件的选择器、投投浮窗的 `AddMenu`（`exemptPopups`）、
 * 以及 `touTouCardGuards.test.ts` 的钉子用例。不要在别处另抄一份字面量。
 */
export const TOU_TOU_POPUP_EXEMPT_CLASS = "tt-popup-exempt";

/** 豁免标记的选择器形式（由类名派生，不另写字符串）。 */
export const TOU_TOU_POPUP_EXEMPT_SELECTOR = `.${TOU_TOU_POPUP_EXEMPT_CLASS}`;

/**
 * 豁免区选择器：**全局只写这一处**（守卫、卡片、测试都从这里取）。
 *
 * 两个成员：卡片本体 + 卡片挂标记的浮层（`AddMenu` 的 `+` 面板与其下拉）。
 */
export const TOU_TOU_FOCUS_EXEMPT_SELECTOR = `${TOU_TOU_CARD_SELECTOR}, ${TOU_TOU_POPUP_EXEMPT_SELECTOR}`;

/**
 * 卡片内「已经接管 Esc 的弹层」的触发器选择器。
 *
 * 卡片 `+` 面板是一个 antd `Dropdown`：打开时触发器带 `ant-dropdown-trigger` 类
 * 与 `aria-expanded="true"`，而面板本体 portal 到 body、不在卡片子树内。此时按
 * Esc 的语义是「先收面板」，所以卡片根节点的 `onKeyDown` 必须放过这一次。
 * 只认 Dropdown 触发器（不认任意 `aria-expanded`）：卡片头部还有历史抽屉的
 * 开合按钮，那也是 `aria-expanded`，但它不该让 Esc 失效。
 *
 * 版本依赖：类名来自 `antd 6.6.8` 的 `dropdown/dropdown.js`
 * （`className: clsx(`${prefixCls}-trigger`, …)`）。升级 antd 时随守卫一起复核。
 */
export const TOU_TOU_NESTED_POPUP_TRIGGER_SELECTOR = ".ant-dropdown-trigger[aria-expanded='true']";

/**
 * 反证（改坏实验）用的运行时开关：`window.__rfDisableTouTouFocusGuard === true`
 * 时四段监听都直接放行，等价于「把拦截代码注释掉」。
 *
 * 为什么留一个开关而不是让验证者改源码：真实浏览器的反证要在**已构建的产物**上做，
 * 改源码得重新构建，而重新构建在生产环境是被禁止的动作。Playwright 侧用
 * `page.addInitScript` 注入即可复现「焦点被拉回 `.ant-modal-close`」。
 * 正常代码路径永远不会设置它。
 */
export const TOU_TOU_GUARD_KILL_SWITCH_KEY = "__rfDisableTouTouFocusGuard";

/** 模块级安装标志：StrictMode 双挂载 / HMR 下只注册一次。 */
let installed = false;

/** 反证开关是否被打开（读 `window` 上的键，非 `true` 一律当作没开）。 */
function isKillSwitchOn(): boolean {
  if (typeof window === "undefined") return false;
  const flag = (window as unknown as Record<string, unknown>)[TOU_TOU_GUARD_KILL_SWITCH_KEY];
  return flag === true;
}

/** 事件目标是否落在豁免区（卡片子树 / 卡片挂标记的浮层）内。非元素目标一律当作不在。 */
export function isInTouTouExemptZone(target: EventTarget | null): boolean {
  if (target === null) return false;
  const element = target as Element;
  if (typeof element.closest !== "function") return false;
  return element.closest(TOU_TOU_FOCUS_EXEMPT_SELECTOR) !== null;
}

/**
 * 事件目标是否落在「卡片挂标记的浮层」里（`+` 面板 / 它的下拉，portal 到 body）。
 *
 * 单独问这一个是因为 Esc 的归属不同：从浮层里按 Esc 的语义是「收浮层」（浮层自己
 * 在 document 上有监听），从卡片本体按 Esc 才是「收卡片」。
 */
export function isInTouTouPopupExemptHost(target: EventTarget | null): boolean {
  if (target === null) return false;
  const element = target as Element;
  if (typeof element.closest !== "function") return false;
  return element.closest(TOU_TOU_POPUP_EXEMPT_SELECTOR) !== null;
}

/** 卡片内是否有「已接管 Esc 的弹层」正开着（见 `TOU_TOU_NESTED_POPUP_TRIGGER_SELECTOR`）。 */
export function hasOpenTouTouNestedPopup(card: Element | null): boolean {
  if (card === null) return false;
  return card.querySelector(TOU_TOU_NESTED_POPUP_TRIGGER_SELECTOR) !== null;
}

/** `shouldTouTouCardCloseOnKeyDown` 只关心这三个字段，React 合成事件结构上就满足。 */
export interface TouTouEscapeLikeEvent {
  readonly key: string;
  readonly isComposing: boolean;
  readonly defaultPrevented: boolean;
}

/**
 * 卡片根节点收到一次 keydown 后，要不要把卡片关掉。
 *
 * 判据（三者缺一不可）：
 * - 是 `Escape`，且**不在输入法组合中**（中文/日文输入法里 Esc 是取消候选，不是关面板）；
 * - 事件没被内层 `preventDefault`（内层明确表示"这次按键我处理了"）；
 * - 卡片内没有正开着的弹层（`+` 面板 / 下拉）：那种情况下 Esc 归弹层。
 *
 * 内层用 React `stopPropagation()` 消费掉的 Esc 根本到不了卡片根节点，不在这里判断。
 */
export function shouldTouTouCardCloseOnKeyDown(
  event: TouTouEscapeLikeEvent,
  card: Element | null,
): boolean {
  if (event.key !== "Escape") return false;
  if (event.isComposing) return false;
  if (event.defaultPrevented) return false;
  return !hasOpenTouTouNestedPopup(card);
}

/**
 * capture 阶段记下的判定，供冒泡阶段使用。
 *
 * 为什么不在冒泡阶段重新问 DOM：卡片根节点的 React `onKeyDown` 在 `#root`（document
 * 的后代）上同步跑完并 `onClose()`，React 对离散事件是同步刷新的 —— 事件继续冒到
 * document 时卡片已经不在文档里，`target.closest(".tt-assistant-card")` 只能得到 null。
 * 真实浏览器实测过这条时序（`afterEscCardCount=0` 且 `afterEscModalCount=0`）。
 */
const escapeFromCard = new WeakSet<Event>();
const escapeWithNestedPopup = new WeakSet<Event>();
const focusInFromCard = new WeakSet<Event>();

/** `focusin`：卡片内的焦点事件不让它冒到 window 的陷阱（`Dom/focus.js` 的 `syncFocus`）。 */
function handleFocusIn(event: FocusEvent): void {
  if (isKillSwitchOn()) return;
  if (!focusInFromCard.has(event) && !isInTouTouExemptZone(event.target)) return;
  // 用 stopImmediatePropagation 而不是 stopPropagation：万一上游哪天改成在 document
  // 冒泡监听，同节点上后注册的监听也一并挡住。
  event.stopImmediatePropagation();
}

/**
 * `focusin` 的 capture 段：只记录、不拦截（DOM 在这一刻还是完整的）。
 *
 * document 的 capture 早于 `#root` 上的 React 监听，所以卡片若在自己的焦点处理里
 * 被卸载，冒泡段仍然靠这条记录认得"这次焦点来自卡片"。
 */
function captureFocusIn(event: FocusEvent): void {
  if (isKillSwitchOn()) return;
  if (isInTouTouExemptZone(event.target)) focusInFromCard.add(event);
}

/**
 * `keydown` 的 capture 段：只记录、不拦截。
 *
 * 记两件事：这次 Esc 属于卡片这一族、以及**当时**是不是该由内层弹层接管
 * （冒泡段 DOM 可能已经变了，那时再问就晚了一个 tick）。
 *
 * "属于卡片这一族"有两种来路，判据不同：
 * - 来自卡片本体：问卡片本体里有没有开着的 Dropdown 触发器（`+` 面板）；
 * - 来自卡片挂标记的浮层（`+` 面板本身）：浮层自己就在接管 Esc，直接算接管。
 *   注意这里必须用 `TOU_TOU_CARD_SELECTOR` 找卡片：浮层的 `closest` 会命中浮层自己，
 *   而触发器在卡片里、不在浮层里，用浮层去问"有没有开着的弹层"永远得到 false，
 *   结果会把浮层自己的 Esc 处理器一起挡掉（面板再也收不起来）。
 */
function captureKeyDown(event: KeyboardEvent): void {
  if (isKillSwitchOn()) return;
  if (event.key !== "Escape" || event.isComposing) return;
  const target = event.target as Element | null;
  if (target === null || !isInTouTouExemptZone(target)) return;
  escapeFromCard.add(event);
  if (
    isInTouTouPopupExemptHost(target) ||
    hasOpenTouTouNestedPopup(target.closest(TOU_TOU_CARD_SELECTOR))
  ) {
    escapeWithNestedPopup.add(event);
  }
}

/**
 * `keydown` 拦截：卡片内的 Esc 只关卡片，不许顺带关掉下层弹窗。
 *
 * 三件事按顺序做，缺一条都会漏：
 *
 * 1. `preventDefault()` —— 让 document 上的关闭守卫认账。`FormModal` 的 Esc 入口
 *    `components/common/useDiscardGuard.ts` 就挂在 **document** 冒泡上，且第一句是
 *    `if (event.key !== "Escape" || event.defaultPrevented) return;`
 *    （它自己的注释写着「已接管的那一次 Esc 会被 preventDefault」——这就是那个握手口）。
 *    不这么做的话，`stopPropagation` 只能挡住 window，挡不住同一节点上后注册的监听，
 *    实测表现就是「卡片关了、弹窗也关了」。
 * 2. 卡片内的弹层（`+` 面板）开着时，Esc 归它：只 `stopPropagation()`（挡 window 上的
 *    Esc 栈），**不** `stopImmediatePropagation()` —— `AddMenu` 的 document 监听要能跑
 *    才能收起面板。
 * 3. 其余情况 `stopImmediatePropagation()`：连同一节点上后注册的监听一起挡掉。
 *    这是"卡片内 Esc 只关卡片"的关键那一下。
 */
function handleKeyDown(event: KeyboardEvent): void {
  if (isKillSwitchOn()) return;
  // 冒泡段的 DOM 可能已经变了：优先认 capture 段的记录，DOM 只作兜底。
  if (!escapeFromCard.has(event) && !isInTouTouExemptZone(event.target)) return;
  if (event.key !== "Escape" || event.isComposing) return;

  // ① 关闭守卫的握手口（见函数注释第 1 条）。
  if (!event.defaultPrevented) event.preventDefault();

  // ② 内层弹层接管：只挡 window。
  if (escapeWithNestedPopup.has(event)) {
    event.stopPropagation();
    return;
  }

  // ③ 正常情况：连 document 上后注册的监听一起挡。
  event.stopImmediatePropagation();
}

/**
 * 幂等安装守卫：`focusin` / `keydown` 各一段 capture（只记录）与一段 bubble（才拦截）。
 * 返回 `false` 表示「已经装过了」（不算错误）。
 *
 * 调用点只有一个：`AppShell` 的挂载 effect。
 */
export function installTouTouCardGuards(): boolean {
  if (installed) return false;
  installed = true;
  document.addEventListener("focusin", captureFocusIn, true);
  document.addEventListener("focusin", handleFocusIn);
  document.addEventListener("keydown", captureKeyDown, true);
  document.addEventListener("keydown", handleKeyDown);
  return true;
}

/** 卸载（只给测试与 HMR 复位用；线上调用点不需要，也不该调用）。 */
export function uninstallTouTouCardGuards(): void {
  installed = false;
  document.removeEventListener("focusin", captureFocusIn, true);
  document.removeEventListener("focusin", handleFocusIn);
  document.removeEventListener("keydown", captureKeyDown, true);
  document.removeEventListener("keydown", handleKeyDown);
}

/** 守卫是否已装（测试断言用）。 */
export function areTouTouCardGuardsInstalled(): boolean {
  return installed;
}
