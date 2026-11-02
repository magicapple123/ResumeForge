// SPDX-License-Identifier: Apache-2.0
/**
 * 文档编辑器的板块页签（含固定在最前的「基本信息」）。
 *
 * 复用制作台既有的 `EditorTabStrip`：溢出时那颗三角按钮的层级、键盘方向键切换、
 * 指示条动画都已经处理过，不再造第二份。
 *
 * ## 删除自建板块（任务 11 返工）
 *
 * 入口是**页签右键菜单**：页签条本身很窄（每栏就是一个板块名），塞不下逐项按钮；而中栏的
 * 字段 / 条目早就是「右键出菜单」的习惯，这里沿用同一套交互——一个 1px 定位点 + 受控
 * `Dropdown`，关闭路径与字段菜单共用 `useChipMenuDismiss`（点空白 / 滚动 / resize / 失焦）。
 *
 * 只有自建板块（key 以 `custom:` 开头）**才开菜单**：系统板块不是"把这一项灰掉"，而是整个
 * 菜单都不出现——系统板块只能隐藏 / 改标题，删除对它们没有语义（删了就等于让后端目录里
 * 那一栏凭空消失，重开还会被 `ensureIds` 之类的补全路径重新加回来）。
 *
 * 删除是结构操作里最容易误触的一个，所以菜单点完还要过一道确认弹窗；**确认后才**
 * `onRemoveSection(key)` 交回调用方（`DocumentEditor` 负责写文档、落选中、给提示）。
 * 弹窗刻意用受控的 antd Modal 而不是 `modal.confirm`：静态 `Modal.*` 被
 * `theme/antdStaticGuard.test.ts` 禁；`App.useApp().modal.confirm` 在没有 `<App>` 包裹的
 * 单元测试里拿到的是空 context（`.confirm` 不是函数）。写法与同一屏的 `AddSectionModal`
 * 一致，那个弹窗已验收过"叠在制作台之上"的层级表现。
 */
import { PlusOutlined } from "@ant-design/icons";
import { Button, Dropdown, Modal, Tooltip } from "antd";
import type { MenuProps, TabsProps } from "antd";
import { useCallback, useState } from "react";
import { useI18n } from "../../i18n/i18nContext";
import EditorTabStrip from "./EditorTabStrip";
import { useChipMenuDismiss } from "./useChipMenuDismiss";

/** 自建板块的 key 前缀（`addSection` 的调用方生成 `custom:<object id>`）。 */
const CUSTOM_SECTION_PREFIX = "custom:";

export interface DocumentSectionTabItem {
  key: string;
  label: string;
}

/** 当前打开的页签右键菜单：锚点坐标是**视口坐标**（锚点 `position: fixed`）。 */
interface TabMenuState {
  key: string;
  /** 菜单对应的板块名：确认弹窗里要说清"删的是哪一个"。 */
  label: string;
  x: number;
  y: number;
}

interface Props {
  items: DocumentSectionTabItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  readOnly?: boolean;
  onAddSection?: () => void;
  /** 删除自建板块。缺省 = 不提供删除入口（页签右键恢复浏览器默认）。 */
  onRemoveSection?: (key: string) => void;
}

export default function DocumentSectionTabs({
  items,
  activeKey,
  onSelect,
  readOnly = false,
  onAddSection,
  onRemoveSection,
}: Props) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<TabMenuState | null>(null);
  /** 已二次确认、等待确认弹窗回话的板块 key；null = 弹窗关着。 */
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  // #6 的关闭路径直接复用：antd 受控 Dropdown 只处理菜单自身的点选，不关"点界面空白"。
  useChipMenuDismiss(menu !== null, closeMenu, { closeOnOutsidePointer: true });

  const tabItems: TabsProps["items"] = items.map((item) => ({ key: item.key, label: item.label }));

  /**
   * 右键某一栏：只给自建板块开菜单。
   * 只读（外部流程接管正文）与宿主没接删除回调时，同样什么都不弹。
   */
  const openTabMenu = (key: string, position: { x: number; y: number }) => {
    if (readOnly || !onRemoveSection) return;
    if (!key.startsWith(CUSTOM_SECTION_PREFIX)) return;
    const target = items.find((item) => item.key === key);
    setMenu({ key, label: target?.label ?? key, x: position.x, y: position.y });
  };

  const menuItems: MenuProps["items"] = [
    { key: "remove", label: t("editor.custom-sections.remove-section"), danger: true },
  ];
  const onMenuClick: MenuProps["onClick"] = ({ key }) => {
    const anchor = menu;
    closeMenu();
    if (key === "remove" && anchor) setPendingKey(anchor.key);
  };

  /** 确认删除：先关弹窗再交回，避免父级删完页签后弹窗还挂着已不存在的板块名。 */
  const confirmRemove = () => {
    const key = pendingKey;
    setPendingKey(null);
    if (key) onRemoveSection?.(key);
  };

  const pendingLabel = items.find((item) => item.key === pendingKey)?.label ?? "";

  return (
    <div className="document-tabs">
      <EditorTabStrip
        items={tabItems}
        activeKey={activeKey}
        onSelect={onSelect}
        onTabContextMenu={openTabMenu}
      />
      {onAddSection && !readOnly ? (
        <Tooltip title={t("document.tabs.add")}>
          <Button
            className="document-tabs-add"
            type="text"
            size="small"
            icon={<PlusOutlined />}
            aria-label={t("document.tabs.add")}
            onClick={onAddSection}
          />
        </Tooltip>
      ) : null}
      {/*
        全编辑器只有一份页签菜单：锚点是个 1px 的定位点（`.document-chip-menu-anchor`，
        `position: fixed` + `pointer-events: none`），不参与排版、不吃指针。
      */}
      <Dropdown
        open={menu !== null}
        onOpenChange={(open) => {
          if (!open) closeMenu();
        }}
        trigger={[]}
        menu={{ items: menuItems, onClick: onMenuClick }}
      >
        <span
          className="document-chip-menu-anchor"
          style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
        />
      </Dropdown>
      <Modal
        open={pendingKey !== null}
        title={t("editor.custom-sections.remove-section")}
        // 会真的从文档里删掉一个板块：蒙层不关闭，避免手抖点外面把确认框"点没了"还以为删了。
        mask={{ closable: false }}
        okText={t("common.action.delete")}
        cancelText={t("common.action.cancel")}
        okButtonProps={{ danger: true }}
        onOk={confirmRemove}
        onCancel={() => setPendingKey(null)}
      >
        {t("document.section.removeBody", { section: pendingLabel })}
      </Modal>
    </div>
  );
}
