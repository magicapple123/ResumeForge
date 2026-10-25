// SPDX-License-Identifier: Apache-2.0
/**
 * 「简历制作台」三栏宽度的状态机：拖拽 / 键盘微调 / 复位 / 持久化。
 *
 * 为什么单独成文件而不是塞进 `ResumeZoomModal`：那个文件已经是"外壳 + 三栏 + 动作条"的
 * 组合根，而这里是一套**有状态的指针交互**（按下 → 移动 → 松手 → 落盘），塞进去之后
 * 读代码的人要在 JSX 中间跳着找状态。渲染仍归 `ResumeZoomModal`，本文件只产出数字与
 * 事件处理器（不渲染任何节点，`popupGuard` 也就不用管它）。
 *
 * ## 三条约束
 *
 * 1. **持久化必须 clamp**：`localStorage` 里可能是上一版允许、这一版不允许的值（用户调
 *    过 900px，后来我们把上限收紧到 760px）。读到越界值直接用，滚动条与纸面都会失真，
 *    所以读的时候一律过一遍 `clampWorkbenchWidth`。
 * 2. **拖动不许把任何一栏压到 0**：参数栏、内容栏有各自的最小值（380 / 380），预览栏
 *    靠"容器宽度 − 已用宽度 − 两条分隔条 ≥ 420"反推这两栏的上限。容器宽度量不到时
 *    （首帧、jsdom）退回"只看各自的最大值"，不会算出负数。
 * 3. **落盘只在"动作结束"时发生**：拖动期间每次 `mousemove` 都写一次 `localStorage` 是
 *    每秒几十次的同步 IO，而中间态没有任何保留价值。拖动落盘在 `mouseup`，键盘与复位
 *    立即落盘（它们本来就是一次性的动作）。
 *
 * ## 为什么拖动期间不 setState
 *
 * 每一帧都 `setWidths` 会把 `ResumeZoomModal` 整棵子树重渲染一遍：左栏 4 个参数分组
 * （几十个 antd 控件）+ 中栏编辑器 + 右栏预览 iframe。代价不只是 React 的 diff——预览
 * 是 iframe，栏宽一变它就要**重新按新宽度适配一遍分页**。一次拖动有几十到上百个
 * `mousemove`，于是用户看到的是"卡顿"，而不是"有点慢"。
 *
 * 所以拖动期间只写 DOM：把新的宽度写进容器的 `--resume-wb-*` 自定义属性。布局仍然由
 * CSS 算（一样会重排），但那只是一次样式重算，不动 React 树、不重建 iframe。
 * `widthsRef` 同步更新，它只给事件处理器读——是**处理器之间**的通信，不是渲染数据。
 * 松手时 `setWidths` 一次，把这一场拖动的结果交给 React，持久化也在那一刻发生。
 *
 * **不做 rAF 节流**：`style.setProperty` 是 O(1)，一次 `mousemove` 写一次就够，
 * 再包一层 `requestAnimationFrame` 只会把"跟手"推迟一帧——收益为零（渲染本来就不发生），
 * 却让"移动后立刻能读到新宽度"这条可测性质消失。
 *
 * ## 为什么用 mouse 事件而不是 pointer 事件
 *
 * 分隔条在 `<1280px` 与 `<1000px` 两档都不渲染（见 `resume-workbench.css`），也就是说
 * 它只存在于桌面三栏形态——那一档只有鼠标。用 `mousedown/mousemove/mouseup` 换来的是
 * 一个能在 jsdom 里真实跑通的拖拽用例（jsdom 没有 `PointerEvent`，`fireEvent.pointerDown`
 * 会退化成不带 `clientX` 的普通 `Event`，测出来的宽度永远是 NaN）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, RefObject } from "react";

/** 可拖动的两条分隔条：参数栏与内容栏各一条（预览栏吃掉剩余，不需要自己的宽度）。 */
export type WorkbenchColumnKind = "params" | "editor";

export interface WorkbenchColumnWidths {
  params: number;
  editor: number;
}

/**
 * 参数栏**默认宽**（2026-10-25 起可拖动改宽；用户口径："第一列也支持调整宽度"）。
 *
 * 380 是算出来的，不是拍的：去掉两侧 20px 内边距剩 340，最长的一行「页边距」需要
 * 「标签 72 + 6 + 控件列 152 + 6 + 尾部 102」= 338，还剩 2px（见
 * `workbenchLayoutContract.test.ts` 的算式）。这也是参数栏的**默认**宽：用户拖动时
 * 只在这个值的基础上变宽/变窄，不再回到 2026-10-23 那次"固定宽"的取舍。
 *
 * 为什么下限取 360 而不是更小：内容宽 340 是那套三列参数行的硬下限，再窄一行就装不下
 * （滚动条还占 6px）。为什么上限 640：再宽左栏就喧宾夺主，预览栏会先被挤到画布最小宽
 * （`WORKBENCH_CANVAS_MIN_WIDTH`）之下——容器 clamp 也会在窗口不够宽时自动降上限。
 */
export const WORKBENCH_PARAMS_WIDTH = 380;

/**
 * 默认宽度：参数栏固定 400 / 内容栏 448（用户 2026-10 明确要求"内容列默认稍宽一点"）。
 */
export const WORKBENCH_DEFAULT_WIDTHS: WorkbenchColumnWidths = {
  params: WORKBENCH_PARAMS_WIDTH,
  editor: 448,
};

/**
 * 各栏的下限与上限（px）。
 *
 * 参数栏 2026-10-25 起可调：`min` 是"三列参数行不溢出"的硬下限（内容宽 340 再减滚动条
 * 6px 的余量），`max` 是"别把预览挤没"的软上限（容器不够宽时 `clampWidthForContainer`
 * 还会继续往下压）。内容栏的 380–760 保持不变。
 */
export const WORKBENCH_WIDTH_LIMITS: Record<WorkbenchColumnKind, { min: number; max: number }> = {
  params: { min: 360, max: 640 },
  editor: { min: 380, max: 760 },
};

/** 预览栏的最小宽度：页面是 A4 等比缩放的，再窄就只剩一条白边。 */
export const WORKBENCH_CANVAS_MIN_WIDTH = 420;

/** 与 `resume-workbench.css` 的 `.resume-wb-resizer { flex-basis: 6px }` 必须一致。 */
export const WORKBENCH_RESIZER_WIDTH = 6;

/** 键盘 ←/→ 的一次步长。16px 与 antd 的间距刻度同源，按住不放也不至于跑飞。 */
export const WORKBENCH_KEYBOARD_STEP = 16;

/** 持久化键：形如 `resume.wb.widths`（偏好类数据，允许 localStorage）。 */
export const WORKBENCH_WIDTHS_STORAGE_KEY = "resume.wb.widths";

/** 通用数值夹取：非有限数（NaN / Infinity）一律回落到下限，避免污染 CSS。 */
function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** 把单个宽度夹进"这一栏自己的"上下限（不看容器，用于读取历史值）。 */
export function clampWorkbenchWidth(kind: WorkbenchColumnKind, value: number): number {
  const { min, max } = WORKBENCH_WIDTH_LIMITS[kind];
  return clampNumber(value, min, max);
}

/**
 * 拖动时用的夹取：在"这一栏自己的上下限"之外，还要保证预览栏拿到 ≥
 * `WORKBENCH_CANVAS_MIN_WIDTH`。容器宽度未知（0 / jsdom）时不施加这一条。
 */
export function clampWidthForContainer(
  kind: WorkbenchColumnKind,
  value: number,
  other: number,
  containerWidth: number,
): number {
  const { min, max } = WORKBENCH_WIDTH_LIMITS[kind];
  const reserved = other + WORKBENCH_CANVAS_MIN_WIDTH + WORKBENCH_RESIZER_WIDTH * 2;
  const ceiling = containerWidth > reserved ? Math.min(max, containerWidth - reserved) : max;
  // 上下限本身冲突时（容器比三栏最小值还窄）以**下限**为准：宁可让预览栏挤一点，
  // 也不把参数栏压到读不出文字。这一档本来就不渲染分隔条。
  return clampNumber(value, min, Math.max(min, ceiling));
}

/** 读 `localStorage` 里那一份；坏数据、缺字段、越界值一律降级成默认值。 */
export function parseStoredWidths(raw: string | null): WorkbenchColumnWidths {
  if (!raw) return WORKBENCH_DEFAULT_WIDTHS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return WORKBENCH_DEFAULT_WIDTHS;
    const record = parsed as Record<string, unknown>;
    return {
      params: clampWorkbenchWidth("params", Number(record.params)),
      editor: clampWorkbenchWidth("editor", Number(record.editor)),
    };
  } catch {
    return WORKBENCH_DEFAULT_WIDTHS;
  }
}

/** 读一次持久化值。`localStorage` 在隐私模式/配额满时会抛，所以整段包住。 */
export function readStoredWidths(): WorkbenchColumnWidths {
  try {
    return parseStoredWidths(window.localStorage.getItem(WORKBENCH_WIDTHS_STORAGE_KEY));
  } catch {
    return WORKBENCH_DEFAULT_WIDTHS;
  }
}

function writeStoredWidths(widths: WorkbenchColumnWidths): void {
  try {
    window.localStorage.setItem(WORKBENCH_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // 落盘失败不影响这一屏的使用：宽度在本次会话里仍然生效。
  }
}

export interface WorkbenchColumnsApi {
  widths: WorkbenchColumnWidths;
  /** 挂到 `.resume-wb-body` 上：拖动时用它量容器宽度。 */
  containerRef: RefObject<HTMLDivElement | null>;
  /** 挂到 `.resume-wb-body` 上：两个宽度以自定义属性传给 CSS。 */
  style: CSSProperties;
  /** 正在拖哪一条（用于高亮与 `cursor`）。 */
  draggingKind: WorkbenchColumnKind | null;
  startDrag: (kind: WorkbenchColumnKind, event: ReactMouseEvent<HTMLElement>) => void;
  /** 键盘 ←/→ 与将来的按钮共用；正值变宽。 */
  nudge: (kind: WorkbenchColumnKind, delta: number) => void;
  /** 复位：两条分隔条都回到默认宽度（双击分隔条与动作条上的「恢复默认列宽」共用）。 */
  reset: () => void;
}

export function useWorkbenchColumns(): WorkbenchColumnsApi {
  const [widths, setWidths] = useState<WorkbenchColumnWidths>(readStoredWidths);
  const [draggingKind, setDraggingKind] = useState<WorkbenchColumnKind | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // 拖拽处理器在 window 上，读不到最新的 state 闭包值（它是在 `mousedown` 那一刻创建的）。
  // 用一个 ref 把"当前宽度"共享出去：它是**事件处理器之间**的通信，不是渲染期数据。
  const widthsRef = useRef<WorkbenchColumnWidths>(widths);
  // 卸载时摘掉 window 监听与 `body` 上的拖拽标记：拖到一半把弹窗关掉（Esc）是常见操作，
  // 漏清会让整个页面永远停在 `cursor: col-resize` + 不可选中文字的状态。
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  /**
   * 写宽度并触发一次渲染。**只给一次性动作用**（键盘微调、复位）——拖动不走这里，
   * 理由见文件头"为什么拖动期间不 setState"。返回值 = 宽度是否真的变了。
   */
  const applyWidth = useCallback((kind: WorkbenchColumnKind, value: number) => {
    const previous = widthsRef.current;
    if (previous[kind] === value) return false;
    const next = { ...previous, [kind]: value };
    widthsRef.current = next;
    setWidths(next);
    return true;
  }, []);

  const containerWidth = useCallback((): number => {
    const measured = containerRef.current?.clientWidth ?? 0;
    // 首帧（还没挂上）与 jsdom（永远是 0）回落到窗口宽度：它至少是同一个数量级，
    // 并且让 clamp 仍然走"保证预览栏"的那条支路。
    return measured > 0 ? measured : window.innerWidth;
  }, []);

  const startDrag = useCallback(
    (kind: WorkbenchColumnKind, event: ReactMouseEvent<HTMLElement>) => {
      // 只认左键：右键菜单与中键粘贴不该把分隔条拖走。
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = widthsRef.current[kind];
      const otherWidth = widthsRef.current[kind === "params" ? "editor" : "params"];
      const width = containerWidth();
      /** 这一条分隔条改的是哪个自定义属性（与 `resume-workbench.css` 的两个变量同名）。 */
      const prop = kind === "params" ? "--resume-wb-params" : "--resume-wb-editor";
      setDraggingKind(kind);
      document.body.classList.add("is-resizing");

      // 拖动期间只写 DOM，且**同步**写：`setProperty` 是 O(1)，不触发 React 渲染，
      // 也不需要再叠一层 rAF 合并——合并只会把"跟手"推迟一帧，而收益为零（渲染本来就不发生）。
      /** 把指针横坐标折算成宽度，写进容器（**不**触发渲染）。 */
      const applyDrag = (clientX: number) => {
        const next = clampWidthForContainer(
          kind,
          startWidth + (clientX - startX),
          otherWidth,
          width,
        );
        if (widthsRef.current[kind] === next) return;
        widthsRef.current = { ...widthsRef.current, [kind]: next };
        containerRef.current?.style.setProperty(prop, `${next}px`);
      };

      const handleMove = (moveEvent: MouseEvent) => {
        // **松手发生在监听范围内收不到的地方**（鼠标移出窗口后松开、在预览 iframe 里松开、
        // 系统弹了权限框）时，`mouseup` 永远不会到达 window，拖动状态会一直挂着——表现就是
        // 用户说的"取消长按后仍然保持拖动宽度"。
        //
        // 两道兜底，缺一不可：
        // 1. 这里看 `buttons`：左键已经不按了就直接收尾。浏览器保证任何一次 mousemove 都带着
        //    当前按键位，所以回到页面后的第一次移动就能纠正过来；
        // 2. `blur`（见下面）：切走窗口的瞬间就收尾，不必等用户把鼠标移回来。
        // iframe 上还会额外吃掉 mousemove，所以 `body.is-resizing iframe` 在 CSS 里被设成
        // `pointer-events: none`（见 `resume-workbench.css`），让指针滑过预览区时事件不丢。
        if (moveEvent.buttons === 0) {
          finish();
          return;
        }
        applyDrag(moveEvent.clientX);
      };

      const finish = () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", finish);
        window.removeEventListener("blur", finish);
        document.body.classList.remove("is-resizing");
        cleanupRef.current = null;
        setDraggingKind(null);
        // 整场拖动**只在这里** setState 一次：把结果交给 React（以及持久化）。
        setWidths(widthsRef.current);
        // 松手才落盘：拖动期间每次移动都写 localStorage 是每秒几十次同步 IO。
        writeStoredWidths(widthsRef.current);
      };

      cleanupRef.current = finish;
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", finish);
      // 窗口失去焦点（切到别的应用、系统弹框）也当作松手：不这么做的话，用户回来时
      // 分隔条还停在 `cursor: col-resize`、页面还禁着文字选中。
      window.addEventListener("blur", finish);
    },
    [containerWidth],
  );

  const nudge = useCallback(
    (kind: WorkbenchColumnKind, delta: number) => {
      const otherWidth = widthsRef.current[kind === "params" ? "editor" : "params"];
      const next = clampWidthForContainer(
        kind,
        widthsRef.current[kind] + delta,
        otherWidth,
        containerWidth(),
      );
      if (applyWidth(kind, next)) writeStoredWidths(widthsRef.current);
    },
    [applyWidth, containerWidth],
  );

  const reset = useCallback(() => {
    widthsRef.current = WORKBENCH_DEFAULT_WIDTHS;
    setWidths(WORKBENCH_DEFAULT_WIDTHS);
    writeStoredWidths(WORKBENCH_DEFAULT_WIDTHS);
  }, []);

  const style = {
    "--resume-wb-params": `${widths.params}px`,
    "--resume-wb-editor": `${widths.editor}px`,
  } as CSSProperties;

  return { widths, containerRef, style, draggingKind, startDrag, nudge, reset };
}
