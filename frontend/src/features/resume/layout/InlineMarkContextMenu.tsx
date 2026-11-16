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
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import {
  applyStyleMark,
  clearInlineMarks,
  insertLinkMark,
  INLINE_SIZE_STEPS,
  toggleBoldMark,
  type InlineEdit,
  type InlineRange,
} from "./inlineMarks";
import type { InlineMarkCommit } from "./InlineMarkButtons";
import "../../../styles/inline-mark-menu.css";

/** 预设强调色（与工具条同一组；色板是内容数据，不是主题变量）。 */
const COLOR_PRESETS = ["#c0392b", "#d97706", "#2f6fd0", "#2f855a", "#6b7280", "#111111"];

interface Props {
  onCommit: (next: InlineMarkCommit) => void;
  disabled?: boolean;
  children: ReactNode;
}

interface Snapshot {
  text: string;
  range: InlineRange;
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
  const [url, setUrl] = useState("");
  const [offset, setOffset] = useState<[number, number]>([0, 0]);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  const close = () => {
    setOpen(false);
    setLinkMode(false);
    setUrl("");
  };

  /**
   * I-25：点菜单外任意处关闭。
   *
   * antd 的受控 Dropdown 只在"点击"时自己上报 onOpenChange，右键菜单常见的三种
   * 逃逸路径（在别处右键 / 点空白 / 拖选文字）都不在它的覆盖里，表现就是"点外不关"。
   * 这里用 capture 阶段的 pointerdown 统一兜住：菜单里（含链接输入框）与宿主输入框
   * 内部都放行——后者由 onContextMenu 自己重新定位。
   */
  useEffect(() => {
    if (!open) return;
    // 注意类型：本文件导入的 `MouseEvent` 是 React 的合成事件类型，document 上的是原生事件。
    const onPointerDown = (event: Event) => {
      const node = event.target;
      if (!(node instanceof Node)) return;
      if (popupRef.current?.contains(node)) return;
      if (hostRef.current?.contains(node)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    // 用 mousedown 而不是 pointerdown：指针事件在部分环境（jsdom / 老 Safari）
    // 不冒泡到 document，菜单就会"点外不关"——这正是本条要修的现象。
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
    // close 只做三个 setState，不依赖任何外部值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    const picked = liveRange(event.target);
    // 空选区 / 非输入框：放行原生菜单（不 preventDefault、不打开）。
    if (!picked) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setOffset([event.clientX - rect.left, event.clientY - rect.top]);
    setSnapshot(picked);
    setLinkMode(false);
    setUrl("");
    setOpen(true);
  };

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
    if (key === "bold") return commit(toggleBoldMark(text, range));
    if (key === "link") {
      setLinkMode(true);
      return;
    }
    if (key === "clear") return commit(clearInlineMarks(text, range));
    if (key === "size:clear") return commit(applyStyleMark(text, range, { size: null }));
    if (key === "color:clear") return commit(applyStyleMark(text, range, { color: null }));
    if (key.startsWith("size:"))
      return commit(applyStyleMark(text, range, { size: Number(key.slice(5)) }));
    if (key.startsWith("color:"))
      return commit(applyStyleMark(text, range, { color: key.slice(6) }));
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
    if (edit) commit(edit);
  };

  return (
    <Dropdown
      open={open}
      trigger={[]}
      // I-25：宽度由样式表收口（此前长标签把菜单撑到半屏）。
      overlayClassName="rf-inline-mark-menu"
      menu={{ items, onClick }}
      align={{
        points: ["tl", "tl"],
        targetOffset: offset,
        overflow: { adjustX: true, adjustY: true },
      }}
      onOpenChange={(next) => {
        // 点「插入链接…」时菜单不收起（输入框挂在同一层弹层里）。
        if (!next && linkMode) return;
        if (!next) close();
      }}
      popupRender={(menu) => (
        <div ref={popupRef}>
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
  );
}
