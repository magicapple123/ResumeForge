// SPDX-License-Identifier: Apache-2.0
/**
 * 中栏的自绘**横向栏目条**：8 个栏目的标签、选中指示条、以及"放不下时的三角下拉"。
 * 它取代了原来那颗带文字的按钮（那颗按钮与它的文案 key 本轮已删），对应四条用户口径：
 *
 * 1. **选中项居中且切换丝滑**：切换时把该栏目滚到轨道正中（`scrollTo` + `smooth`），
 *    指示条靠 `transform` 过渡滑过去。首次挂载用 `auto`——打开简历制作台时标签条自己
 *    滑一下会让人以为点错了什么。
 * 2. **下拉只列没显示出来的栏目**：溢出时三角按钮才出现，菜单里只放"没完整显示"的那几个；
 *    全部显示得下时按钮根本不渲染。
 * 3. **没显示完的部分渐隐**：遮罩起点写在轨道的 CSS 自定义属性里，取"最后一个**完整**
 *    可见栏目的视口右边界"——渐隐只吃掉被切掉的那几个字，完整显示的栏目一个字都不受影响。
 *    遮罩贴在轨道盒子上、不跟内容滚，所以**滚动时要按视口坐标重算**（见 `measure` 的注释）。
 * 4. **粘顶**：见 `resume-workbench-tabs.css`（滚动容器里的第一个元素，`position: sticky`）。
 *
 * ## 为什么宽度为 0 时判定"没有溢出"
 *
 * 首帧还没布局、或运行在没有布局引擎的环境（jsdom）里，`clientWidth` 是 0。这时若按
 * "未知就先把按钮摆上"，会得到一颗**永远点开空菜单**的按钮，且每次尺寸抖动都会闪一下。
 * 退化成"没有溢出"的代价只是"这一帧没有三角按钮"，下一帧量到宽度就补上；收益是行为可测：
 * 测试可以注入宽度构造溢出，也可以断言"默认没有按钮"。
 *
 * ## 为什么不用 antd 自带的三点折叠菜单
 *
 * `@rc-component/tabs` 的折叠菜单用的是裸 `rc-dropdown`，不参与 antd 的 `ZIndexContext`：
 * 弹层挂到 `document.body` 后只剩全局基准层级，会被简历制作台弹窗的容器压住——点它没有
 * 任何反应（2026-10 用户实测，仓库里踩过一次）。antd 的 `Dropdown` 按所在容器的层级继承
 * 再偏移，所以弹层必然盖在制作台之上。
 *
 * ## 禁用字样
 *
 * 本文件不出现"尖括号 + Form"字样：`popupGuard` P1 是**文件级文本扫描**，看到它就会把这个
 * 文件当成"同时有表单与弹层"的宿主（弹层必须禁蒙层关闭）。这里只有下拉菜单，与表单无关。
 */
import { CaretDownOutlined } from "@ant-design/icons";
import { Button, Dropdown } from "antd";
import type { TabsProps } from "antd";
import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { t } from "../../i18n";
import { computeTabOverflow } from "./tabOverflow";

/**
 * 三角按钮占的宽度（px）。测量可用宽度时要先扣掉它，否则"最后一个刚好放得下的栏目"
 * 会被按钮压住半截，而那半截正好是它的结尾几个字。
 */
const MORE_BUTTON_WIDTH = 28;

/** 遮罩起点（CSS 自定义属性名，单位 px，写在轨道的行内 style 上）。 */
const FADE_FROM_VARIABLE = "--wb-tab-fade-from";

/** 轨道里没有可测量的栏目时填的值：`100%` 等于"全程不透明"，即不渐隐。 */
const NO_FADE = "100%";

/** 指示条的位置与宽度（相对轨道内容，不是相对视口）。 */
interface InkGeometry {
  left: number;
  width: number;
}

/** 一个栏目的最小信息：下拉菜单与按钮都只需要它。 */
interface TabEntry {
  key: string;
  label: ReactNode;
}

interface Props {
  /** 与 antd `Tabs` 同一份 items：下拉里列的是"没显示出来的那几个"，不是全部。 */
  items: TabsProps["items"];
  activeKey: string;
  /** 选中一个栏目。下拉项与按钮走同一个出口，内容面板才会跟着换。 */
  onSelect: (key: string) => void;
}

/** 只保留有 key 的条目：没有 key 就没法对齐 `activeKey`，也就没法切换。 */
function toEntries(items: TabsProps["items"]): TabEntry[] {
  return (items ?? []).flatMap((item) =>
    item && item.key !== undefined && item.key !== null
      ? [{ key: String(item.key), label: item.label as ReactNode }]
      : [],
  );
}

/** 轨道内的栏目按钮（`role="tab"`），顺序即栏目顺序。 */
function tabNodes(track: HTMLElement): HTMLElement[] {
  return Array.from(track.querySelectorAll<HTMLElement>('[role="tab"]'));
}

export default function EditorTabStrip({ items, activeKey, onSelect }: Props) {
  const entries = useMemo(() => toEntries(items), [items]);
  const trackRef = useRef<HTMLDivElement>(null);
  // 首次挂载用 `auto`，之后才用 `smooth`：见文件头第 1 点。
  const mountedRef = useRef(false);
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const [ink, setInk] = useState<InkGeometry | null>(null);

  /**
   * 量一次：哪些栏目没**完整**显示出来、遮罩从哪开始、以及要不要那颗三角按钮。
   *
   * 几何判定全部交给纯函数 `computeTabOverflow`（`tabOverflow.ts`，那里写清了坐标口径与
   * 左/右侧判据），这里只负责"读三个数 → 写一个 CSS 变量 → 必要时换一次 state"。
   * 它会被**滚动**高频调用（`smooth` 一次滚动连发几十个 scroll 事件），所以除那个 CSS
   * 变量外不许有其它副作用，`setHiddenKeys` 也必须先比内容再决定是否换引用。
   */
  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const nodes = tabNodes(track);
    const overflow = computeTabOverflow(
      nodes.map((node) => ({ offsetLeft: node.offsetLeft, offsetWidth: node.offsetWidth })),
      { clientWidth: track.clientWidth, scrollLeft: track.scrollLeft, reserve: MORE_BUTTON_WIDTH },
    );
    track.style.setProperty(
      FADE_FROM_VARIABLE,
      overflow.fadeFrom === null ? NO_FADE : `${Math.round(overflow.fadeFrom)}px`,
    );
    const next = overflow.hiddenIndexes.flatMap((index) => {
      const key = nodes[index]?.dataset.wbTabKey;
      return key === undefined ? [] : [key];
    });
    setHiddenKeys((prev) =>
      prev.length === next.length && prev.every((key, index) => key === next[index]) ? prev : next,
    );
  }, []);

  // 挂载后量与 items 变化时重量一次（栏目数量变了，能否放下也跟着变）。
  useLayoutEffect(() => {
    measure();
  }, [measure, entries]);

  // 容器宽度变化（拖分隔条、折叠侧栏、窗口缩放）就重量一次。
  // 没有 `ResizeObserver`（jsdom）时只跳过 observe、初始测量照常发生——测试正是靠注入宽度
  // 来看"溢出"这条分支的，所以这里不能整体 early-return。
  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(track);
    return () => observer.disconnect();
  }, [measure]);

  // 横向滚动时重算渐隐起点：遮罩贴在轨道的**盒子**上、不跟内容滚，所以起点是视口坐标，
  // 内容一滚它就得跟着变。监听器是 passive 的，回调里只读几何 + 写一个 CSS 变量。
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onScroll = () => measure();
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => track.removeEventListener("scroll", onScroll);
  }, [measure]);

  // 选中项居中 + 指示条归位。依赖 `activeKey`：一次切换只渲染一次指示条。
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const node = tabNodes(track).find((element) => element.dataset.wbTabKey === activeKey);
    if (!node) return;
    const behavior: ScrollBehavior = mountedRef.current ? "smooth" : "auto";
    mountedRef.current = true;
    setInk((prev) => {
      // 宽度量不到（首帧 / jsdom）时不画指示条：一条 0 宽的线只会变成"标签下面有个点"。
      if (node.offsetWidth === 0) return prev === null ? prev : null;
      if (prev && prev.left === node.offsetLeft && prev.width === node.offsetWidth) return prev;
      return { left: node.offsetLeft, width: node.offsetWidth };
    });
    const centered = node.offsetLeft - (track.clientWidth - node.offsetWidth) / 2;
    // `scrollTo` 在 jsdom 里不存在，`scroll-behavior` 也不再兜底：没有就什么都不做。
    if (typeof track.scrollTo === "function") {
      track.scrollTo({ left: Math.max(0, centered), behavior });
    }
  }, [activeKey, entries]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const keys = entries.map((entry) => entry.key);
      const current = keys.indexOf(activeKey);
      if (current < 0) return;
      let next: number | null = null;
      if (event.key === "ArrowRight") next = (current + 1) % keys.length;
      else if (event.key === "ArrowLeft") next = (current - 1 + keys.length) % keys.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = keys.length - 1;
      if (next === null) return;
      // 阻止默认：方向键在 tablist 里是"换选中"，不是"滚页面"。
      event.preventDefault();
      const key = keys[next];
      onSelect(key);
      // 焦点跟着选中走：键盘用户下一次按方向键时，起点必须是刚选中的那一栏。
      const track = trackRef.current;
      if (!track) return;
      tabNodes(track)
        .find((element) => element.dataset.wbTabKey === key)
        ?.focus();
    },
    [activeKey, entries, onSelect],
  );

  const hiddenEntries = entries.filter((entry) => hiddenKeys.includes(entry.key));

  return (
    <div
      className="resume-wb-tabstrip"
      role="tablist"
      aria-label={t("workbench.tabs.label")}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={trackRef}
        className={`resume-wb-tabstrip-track${hiddenKeys.length > 0 ? " is-overflowing" : ""}`}
      >
        {entries.map((entry) => {
          const selected = entry.key === activeKey;
          return (
            <button
              key={entry.key}
              type="button"
              role="tab"
              data-wb-tab-key={entry.key}
              aria-selected={selected}
              // 只有选中的那一栏在 Tab 序列里：整条栏目条只占一个停靠点。
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(entry.key)}
            >
              {entry.label}
            </button>
          );
        })}
        {ink ? (
          <span
            className="resume-wb-tabstrip-ink"
            aria-hidden="true"
            style={{ width: `${ink.width}px`, transform: `translateX(${ink.left}px)` }}
          />
        ) : null}
      </div>
      {hiddenEntries.length > 0 ? (
        <Dropdown
          trigger={["click"]}
          // 打开后焦点进菜单：方向键选项、Enter 选中（antd Menu 的既有行为）。
          autoFocus
          menu={{
            items: hiddenEntries.map((entry) => ({ key: entry.key, label: entry.label })),
            selectable: true,
            selectedKeys: [activeKey],
            onClick: ({ key }) => onSelect(key),
          }}
        >
          <Button
            className="resume-wb-tabstrip-more"
            type="text"
            size="small"
            icon={<CaretDownOutlined />}
            aria-label={t("workbench.tabs.more")}
          />
        </Dropdown>
      ) : null}
    </div>
  );
}
