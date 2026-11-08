// SPDX-License-Identifier: Apache-2.0
/**
 * 输入区「数据权限」四档下拉与琥珀提示条（T11）。
 *
 * 触发区显示当前档位；无会话（还没建）时只显示「跟随全局」且不可改——覆盖值按会话存
 * localStorage，没有会话就没有可覆盖的对象。写档位（可修改 / 完全权限）首次选中时弹一次
 * 确认：开启后写操作不再逐条询问，这是本轮唯一改变安全边界的位置。
 */
import { Alert, App, Button, Dropdown, Tooltip } from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  DownOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { t } from "../../../../i18n";
import { useLocale } from "../../../../i18n/i18nContext";
import {
  acknowledgeWritePermission,
  ASSISTANT_PERMISSION_DESC_KEYS,
  ASSISTANT_PERMISSION_LABEL_KEYS,
  ASSISTANT_PERMISSION_LEVELS,
  FOLLOW_GLOBAL,
  hasAcknowledgedWritePermission,
  isWriteLevel,
  showsRelaxedNotice,
  type AssistantPermissionChoice,
  type AssistantPermissionLevel,
} from "../../assistantPermission";

/** 档位显示名（渲染期求值；模块作用域不调用 t()）。 */
function assistantPermissionLabel(level: AssistantPermissionLevel): string {
  return t(ASSISTANT_PERMISSION_LABEL_KEYS[level]);
}

export interface PermissionMenuProps {
  conversationId: number | null;
  choice: AssistantPermissionChoice;
  effectiveLevel: AssistantPermissionLevel;
  editable: boolean;
  onChange: (choice: AssistantPermissionChoice) => void;
}

export default function PermissionMenu({
  conversationId,
  choice,
  effectiveLevel,
  editable,
  onChange,
}: PermissionMenuProps) {
  // 本组件用模块级 t()：必须订阅语言变化。
  useLocale();
  const { modal } = App.useApp();
  const followLabel = t("assistantPermission.followGlobalWith", {
    level: assistantPermissionLabel(effectiveLevel),
  });

  const choose = (next: AssistantPermissionChoice) => {
    if (next === FOLLOW_GLOBAL || !isWriteLevel(next)) {
      onChange(next);
      return;
    }
    const id = conversationId;
    if (id == null || hasAcknowledgedWritePermission(id)) {
      onChange(next);
      return;
    }
    // 写档位首次选中确认：每个对话只弹一次（确认后记在 localStorage）。
    modal.confirm({
      title: t("assistantPermission.confirm.title", {
        level: assistantPermissionLabel(next),
      }),
      content: t("assistantPermission.confirm.body"),
      okText: t("assistantPermission.confirm.ok"),
      cancelText: t("assistantPermission.confirm.cancel"),
      onOk: () => {
        acknowledgeWritePermission(id);
        onChange(next);
      },
    });
  };

  if (!editable) {
    // 没有会话 id：覆盖值无处可存，只能跟随全局。Tooltip 需要一层可接收事件的包裹
    // （disabled 的 antd Button 不冒泡鼠标事件，直接套 Tooltip 不会弹）。
    return (
      <Tooltip title={t("assistantPermission.followGlobalHint")}>
        <span className="assistant-permission-disabled">
          <Button
            size="small"
            type="text"
            className="assistant-permission-trigger"
            icon={<SafetyCertificateOutlined />}
            disabled
          >
            {followLabel}
          </Button>
        </span>
      </Tooltip>
    );
  }

  const currentLabel = choice === FOLLOW_GLOBAL ? followLabel : assistantPermissionLabel(choice);
  return (
    <Dropdown
      trigger={["click"]}
      placement="topLeft"
      menu={{
        items: [
          // 说明放菜单里而不是触发区的悬停 Tooltip：Tooltip 会盖在菜单上挡住第一项
          // （实机点不到的正是这条提示），而"只覆盖当前对话"本身就是选之前该读到的信息。
          {
            key: "hint",
            label: (
              <span className="assistant-permission-menu-hint">
                {t("assistantPermission.menu.hint")}
              </span>
            ),
            disabled: true,
          },
          { type: "divider" as const },
          {
            key: FOLLOW_GLOBAL,
            // 「跟随全局」以前只有标题、没有说明，用户看不出它是"设置页的全局默认"，
            // 也看不出"在这里改只影响本对话"；套用四档的说明又会与「仅查看」逐字相同
            // （都是"只读，敏感字段脱敏"）。所以它有自己的 desc，并带上当前生效档位。
            label: (
              <span className="assistant-permission-option">
                <span className="assistant-permission-option-name">
                  {t("assistantPermission.followGlobal")}
                </span>
                <span className="assistant-permission-option-desc">
                  {t("assistantPermission.followGlobal.desc", {
                    level: assistantPermissionLabel(effectiveLevel),
                  })}
                </span>
              </span>
            ),
            icon: choice === FOLLOW_GLOBAL ? <CheckOutlined /> : undefined,
          },
          { type: "divider" as const },
          ...ASSISTANT_PERMISSION_LEVELS.map((level) => ({
            key: level,
            label: (
              <span className="assistant-permission-option">
                <span className="assistant-permission-option-name">
                  {assistantPermissionLabel(level)}
                </span>
                <span className="assistant-permission-option-desc">
                  {t(ASSISTANT_PERMISSION_DESC_KEYS[level])}
                </span>
              </span>
            ),
            icon: choice === level ? <CheckOutlined /> : undefined,
          })),
        ],
        onClick: ({ key }) => choose(key as AssistantPermissionChoice),
      }}
    >
      <Button
        size="small"
        type="text"
        className="assistant-permission-trigger"
        icon={<SafetyCertificateOutlined />}
      >
        {currentLabel}
        <DownOutlined className="assistant-permission-caret" />
      </Button>
    </Dropdown>
  );
}

export interface PermissionNoticeProps {
  level: AssistantPermissionLevel;
  onClose: () => void;
}

/** 琥珀色提示条：放宽读取 / 完全权限生效时钉在输入框上方，可关闭。 */
export function PermissionNotice({ level, onClose }: PermissionNoticeProps) {
  useLocale();
  if (!showsRelaxedNotice(level)) return null;
  const write = isWriteLevel(level);
  return (
    <Alert
      type="warning"
      showIcon
      className="assistant-permission-notice"
      closable={{
        closeIcon: <CloseOutlined />,
        "aria-label": t("assistantPermission.notice.closeAria"),
        onClose,
      }}
      title={t(
        write
          ? "assistantPermission.notice.writeFull.title"
          : "assistantPermission.notice.readFull.title",
      )}
      description={t(
        write
          ? "assistantPermission.notice.writeFull.body"
          : "assistantPermission.notice.readFull.body",
      )}
    />
  );
}
