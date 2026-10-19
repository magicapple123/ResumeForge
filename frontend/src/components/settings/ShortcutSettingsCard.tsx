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
import { QuestionCircleOutlined } from "@ant-design/icons";
import { App, Button, Card, Popconfirm, Space, Table, Tag, Tooltip, Typography } from "antd";
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

/**
 * R8：为什么这些动作不用"更顺手"的键。
 *
 * 计划表里的第一版有两类是浏览器/系统先接走的（Ctrl+E 聚焦地址栏搜索、Ctrl+, 打开
 * 浏览器/系统设置），还有一类会和常用扩展撞车——绑上去要么到不了页面，要么把用户
 * 正在用的浏览器功能抢走。默认值因此统一加一级修饰键或换主键；用户仍可在本卡改键。
 * 另外两个翻页动作只作用于**列表分页**，不是简历预览翻页，必须写清楚。
 */
const ACTION_HINTS: Partial<Record<ShortcutActionId, string>> = {
  toggleTheme: "避开 Ctrl+Shift+L（部分浏览器/扩展占用），改用 Ctrl/⌘+Alt+D。",
  openSettings: "Ctrl/⌘+, 是浏览器与系统的设置键，到不了页面，改用 Ctrl/⌘+Alt+S。",
  openSkills: "避开 Ctrl+Shift+K（浏览器开发者工具/搜索冲突），改用 Ctrl/⌘+Alt+K。",
  exportPdf: "Ctrl/⌘+E 是浏览器地址栏搜索的保留键，改用 Ctrl/⌘+Shift+E。",
  newResume: "避开 Ctrl/⌘+Alt+R（与输入法/扩展冲突），改用 Ctrl/⌘+Shift+N。",
  prevPage: "作用于当前列表分页，不是简历预览翻页；落到分页控件上，不在预览里翻页。",
  nextPage: "作用于当前列表分页，不是简历预览翻页；落到分页控件上，不在预览里翻页。",
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

  /** 解绑：写入 null（不是空数组），否则下次读取会被当成"没配过"回落默认。 */
  const handleClear = (action: ShortcutAction) => {
    updateShortcutBinding(settings, action.id, null);
    setRecordingId(null);
    setError("");
    message.success(`「${action.label}」已解绑，这个组合键不再触发任何动作`);
  };

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
      render: (_, action) => {
        const hint = ACTION_HINTS[action.id];
        return (
          <Space size={4}>
            <Typography.Text>{action.label}</Typography.Text>
            {hint ? (
              <Tooltip title={hint}>
                <QuestionCircleOutlined aria-label={`${action.label} 说明`} />
              </Tooltip>
            ) : null}
          </Space>
        );
      },
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
        const keys = shortcutKeysOf(settings, action.id);
        if (keys.length === 0) {
          // 「未绑定」必须显式显示：留空会让用户以为设置丢了。
          return <Tag className="shortcut-settings-key">未绑定</Tag>;
        }
        return (
          <Space size={4} wrap>
            {keys.map((binding) => (
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
      width: 240,
      render: (_, action) => {
        const keys = shortcutKeysOf(settings, action.id);
        const isUnbound = keys.length === 0;
        const isDefault = sameKeys(
          keys,
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
            <Popconfirm
              title={`解绑「${action.label}」？`}
              description="解绑后这个组合键不再触发任何动作，可随时「恢复默认」。"
              okText="解绑"
              cancelText="取消"
              onConfirm={() => handleClear(action)}
            >
              <Button size="small" disabled={isUnbound}>
                清除
              </Button>
            </Popconfirm>
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
