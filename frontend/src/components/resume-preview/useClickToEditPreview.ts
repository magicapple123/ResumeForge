// SPDX-License-Identifier: Apache-2.0
/**
 * 「草稿模式编辑」的**状态机**：勾选值、click 监听注册、样式刷新。
 *
 * 它补的是全仓最后缺的那一根线：后端模板早就给每处文本打了 `data-resume-path`
 * （`_resume_sections.j2`），`resume-editor/ResumeEditorTarget.ts` 也早就会把路径翻成
 * 「哪个标签页 + 哪个表单字段」，而"点一下纸面 → 把路径交出去"这一跳以前没人做。
 *
 * ## 三条硬约束（都不是可选优化）
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
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  paintClickToEdit,
  paintLoadedFrames,
  readStoredClickToEdit,
  resolvePickPath,
  writeStoredClickToEdit,
} from "./clickToEdit";
import { forwardWheelToParent } from "./useFrameInteractions";

export interface ClickToEditPreviewOptions {
  /** 预览视口（里面有 N 个 page iframe）：切换勾选时靠它找到所有文档。 */
  containerRef: RefObject<HTMLElement | null>;
  /** 只有草稿模式能点：精确模式是一张 PDF，纸面上没有可点的 DOM。 */
  draftMode: boolean;
  /** 宿主给的落点回调。不传 = 整条链路不激活（导出/分享等只读宿主零影响）。 */
  onPickField?: (path: string) => void;
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
}

export function useClickToEditPreview({
  containerRef,
  draftMode,
  onPickField,
}: ClickToEditPreviewOptions): ClickToEditPreviewApi {
  const [checked, setCheckedState] = useState(readStoredClickToEdit);
  const available = Boolean(onPickField);
  const active = checked && draftMode && available;
  /**
   * 点击处理器只挂一次（文件头第 1 条约束），所以它必须读到**最新**的开关与回调。
   * 两个 ref 是"处理器之间"的通信，不是渲染期数据。
   */
  const activeRef = useRef(active);
  const pickRef = useRef(onPickField);
  /** 已经挂过监听的文档。`WeakSet` 避免长期持有被换掉的旧文档。 */
  const boundRef = useRef<WeakSet<Document>>(new WeakSet());

  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    pickRef.current = onPickField;
  }, [onPickField]);

  const handleClick = useCallback((event: MouseEvent) => {
    if (!activeRef.current) return;
    const path = resolvePickPath(event.target);
    // 没命中（点空白、点分页间隙）：什么都不做，别把"点错了"变成一个跳转。
    if (!path) return;
    // 只挡默认行为，不 `stopPropagation`（文件头第 2 条约束）。
    event.preventDefault();
    pickRef.current?.(path);
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
      // 滚轮也要挂：它和 click 是同一批"iframe 重新接收指针"的产物，漏一条就滚不动。
      doc.addEventListener("wheel", handleWheel, { passive: false });
      paintClickToEdit(doc, activeRef.current);
    },
    [handleClick, handleWheel],
  );

  // 勾选状态一变就把已经加载好的每个文档刷一遍（见 `paintLoadedFrames` 的说明）。
  useEffect(() => {
    paintLoadedFrames(containerRef.current, active);
  }, [active, containerRef]);

  const setChecked = useCallback((next: boolean) => {
    setCheckedState(next);
    writeStoredClickToEdit(next);
  }, []);

  return { checked, setChecked, available, active, bindDocument };
}
