// SPDX-License-Identifier: Apache-2.0
/**
 * 输入区「数据权限」四档下拉（T11 / #12）。
 *
 * 触发区显示当前档位；无会话（还没建）时只显示「跟随全局」且不可改——覆盖值按会话存
 * localStorage，没有会话就没有可覆盖的对象。
 *
 * 本组件**不再**自己弹确认框，也**不再**渲染琥珀提示条（#12）：
 * - 确认卡由 `PermissionConfirmModal` 承担，触发判定在 `useAssistantPermission` 的
 *   `needsConfirm`（按「会话 + 档位」记账，旧的布尔 ack 不继承）；
 * - 常驻横幅删除后，档位可见性由这颗 chip 承担——所以它的文案必须始终带档位名。
 */
import { Button, Dropdown, Tooltip } from "antd";
import { CheckOutlined, DownOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { t } from "../../../../i18n";
import { useLocale } from "../../../../i18n/i18nContext";
import {
  ASSISTANT_PERMISSION_DESC_KEYS,
  ASSISTANT_PERMISSION_LABEL_KEYS,
  ASSISTANT_PERMISSION_LEVELS,
  FOLLOW_GLOBAL,
  type AssistantPermissionChoice,
  type AssistantPermissionLevel,
} from "../../assistantPermission";

/** 档位显示名（渲染期求值；模块作用域不调用 t()）。 */
function assistantPermissionLabel(level: AssistantPermissionLevel): string {
  return t(ASSISTANT_PERMISSION_LABEL_KEYS[level]);
}

export interface PermissionMenuProps {
  /** 保留在契约里：父级仍在传，但确认判定已上移到 useAssistantPermission（#12）。 */
  conversationId: number | null;
  choice: AssistantPermissionChoice;
  effectiveLevel: AssistantPermissionLevel;
  editable: boolean;
  onChange: (choice: AssistantPermissionChoice) => void;
}

export default function PermissionMenu({
  choice,
  effectiveLevel,
  editable,
  onChange,
}: PermissionMenuProps) {
  // 本组件用模块级 t()：必须订阅语言变化。
  useLocale();
  const followLabel = t("assistantPermission.followGlobalWith", {
    level: assistantPermissionLabel(effectiveLevel),
  });

  // 是否需要弹确认卡由 useAssistantPermission 的 needsConfirm 判定（按会话 + 档位），
  // 本组件不再自己做安全判定——两套判据迟早会不一致。
  const choose = (next: AssistantPermissionChoice) => onChange(next);

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
