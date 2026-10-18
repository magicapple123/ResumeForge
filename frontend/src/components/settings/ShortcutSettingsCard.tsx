/**
 * 快捷键设置卡（R5）。
 *
 * 六个动作的现用组合在这里可见、可改、可恢复默认。改键采用"录制"而非下拉选择：
 * 组合键的取值空间太大，让用户直接按一遍比从列表里找快得多，也不会漏掉未来新增的方向键。
 *
 * 命名刻意不叫 `ShortcutsCard`——首页已经有一个同名组件（首页快捷入口卡），
 * 两者语义完全不同。
 *
 * 三条拒绝规则（与 `matchShortcut.validateShortcut` 同一份实现）：必须带
 * Ctrl/⌘/Alt；浏览器保留组合拒绝；与其它动作冲突拒绝。被拒绝时红字提示且**不落库**，
 * 用户不会在"以为改好了"之后发现按了没反应。
 */
import { App, Button, Card, Popconfirm, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import {
  SCOPE_LABELS,
  SHORTCUT_ACTIONS,
  defaultShortcutBindings,
  type ShortcutAction,
  type ShortcutActionId,
} from "../../features/shortcuts/registry";
import {
  findConflict,
  formatShortcut,
  isMacPlatform,
  normalizeBinding,
  normalizeEvent,
  validateShortcut,
  type ShortcutRejectionReason,
} from "../../features/shortcuts/matchShortcut";
import {
  resetShortcutSettings,
  restoreShortcutBinding,
  shortcutKeysOf,
  updateShortcutBinding,
  type ShortcutSettings,
} from "../../features/shortcuts/storage";
import {
  setShortcutRecording,
  useShortcutSettings,
} from "../../features/shortcuts/useShortcutKeymap";

const REJECTION_TEXT: Record<ShortcutRejectionReason, string> = {
  empty: "没听清，请再按一次组合键",
  modifierOnly: "还需要一个非修饰键（例如 Z、K）",
  reserved: "这是浏览器或窗口的保留组合，换一个",
  noModifier: "组合键必须带 Ctrl / ⌘ 或 Alt",
};

function actionLabel(id: ShortcutActionId): string {
  return SHORTCUT_ACTIONS.find((action) => action.id === id)?.label ?? id;
}

function sameKeys(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((key, index) => key === right[index]);
}

export default function ShortcutSettingsCard() {
  const { message } = App.useApp();
  const settings = useShortcutSettings();
  const [recordingId, setRecordingId] = useState<ShortcutActionId | null>(null);
  const [error, setError] = useState("");
  const mac = isMacPlatform();

  // 录制期间让全局 keymap 完全让位：否则"按 Cmd+K 录制搜索键"会先把搜索打开。
  useEffect(() => {
    setShortcutRecording(recordingId !== null);
    return () => setShortcutRecording(false);
  }, [recordingId]);

  useEffect(() => {
    if (recordingId === null) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecordingId(null);
        setError("");
        return;
      }
      // 只按住修饰键（Shift/Cmd…）时 normalizeEvent 返回 null：继续等主键。
      const binding = normalizeEvent(event);
      if (!binding) return;
      const validation = validateShortcut(binding);
      if (!validation.ok) {
        setError(REJECTION_TEXT[validation.reason ?? "empty"]);
        return;
      }
      const conflictId = findConflict(settings.bindings, validation.binding, recordingId);
      if (conflictId) {
        setError(`已被「${actionLabel(conflictId)}」占用`);
        return;
      }
      updateShortcutBinding(settings, recordingId, [validation.binding]);
      setRecordingId(null);
      setError("");
      message.success(
        `「${actionLabel(recordingId)}」已改为 ${formatShortcut(validation.binding, { mac })}`,
      );
    };
    // capture 阶段挂 window：录制时要先于页面上任何 keydown 处理拿到这次按键。
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [mac, message, recordingId, settings]);

  const dataSource = useMemo(() => [...SHORTCUT_ACTIONS], []);

  const handleRestore = (action: ShortcutAction) => {
    restoreShortcutBinding(settings, action.id);
    setRecordingId(null);
    setError("");
    message.success(`「${action.label}」已恢复默认`);
  };

  const handleResetAll = () => {
    const next: ShortcutSettings = resetShortcutSettings();
    setRecordingId(null);
    setError("");
    message.success(`已恢复默认快捷键（共 ${Object.keys(next.bindings).length} 项）`);
  };

  const columns: ColumnsType<ShortcutAction> = [
    {
      title: "动作",
      key: "label",
      render: (_, action) => <Typography.Text>{action.label}</Typography.Text>,
    },
    {
      title: "作用域",
      key: "scope",
      width: 108,
      render: (_, action) => (
        <Typography.Text type="secondary">{SCOPE_LABELS[action.scope]}</Typography.Text>
      ),
    },
    {
      title: "当前按键",
      key: "keys",
      width: 260,
      render: (_, action) => {
        if (recordingId === action.id) {
          return (
            <Space orientation="vertical" size={2}>
              <Tag color="processing">请按下新组合，Esc 取消</Tag>
              {error ? (
                <Typography.Text type="danger" className="shortcut-settings-error">
                  {error}
                </Typography.Text>
              ) : null}
            </Space>
          );
        }
        return (
          <Space size={4} wrap>
            {shortcutKeysOf(settings, action.id).map((binding) => (
              <Tag key={binding} className="shortcut-settings-key">
                {formatShortcut(binding, { mac })}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: "操作",
      key: "actions",
      width: 168,
      render: (_, action) => {
        const isDefault = sameKeys(
          shortcutKeysOf(settings, action.id),
          defaultShortcutBindings()[action.id].map((binding) => normalizeBinding(binding)),
        );
        return (
          <Space size={4}>
            <Button
              size="small"
              type={recordingId === action.id ? "primary" : "default"}
              onClick={() => {
                setError("");
                setRecordingId((current) => (current === action.id ? null : action.id));
              }}
            >
              {recordingId === action.id ? "取消" : "修改"}
            </Button>
            <Button size="small" disabled={isDefault} onClick={() => handleRestore(action)}>
              恢复默认
            </Button>
          </Space>
        );
      },
    },
  ];

  return (
    <Card
      className="settings-card shortcut-settings-card"
      title="快捷键"
      extra={
        <Popconfirm
          title="全部恢复默认快捷键？"
          okText="恢复默认"
          cancelText="取消"
          onConfirm={handleResetAll}
        >
          <Button size="small">全部恢复默认</Button>
        </Popconfirm>
      }
    >
      <Typography.Paragraph type="secondary" className="shortcut-settings-intro">
        点「修改」后直接按下想要的组合，按 Esc 取消。组合键必须带 Ctrl / ⌘ 或
        Alt；浏览器保留的组合（如
        Ctrl+W）以及已被其它动作占用的组合会被拒绝。改动保存在本机，立即生效。
      </Typography.Paragraph>
      <Table<ShortcutAction>
        rowKey="id"
        size="small"
        pagination={false}
        columns={columns}
        dataSource={dataSource}
      />
    </Card>
  );
}
