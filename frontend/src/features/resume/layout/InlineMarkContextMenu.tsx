// SPDX-License-Identifier: Apache-2.0
/**
 * 行内格式的**右键菜单**（F22）：输入框上右键选中文字 → 加粗 / 字号 / 颜色 / 链接 / 清除格式。
 *
 * ## 为什么只有"选区非空"才接管
 *
 * 空白处的右键菜单是浏览器给的（复制/粘贴/检查等），输入框里空选区右键也常用它。
 * 所以 `onContextMenu` 先看目标输入框的实时选区：空选区**原样放行**——不
 * `preventDefault`、不开自己的菜单。只有选中了文字才拦住原生菜单。
 *
 * ## 定位
 *
 * 用受控 `Dropdown`（`trigger={[]}`）+ `align.targetOffset` 把菜单放到鼠标那一点：
 * 触发动作由我们自己在 `contextmenu` 里判断，而不是交给 Dropdown 的
 * `contextMenu` 触发器（那条路径会无条件 `preventDefault`，空选区就没法放行）。
 *
 * ## 复用同一批纯函数
 *
 * 菜单项与工具条走同样的 `toggleBoldMark` / `applyStyleMark` / `clearInlineMarks` /
 * `insertLinkMark`，不在这里重写标记规则。
 */
import { Button, Dropdown, Input, Space } from "antd";
import type { MenuProps } from "antd";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { anchoredPlacement, triggerTargetOffset } from "../../../utils/anchoredPlacement";
import { FALLBACK_MENU_SIZE, MEASURE_RETRY_LIMIT } from "./inlineMarkMenuMeasure";
import {
  applyStyleMark,
  clearInlineMarks,
  COLOR_PRESETS,
  insertLinkMark,
  INLINE_SIZE_STEPS,
  toggleBoldMark,
  type InlineEdit,
  type InlineRange,
} from "./inlineMarks";
import {
  richClearAttribute,
  richClearStyles,
  richSetLink,
  richToggleBold,
  richToggleColor,
  richToggleSize,
} from "../editor/inlineMarkWrite";
import type { InlineMarkCommit } from "./InlineMarkButtons";
import "../../../styles/inline-mark-menu.css";

/** DF-3：菜单与光标之间的间距（下方看下沿、上方看上沿，都不贴死指针）。 */
const MENU_GAP = 4;

/**
 * I-11：测量重试的上限与兜底判定住在 `inlineMarkMenuMeasure`（纯函数，可逐值断言）。
 * portal 因异常一直没挂上时**不能**让菜单永远不可见——退化成"位置可能不准但能用"，
 * 比"右键点了没反应"好。
 */

/**
 * I-11：菜单外壳的隐藏样式——**落点还没算出来时连 antd 的 `.ant-dropdown` 一起隐藏**。
 *
 * 之前 `visibility: hidden` 只挂在 `popupRender` 的内层，白底圆角的外壳仍会在宿主左上角
 * 闪一帧（首帧 `targetOffset` 是 `[0, 0]`，语义是"贴宿主左上角"）。导出成纯函数是为了
 * 让结构守卫能直接断言这一条，而不必去追 antd portal 的渲染时序。
 */
export function menuRootStyle(placed: boolean): CSSProperties | undefined {
  return placed ? undefined : { visibility: "hidden" };
}

interface Props {
  onCommit: (next: InlineMarkCommit) => void;
  disabled?: boolean;
  children: ReactNode;
}

interface Snapshot {
  text: string;
  range: InlineRange;
}

/** 右键落点（视口坐标）与该时刻宿主（卡片）的左上角——antd 的 targetOffset 是相对宿主的。 */
interface Anchor {
  x: number;
  y: number;
  hostLeft: number;
  hostTop: number;
}

function liveRange(target: EventTarget | null): Snapshot | null {
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement))
    return null;
  const start = target.selectionStart ?? 0;
  const end = target.selectionEnd ?? start;
  return end > start ? { text: target.value, range: { start, end } } : null;
}

function sizeItems(): NonNullable<MenuProps["items"]> {
  const steps = INLINE_SIZE_STEPS.map((step) => ({
    key: `size:${step}`,
    label: `${Math.round(step * 100)}%`,
  }));
  return [
    ...steps.slice(0, 2),
    { key: "size:clear", label: t("typography.inline.sizeClear") },
    ...steps.slice(2),
  ];
}

export default function InlineMarkContextMenu({ onCommit, disabled = false, children }: Props) {
  useLocale();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  /**
   * 与 `linkMode` 同步的 ref：antd 的 Dropdown 在菜单项点击的**同一拍**就上报
   * `onOpenChange(false)`，此时 `setLinkMode(true)` 还没重渲染，读 state 会是旧值
   * `false`，于是刚展开的链接输入框被立刻收起。判断必须走 ref。
   */
  const linkModeRef = useRef(false);
  const [url, setUrl] = useState("");
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  /** 菜单实测尺寸（DF-3：先测后定；未测到前弹层 `visibility: hidden`）。 */
  const [menuSize, setMenuSize] = useState<{ width: number; height: number } | null>(null);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  /** 遮罩层级 = 菜单弹层层级 - 1（主题的 zIndexPopupBase 可在运行时被改，所以实测）。 */
  const [maskZIndex, setMaskZIndex] = useState<number | null>(null);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  /** I-11：本轮打开已经重试了几次（超限后强制显示）。 */
  const attempts = useRef(0);

  const close = () => {
    setOpen(false);
    linkModeRef.current = false;
    setLinkMode(false);
    setUrl("");
    setAnchor(null);
    setMenuSize(null);
    setMaskZIndex(null);
  };

  /**
   * DF-3：打开后量一次菜单的**实际**尺寸，再决定下方还是上方。
   *
   * 只在打开（以及 resize）时量：子菜单与「插入链接…」造成的增高由 `max-height` 兜底，
   * 不反过来推动主菜单跳动。同样只在测量完成后才让弹层可见，避免"先闪一下再翻上去"。
   */
  useLayoutEffect(() => {
    if (!open) return;
    let cancelled = false;
    attempts.current = 0;
    const measure = () => {
      if (cancelled) return;
      const node = popupRef.current;
      if (!node) {
        // 弹层由 antd portal 挂载，可能比这次 commit 晚一拍；等一帧再量。
        // I-11：但重试必须有上限——无限等下去会让菜单永远停在 `visibility: hidden`。
        attempts.current += 1;
        if (attempts.current >= MEASURE_RETRY_LIMIT) {
          setMenuSize(FALLBACK_MENU_SIZE);
          return;
        }
        window.setTimeout(measure, 16);
        return;
      }
      const rect = node.getBoundingClientRect();
      setMenuSize({ width: rect.width, height: rect.height });
      const overlay = node.closest(".ant-dropdown") as HTMLElement | null;
      const zIndex = overlay ? Number.parseInt(window.getComputedStyle(overlay).zIndex, 10) : NaN;
      setMaskZIndex(Number.isFinite(zIndex) ? zIndex - 1 : null);
    };
    measure();
    return () => {
      cancelled = true;
    };
  }, [open, viewport]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  /**
   * I-25 / DF-2：点菜单外任意处关闭。
   *
   * antd 的受控 Dropdown 只在"点击"时自己上报 onOpenChange，右键菜单常见的三种
   * 逃逸路径（在别处右键 / 点空白 / 拖选文字）都不在它的覆盖里，表现就是"点外不关"。
   * 这里用 capture 阶段的 mousedown 统一兜住：菜单里（含链接输入框）放行；
   * **宿主卡片内只放行右键**（交给 onContextMenu 重新定位），左键点卡片任何位置都关闭
   * ——此前整张卡片被当成豁免区，点同一卡片的别的字段也关不掉。
   *
   * 纸面 iframe 收不到父页面事件，那一半由 `.rf-inline-mark-mask` 透明遮罩兜住。
   */
  useEffect(() => {
    if (!open) return;
    // 注意类型：本文件导入的 `MouseEvent` 是 React 的合成事件类型，document 上的是原生事件。
    const onMouseDown = (event: Event) => {
      const node = event.target;
      if (!(node instanceof Node)) return;
      if (popupRef.current?.contains(node)) return;
      if (hostRef.current?.contains(node) && (event as globalThis.MouseEvent).button === 2) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    // 用 mousedown 而不是 pointerdown：指针事件在部分环境（jsdom / 老 Safari）
    // 不冒泡到 document，菜单就会"点外不关"——这正是本条要修的现象。
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
    // close 只做 setState，不依赖任何外部值（effect 只随 open 重挂）。
  }, [open]);

  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    const picked = liveRange(event.target);
    // 空选区 / 非输入框：放行原生菜单（不 preventDefault、不打开）。
    if (!picked) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    // DF-3：窗口在两次右键之间缩放过时，`viewport` 仍是打开时的旧值（监听只在菜单开着时挂），
    // 会让翻转判定拿旧高度算。每次打开都先对齐当前视口。
    setViewport({ width: window.innerWidth, height: window.innerHeight });
    setAnchor({
      x: event.clientX,
      y: event.clientY,
      hostLeft: rect.left,
      hostTop: rect.top,
    });
    setMenuSize(null);
    setSnapshot(picked);
    linkModeRef.current = false;
    setLinkMode(false);
    setUrl("");
    setOpen(true);
  };

  /**
   * DF-3 落点：下方优先；放不下翻到光标上方（菜单底边贴光标，留 `MENU_GAP`）。
   * 尺寸测到之前不定位也不显示（`visibility: hidden`），避免闪跳。
   */
  /**
   * 落点**永远**用真实尺寸或兜底尺寸算：`placement === null` 时 `targetOffset` 会退化成
   * `[0, 0]`，而 `[0, 0]` 的语义是"贴宿主左上角"——这正是首帧闪在宿主左上角的原因。
   * 能不能显示是另一件事，由下面的 `placed` 单独控制。
   */
  const placement = anchor
    ? anchoredPlacement(
        {
          top: anchor.y,
          left: anchor.x,
          right: anchor.x,
          bottom: anchor.y,
          width: 0,
          height: 0,
        },
        viewport,
        menuSize ?? FALLBACK_MENU_SIZE,
        { gap: MENU_GAP, alignX: "start" },
      )
    : null;
  /** 可见性：**测得真实尺寸之后**才显示（位置在测量期间已经按兜底尺寸算好了）。 */
  const placed = anchor !== null && placement !== null && menuSize !== null;

  // 两种方向的落点都已换算成"菜单左上角"（`placement.top` 在上方时是翻转后的顶边），
  // 所以 `points` 恒为 `["tl", "tl"]`：目标点是 Dropdown 的子元素（整张宿主卡片），
  // 经过下面的 `targetOffset` 后，它的左上角正好落在 `placement` 的左上角。
  const points: [string, string] = ["tl", "tl"];
  // `@rc-component/trigger` 的 `targetOffset` 是**从目标位置里减去**的
  // （`useAlign.js`: `targetRect.x -= targetOffsetX`），因此这里给的是
  // 「宿主左上角 − 目标落点」的差值；写反会让菜单以宿主为轴镜像偏移。
  const targetOffset: [number, number] =
    anchor && placement
      ? triggerTargetOffset(
          { left: anchor.hostLeft, top: anchor.hostTop },
          { left: placement.left, top: placement.top },
        )
      : [0, 0];

  const commit = (edit: InlineEdit) => {
    if (!snapshot || edit.text === snapshot.text) {
      close();
      return;
    }
    onCommit({ text: edit.text, selection: { start: edit.start, end: edit.end } });
    close();
  };

  const onClick: MenuProps["onClick"] = ({ key }) => {
    if (!snapshot) return;
    const { text, range } = snapshot;
    // I-13：结构化字段先走 runs（磁盘上落 `rich.runs`，不再拼接标记串）。
    if (key === "bold") {
      if (richToggleBold(range)) {
        close();
        return;
      }
      return commit(toggleBoldMark(text, range));
    }
    if (key === "link") {
      linkModeRef.current = true;
      setLinkMode(true);
      return;
    }
    if (key === "clear") {
      if (richClearStyles(range)) {
        close();
        return;
      }
      return commit(clearInlineMarks(text, range));
    }
    if (key === "size:clear") {
      if (richClearAttribute(range, { size: null })) {
        close();
        return;
      }
      return commit(applyStyleMark(text, range, { size: null }));
    }
    if (key === "color:clear") {
      if (richClearAttribute(range, { color: null })) {
        close();
        return;
      }
      return commit(applyStyleMark(text, range, { color: null }));
    }
    if (key.startsWith("size:")) {
      const size = Number(key.slice(5));
      if (richToggleSize(range, size)) {
        close();
        return;
      }
      return commit(applyStyleMark(text, range, { size }));
    }
    if (key.startsWith("color:")) {
      const color = key.slice(6);
      if (richToggleColor(range, color)) {
        close();
        return;
      }
      return commit(applyStyleMark(text, range, { color }));
    }
  };

  const items: MenuProps["items"] = [
    { key: "bold", label: t("typography.inline.bold") },
    { key: "size", label: t("typography.inline.size"), children: sizeItems() },
    {
      key: "color",
      label: t("typography.inline.color"),
      children: [
        ...COLOR_PRESETS.map((hex) => ({
          key: `color:${hex}`,
          label: (
            <span>
              <span
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  marginRight: 6,
                  background: hex,
                }}
              />
              {hex}
            </span>
          ),
        })),
        { key: "color:clear", label: t("typography.inline.colorClear") },
      ],
    },
    { key: "link", label: t("typography.inline.linkMenu") },
    { type: "divider" as const },
    { key: "clear", label: t("typography.inline.clearMarks") },
  ];

  const confirmLink = () => {
    if (!snapshot) return;
    const edit = insertLinkMark(snapshot.text, snapshot.range, url);
    if (!edit) return;
    // I-13：结构化字段写成 `link` run。
    if (richSetLink(snapshot.range, url.trim())) {
      close();
      return;
    }
    commit(edit);
  };

  return (
    <>
      {/* DF-2：透明遮罩。纸面是 iframe，父页面的 mousedown 收不到；遮罩挂在 body 上，
          比菜单弹层低一层（`maskZIndex`），因此既能盖住纸面，也不会挡住菜单自身点击。
          菜单开着时点一下纸面 = 关闭（不是"点不动的死区"），滚轮同样关闭。
          不放进弹层里：antd 的入场动画带 `transform`，`position: fixed` 会退化成
          相对弹层定位（文档 §4 DF-2 的退路）。 */}
      {open
        ? createPortal(
            <div
              className="rf-inline-mark-mask"
              aria-hidden="true"
              style={maskZIndex === null ? undefined : { zIndex: maskZIndex }}
              onMouseDown={close}
              onWheel={close}
            />,
            document.body,
          )
        : null}
      <Dropdown
        open={open}
        trigger={[]}
        // I-25：宽度由样式表收口（此前长标签把菜单撑到半屏）。
        // antd v6 起 `overlayClassName` 已 deprecated，改用 `classNames.root`
        // （两者同时给会让类挂到不同层，宽度收口失效）。
        classNames={{ root: "rf-inline-mark-menu" }}
        // I-11：首帧落点还没算出来时，**连 antd 的外壳一起隐藏**。
        // 之前只隐藏内层 `.rf-inline-mark-popup`，白底圆角的外壳仍在宿主左上角闪一帧。
        styles={{ root: menuRootStyle(placed) }}
        menu={{ items, onClick }}
        align={{
          // 两个方向都用「菜单左上角贴目标左上角」，目标点由 `targetOffset` 换算到 `placement`。
          points,
          targetOffset,
          // antd 给 Dropdown 的内置 placement 带 `offset: token.marginXXS`（4px）；
          // 这里显式清零，否则"贴光标 4px"会实际变成 8px。
          offset: [0, 0],
          // 垂直方向由我们按实测高度决定；只保留水平方向的兜底夹取。
          overflow: { adjustX: true, adjustY: false },
        }}
        onOpenChange={(next) => {
          // 点「插入链接…」时菜单不收起（输入框挂在同一层弹层里）。
          // 用 ref 判断：同一拍里 setLinkMode 还没生效。
          if (!next && linkModeRef.current) return;
          if (!next) close();
        }}
        popupRender={(menu) => (
          <div
            ref={popupRef}
            className="rf-inline-mark-popup"
            data-placement={placement?.side ?? "below"}
            // 双保险：真正让首帧不可见的是上方的 `styles.root`（外层），这里保留内层隐藏，
            // 免得 antd 某次升级把 `styles.root` 合并进 class 之后又闪回来。
            style={placed ? undefined : { visibility: "hidden" }}
          >
            {/* I-25：菜单项 mousedown 会夺走输入框焦点、选区随之消失（点完「加粗」没反应）。
                在菜单容器上拦住默认行为；链接输入框在容器外，不受影响。 */}
            <div onMouseDown={(event) => event.preventDefault()}>{menu}</div>
            {linkMode ? (
              <Space size={6} style={{ padding: "6px 8px" }}>
                <Input
                  size="small"
                  autoFocus
                  value={url}
                  placeholder={t("typography.inline.linkPlaceholder")}
                  aria-label={t("typography.inline.linkPlaceholder")}
                  onChange={(event) => setUrl(event.target.value)}
                  onPressEnter={confirmLink}
                />
                <Button size="small" type="primary" onClick={confirmLink}>
                  {t("typography.inline.linkApply")}
                </Button>
              </Space>
            ) : null}
          </div>
        )}
      >
        <div className="rf-inline-mark-host" ref={hostRef} onContextMenu={onContextMenu}>
          {children}
        </div>
      </Dropdown>
    </>
  );
}
