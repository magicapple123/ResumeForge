// SPDX-License-Identifier: Apache-2.0
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
import type { TableColumnsType } from "antd";
import { useEffect, useMemo, useState } from "react";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import {
  SCOPE_LABEL_KEYS,
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

/** 拒绝原因 → 语言包 key；取值处再 `t()`（模块作用域不能求值 `t`）。 */
const REJECTION_KEYS: Record<ShortcutRejectionReason, MessageKey> = {
  empty: "shortcutSettings.reject.empty",
  modifierOnly: "shortcutSettings.reject.modifierOnly",
  reserved: "shortcutSettings.reject.reserved",
  noModifier: "shortcutSettings.reject.noModifier",
};

/**
 * R8：为什么这些动作不用"更顺手"的键。
 *
 * 计划表里的第一版有两类是浏览器/系统先接走的（Ctrl+E 聚焦地址栏搜索、Ctrl+, 打开
 * 浏览器/系统设置），还有一类会和常用扩展撞车——绑上去要么到不了页面，要么把用户
 * 正在用的浏览器功能抢走。默认值因此统一加一级修饰键或换主键；用户仍可在本卡改键。
 * 另外两个翻页动作只作用于**列表分页**，不是简历预览翻页，必须写清楚。
 */
const ACTION_HINT_KEYS: Partial<Record<ShortcutActionId, MessageKey>> = {
  toggleTheme: "shortcutSettings.hint.toggleTheme",
  openSettings: "shortcutSettings.hint.openSettings",
  openSkills: "shortcutSettings.hint.openSkills",
  exportPdf: "shortcutSettings.hint.exportPdf",
  newResume: "shortcutSettings.hint.newResume",
  // 翻页两个动作的提示是同一句话，共用一条 key（避免两份同文案漂移）。
  prevPage: "shortcutSettings.hint.pageOnly",
  nextPage: "shortcutSettings.hint.pageOnly",
};

function actionLabel(id: ShortcutActionId): string {
  const action = SHORTCUT_ACTIONS.find((item) => item.id === id);
  return action ? t(action.labelKey) : id;
}

function sameKeys(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((key, index) => key === right[index]);
}

export default function ShortcutSettingsCard() {
  // 本组件用模块级 t()，必须订阅语言变化。
  useLocale();
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
        setError(t(REJECTION_KEYS[validation.reason ?? "empty"]));
        return;
      }
      const conflictId = findConflict(settings.bindings, validation.binding, recordingId);
      if (conflictId) {
        setError(t("shortcutSettings.conflict", { label: actionLabel(conflictId) }));
        return;
      }
      updateShortcutBinding(settings, recordingId, [validation.binding]);
      setRecordingId(null);
      setError("");
      message.success(
        t("shortcutSettings.changed", {
          label: actionLabel(recordingId),
          keys: formatShortcut(validation.binding, { mac }),
        }),
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
    message.success(t("shortcutSettings.unboundDone", { label: t(action.labelKey) }));
  };

  const handleRestore = (action: ShortcutAction) => {
    restoreShortcutBinding(settings, action.id);
    setRecordingId(null);
    setError("");
    message.success(t("shortcutSettings.restoredDone", { label: t(action.labelKey) }));
  };

  const handleResetAll = () => {
    const next: ShortcutSettings = resetShortcutSettings();
    setRecordingId(null);
    setError("");
    message.success(
      t("shortcutSettings.resetAllDone", { count: Object.keys(next.bindings).length }),
    );
  };

  const columns: TableColumnsType<ShortcutAction> = [
    {
      title: t("shortcutSettings.column.action"),
      key: "label",
      render: (_, action) => {
        const hintKey = ACTION_HINT_KEYS[action.id];
        return (
          <Space size={4}>
            <Typography.Text>{t(action.labelKey)}</Typography.Text>
            {hintKey ? (
              <Tooltip title={t(hintKey)}>
                <QuestionCircleOutlined
                  aria-label={t("shortcutSettings.actionHelp", { label: t(action.labelKey) })}
                />
              </Tooltip>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: t("shortcutSettings.column.scope"),
      key: "scope",
      width: 108,
      render: (_, action) => (
        <Typography.Text type="secondary">{t(SCOPE_LABEL_KEYS[action.scope])}</Typography.Text>
      ),
    },
    {
      title: t("shortcutSettings.column.keys"),
      key: "keys",
      width: 260,
      render: (_, action) => {
        if (recordingId === action.id) {
          return (
            <Space orientation="vertical" size={2}>
              <Tag color="processing">{t("shortcutSettings.recording")}</Tag>
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
          return <Tag className="shortcut-settings-key">{t("shortcutSettings.unbound")}</Tag>;
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
      title: t("shortcutSettings.column.actions"),
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
              {recordingId === action.id
                ? t("common.action.cancel")
                : t("shortcutSettings.action.edit")}
            </Button>
            <Popconfirm
              title={t("shortcutSettings.clearConfirm.title", { label: t(action.labelKey) })}
              description={t("shortcutSettings.clearConfirm.body")}
              okText={t("shortcutSettings.clearConfirm.ok")}
              cancelText={t("common.action.cancel")}
              onConfirm={() => handleClear(action)}
            >
              <Button size="small" disabled={isUnbound}>
                {t("shortcutSettings.action.clear")}
              </Button>
            </Popconfirm>
            <Button size="small" disabled={isDefault} onClick={() => handleRestore(action)}>
              {t("shortcutSettings.action.restore")}
            </Button>
          </Space>
        );
      },
    },
  ];

  return (
    <Card
      className="settings-card shortcut-settings-card"
      title={t("shortcutSettings.card.title")}
      extra={
        <Popconfirm
          title={t("shortcutSettings.resetAllConfirm.title")}
          okText={t("shortcutSettings.action.restore")}
          cancelText={t("common.action.cancel")}
          onConfirm={handleResetAll}
        >
          <Button size="small">{t("shortcutSettings.action.resetAll")}</Button>
        </Popconfirm>
      }
    >
      <Typography.Paragraph type="secondary" className="shortcut-settings-intro">
        {t("shortcutSettings.card.intro")}
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
