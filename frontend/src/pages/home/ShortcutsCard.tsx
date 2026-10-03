/**
 * 快捷入口卡 + 自定义弹窗：用户可勾选展示哪些入口（至少保留 1 项）。
 * （自 HomePage 拆出：shortcut state×3、saveShortcuts、loadShortcutKeys、
 * SHORTCUT_STORAGE_KEY、DEFAULT_SHORTCUT_KEYS 随唯一消费者下沉；
 * MENU_ITEMS 自 "../../App" 导入——与原页面同一绑定。）
 */
import { EditOutlined } from "@ant-design/icons";
import { Button, Card, Checkbox, Modal, Typography } from "antd";
import { Link } from "react-router-dom";
import { useState } from "react";
import { MENU_ITEMS } from "../../App";

/** 快捷入口默认值（与旧版 7 项一致）；完整可选项见 App.tsx 的 MENU_ITEMS。 */
const DEFAULT_SHORTCUT_KEYS = [
  "/jobs",
  "/resumes",
  "/apply",
  "/tracker",
  "/interview",
  "/analytics",
  "/settings",
];

const SHORTCUT_STORAGE_KEY = "rf.home.shortcuts";

/** 从 localStorage 读取已保存的快捷入口 key 数组；缺省/非法时回退默认。 */
function loadShortcutKeys(): string[] {
  try {
    const raw = localStorage.getItem(SHORTCUT_STORAGE_KEY);
    if (!raw) return DEFAULT_SHORTCUT_KEYS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_SHORTCUT_KEYS;
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return DEFAULT_SHORTCUT_KEYS;
  }
}

export function ShortcutsCard() {
  // 快捷入口：用户可自定义的 key 集合（顺序即渲染顺序），缺省回退默认 7 项。
  const [shortcutKeys, setShortcutKeys] = useState<string[]>(() => loadShortcutKeys());
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false);
  const [shortcutDraft, setShortcutDraft] = useState<string[]>(shortcutKeys);

  /** 保存快捷入口选择：至少保留 1 项，空选则视为未改动。 */
  const saveShortcuts = (keys: string[]) => {
    const next = keys.length > 0 ? keys : DEFAULT_SHORTCUT_KEYS;
    setShortcutKeys(next);
    localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(next));
    setShortcutModalOpen(false);
  };

  // 按用户选择顺序，从 MENU_ITEMS 取出可渲染的快捷入口（过滤掉已不存在的 key）。
  const shortcuts = shortcutKeys
    .map((key) => MENU_ITEMS.find((item) => item.key === key))
    .filter((item): item is (typeof MENU_ITEMS)[number] => Boolean(item));

  return (
    <>
      <Card
        style={{ marginTop: 16 }}
        title="快捷入口"
        extra={
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            aria-label="编辑快捷入口"
            onClick={() => {
              setShortcutDraft(shortcutKeys);
              setShortcutModalOpen(true);
            }}
          >
            编辑
          </Button>
        }
      >
        <div className="home-shortcuts">
          {shortcuts.map((item) => (
            <Link key={item.key} to={item.key} className="home-shortcut">
              <span className="home-shortcut-icon">{item.icon}</span>
              <span className="home-shortcut-label">{item.label}</span>
            </Link>
          ))}
        </div>
      </Card>

      <Modal
        title="自定义快捷入口"
        open={shortcutModalOpen}
        onCancel={() => setShortcutModalOpen(false)}
        footer={[
          <Button key="restore" onClick={() => setShortcutDraft(DEFAULT_SHORTCUT_KEYS)}>
            恢复默认
          </Button>,
          <Button
            key="save"
            type="primary"
            disabled={shortcutDraft.length === 0}
            onClick={() => saveShortcuts(shortcutDraft)}
          >
            保存
          </Button>,
        ]}
      >
        <Typography.Text type="secondary">
          勾选要在首页展示的入口（至少保留 1 项）。
        </Typography.Text>
        <Checkbox.Group
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "8px 16px",
            marginTop: 12,
          }}
          value={shortcutDraft}
          options={MENU_ITEMS.map((item) => ({ value: item.key, label: item.label }))}
          onChange={(values) => setShortcutDraft(values as string[])}
        />
      </Modal>
    </>
  );
}
