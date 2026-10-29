// SPDX-License-Identifier: Apache-2.0
/**
 * 「草稿模式编辑」的**状态机**：勾选值、click / contextmenu 监听注册、样式刷新、右键菜单状态。
 *
 * 它补的是全仓最后缺的那一根线：后端模板早就给每处文本打了 `data-resume-path`
 * （`_resume_sections.j2`），`resume-editor/ResumeEditorTarget.ts` 也早就会把路径翻成
 * 「哪个标签页 + 哪个表单字段」，而"点一下纸面 → 把路径交出去"这一跳以前没人做。
 *
 * ## 四条硬约束（都不是可选优化）
 *
 * 1. **监听只挂一次**：`onLoad` 会因为重渲染与"下一帧补测"反复触发同一个文档，不去重就会
 *    "点一次跳 N 次"（N = 挂了几次）。去重靠 `WeakSet`：`srcDoc` 每次重载都会生成**新的**
 *    文档对象，按身份判重既正确，也不会把旧文档留在内存里。
 * 2. **命中才回调**：`closest("[data-resume-path]")` 没命中就什么都不做——点空白、点分页
 *    间隙都不该有反应。命中时只 `preventDefault()`（挡住 `<a>` 之类的默认跳转），
 *    **不** `stopPropagation`：文档里其它监听（文本选择、将来的批注）该收到就收到。
 * 3. **状态住在这里，样式注入在 `./clickToEdit`**：勾选值要同时被工具栏（复选框）与纸面
 *    （挂监听）读到，而 `ResumePreview.tsx` 贴着行数预算——所以这一层抽成独立 hook。
 *    纯函数（持久化 / 命中 / 注入）另放一处，jsdom 里能直接喂假文档测，不必挂 React。
 * 4. **右键只在四种情况下劫持**：勾选了草稿模式编辑 + 草稿模式 + 宿主给了 `richEdit` +
 *    选区真的落在一处字段里且偏移量对得上。其余一律放行原生菜单——用户想复制一句话时
 *    不该因为我们"顺手接管了右键"而失去浏览器的复制/拼写检查。
 *
 * 菜单本身是父页面的浮层（`./BoldContextMenu`）：iframe 里画会把选区弄丢，纸面的缩放与
 * 分栏变换也会让定位漂移。所以这里只产出"菜单该长什么样"的数据，渲染交给调用方。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  hasTextSelection,
  paintClickToEdit,
  paintLoadedFrames,
  readStoredClickToEdit,
  resolvePickPath,
  writeStoredClickToEdit,
} from "./clickToEdit";
import { forwardWheelToParent } from "./useFrameInteractions";
import { paintRichField, toggleBold, type RichTextEditAdapter } from "./richText";
import { menuPoint, resolveRichSelection, restoreRichSelection } from "./richSelection";

export type { RichTextEditAdapter } from "./richText";

export interface ClickToEditPreviewOptions {
  /** 预览视口（里面有 N 个 page iframe）：切换勾选时靠它找到所有文档。 */
  containerRef: RefObject<HTMLElement | null>;
  /** 只有草稿模式能点：精确模式是一张 PDF，纸面上没有可点的 DOM。 */
  draftMode: boolean;
  /** 宿主给的落点回调。不传 = 整条链路不激活（导出/分享等只读宿主零影响）。 */
  onPickField?: (path: string) => void;
  /**
   * 右键加粗的最小契约。不传 = 右键完全交给浏览器（导出/分享那种只读宿主一行都不用改）。
   */
  richEdit?: RichTextEditAdapter;
}

/** 菜单要渲染的全部内容（坐标为**父页面**视口坐标）。 */
export interface BoldMenuState {
  x: number;
  y: number;
  isBold: boolean;
  onToggle: () => void;
  onPick: () => void;
  onClose: () => void;
}

export interface ClickToEditPreviewApi {
  /** 复选框的受控值（与 `localStorage` 同步）。 */
  checked: boolean;
  setChecked: (next: boolean) => void;
  /** 宿主是否提供了落点回调：没有就整条链路不渲染成可用。 */
  available: boolean;
  /** 生效值 = 勾选 + 草稿模式 + 宿主可用。 */
  active: boolean;
  /** 给一个 page iframe 的文档挂监听 + 注入样式。重复调用安全。 */
  bindDocument: (doc: Document | null) => void;
  /** 右键菜单；`null` = 没打开（调用方据此决定渲不渲染 `<BoldContextMenu/>`）。 */
  boldMenu: BoldMenuState | null;
}

/** 一次右键命中的快照（菜单期间不变：内容还没被改）。 */
interface BoldTarget {
  x: number;
  y: number;
  path: string;
  raw: string;
  start: number;
  end: number;
  isBold: boolean;
  element: Element | null;
}

export function useClickToEditPreview({
  containerRef,
  draftMode,
  onPickField,
  richEdit,
}: ClickToEditPreviewOptions): ClickToEditPreviewApi {
  const [checked, setCheckedState] = useState(readStoredClickToEdit);
  const [target, setTarget] = useState<BoldTarget | null>(null);
  const available = Boolean(onPickField);
  // 勾选的是"点击定位"这条链路；右键加粗是它的增量能力（宿主给了 `richEdit` 才有），
  // 所以 `active` 不把 `richEdit` 算进去——只读宿主给了 `onPickField` 时复选框照旧可用。
  const active = checked && draftMode && available;
  /**
   * 处理器只挂一次（文件头第 1 条约束），所以它必须读到**最新**的开关与回调。
   * 这几个 ref 是"处理器之间"的通信，不是渲染期数据。
   */
  const activeRef = useRef(active);
  const pickRef = useRef(onPickField);
  const richRef = useRef(richEdit);
  /** 已经挂过监听的文档。`WeakSet` 避免长期持有被换掉的旧文档。 */
  const boundRef = useRef<WeakSet<Document>>(new WeakSet());

  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    pickRef.current = onPickField;
  }, [onPickField]);
  useEffect(() => {
    richRef.current = richEdit;
  }, [richEdit]);

  const handleClick = useCallback((event: MouseEvent) => {
    if (!activeRef.current) return;
    /*
     * 纸面上**有选中文字**时不接管这一拍（2026-10-29 用户要求："预览里的文字也要能选中"）。
     * 拖选结束必然跟一发 click：如果照样跳去编辑栏，焦点会被 textarea 拿走，用户刚拖出来的
     * 选区立刻作废——体感就是"预览里根本选不中字"。所以有非空选区就原样放行，既不改默认行为
     * 也不回调；清掉选区之后的**下一次单击**仍然正常定位（那才是"点一下跳到字段"）。
     */
    const doc = (event.target as Node | null)?.ownerDocument ?? null;
    if (hasTextSelection(doc)) return;
    const path = resolvePickPath(event.target);
    // 没命中（点空白、点分页间隙）：什么都不做，别把"点错了"变成一个跳转。
    if (!path) return;
    // 只挡默认行为，不 `stopPropagation`（文件头第 2 条约束）。
    event.preventDefault();
    pickRef.current?.(path);
  }, []);

  /**
   * 右键：只在"确实能改"的时候接管。任何一环不成立就原样返回——**不** `preventDefault`，
   * 原生菜单（复制 / 全选 / 检查元素）照旧出现。
   */
  const handleContextMenu = useCallback((event: MouseEvent) => {
    if (!activeRef.current) return;
    const rich = richRef.current;
    if (!rich) return;
    const doc = (event.target as Node | null)?.ownerDocument ?? null;
    if (!doc) return;
    const hit = resolveRichSelection(doc, rich.read);
    if (!hit) return;
    event.preventDefault();
    const point = menuPoint(doc, event);
    setTarget({
      x: point.x,
      y: point.y,
      path: hit.path,
      raw: hit.raw,
      start: hit.start,
      end: hit.end,
      isBold: hit.isBold,
      element: hit.element,
    });
  }, []);

  /**
   * 编辑模式下 iframe 会重新接收指针（`resume-canvas.css` 的
   * `.is-click-to-edit .resume-iframe`），这带来一个必须一起处理的副作用：
   * **滚轮事件也落进了 iframe**，而 iframe 是独立文档，不会冒泡到父页面——
   * 用户在纸面上滚一下会发现整页纹丝不动（原来 `pointer-events: none` 时滚轮落在
   * 父容器上，是能滚的）。所以把纵向滚动按同一条规则转交出去。
   *
   * 只在编辑模式下转：平时这条监听收到的事件为 0（指针根本进不来），
   * 但留着 `activeRef` 判断，免得将来 pointer-events 的取值一变就悄悄多滚一次。
   */
  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (!activeRef.current) return;
      /*
       * Ctrl/Cmd 按下时**让路**：那一拍归 `ResumePreview` 的缩放（同一个文档上还有它注册的
       * wheel 监听）。不判断的话两只手会同时动——缩放一下、纸又滚一段，用户看到的就是
       * "按住 Ctrl 滚轮反而上下移动"（2026-10-29 用户实测，只在勾了「草稿模式编辑」时出现，
       * 因为只有这时本 hook 才往 iframe 里挂监听）。
       */
      if (event.ctrlKey || event.metaKey) return;
      if (forwardWheelToParent(containerRef.current, event)) event.preventDefault();
    },
    [containerRef],
  );

  const bindDocument = useCallback(
    (doc: Document | null) => {
      if (!doc?.documentElement) return;
      if (boundRef.current.has(doc)) {
        // 同一个文档又触发了一次 onLoad（重渲染 / 第二帧补测）：只补刷样式，不重复挂监听。
        paintClickToEdit(doc, activeRef.current);
        return;
      }
      boundRef.current.add(doc);
      doc.addEventListener("click", handleClick);
      // 右键与 click 是同一批"iframe 重新接收指针"的产物，漏一条就变成"点了能跳、右键没反应"。
      doc.addEventListener("contextmenu", handleContextMenu);
      // 滚轮也要挂：它和 click 是同一批"iframe 重新接收指针"的产物，漏一条就滚不动。
      doc.addEventListener("wheel", handleWheel, { passive: false });
      paintClickToEdit(doc, activeRef.current);
    },
    [handleClick, handleContextMenu, handleWheel],
  );

  // 勾选状态一变就把已经加载好的每个文档刷一遍（见 `paintLoadedFrames` 的说明）。
  useEffect(() => {
    paintLoadedFrames(containerRef.current, active);
  }, [active, containerRef]);

  const setChecked = useCallback((next: boolean) => {
    setCheckedState(next);
    writeStoredClickToEdit(next);
  }, []);

  const closeBoldMenu = useCallback(() => setTarget(null), []);

  /**
   * 点「加粗 / 取消加粗」：先就地改 iframe 里那一栏（立刻看到粗体，用户不必等一次网络往返），
   * 再把新源串交给宿主——宿主记进 overlay 并把内容标脏，整份重渲染负责收口。
   *
   * 顺序不能反：先改 overlay 会让 R5 的实时预览提前重渲染整份文档，iframe 一换，
   * 这里拿到的 `element` 就成了孤儿，局部更新会静默失败（体感是"点了没反应"）。
   */
  const applyBold = useCallback(() => {
    const current = target;
    const rich = richRef.current;
    if (!current || !rich) return;
    setTarget(null);
    const { next, range } = toggleBold(current.raw, current.start, current.end);
    if (next === current.raw) return;
    paintRichField(current.element, next);
    restoreRichSelection(current.element, range[0], range[1]);
    rich.toggle(current.path, next, current.raw);
  }, [target]);

  const pickFromMenu = useCallback(() => {
    const current = target;
    if (!current) return;
    setTarget(null);
    const pick = richRef.current?.onPick ?? pickRef.current;
    pick?.(current.path);
  }, [target]);

  const boldMenu = useMemo<BoldMenuState | null>(() => {
    if (!target) return null;
    return {
      x: target.x,
      y: target.y,
      isBold: target.isBold,
      onToggle: applyBold,
      onPick: pickFromMenu,
      onClose: closeBoldMenu,
    };
  }, [applyBold, closeBoldMenu, pickFromMenu, target]);

  return { checked, setChecked, available, active, bindDocument, boldMenu };
}
