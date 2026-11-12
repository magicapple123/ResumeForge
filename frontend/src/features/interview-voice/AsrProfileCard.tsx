// SPDX-License-Identifier: Apache-2.0
/**
 * 一条语音配置的卡片：名称 / 生效中 / 厂商标签 / 主机 / 模型 / 协议 + 使用 / 测试连接 / ⋮。
 *
 * 无障碍：卡本体是 `div role="button" tabIndex=0`（Enter/空格 = 打开编辑），动作区单独
 * `stopPropagation`，避免点「使用」同时触发编辑；⋮ 的可访问名带配置名（多张卡只读名字
 * 才分得清点的是哪一条）。
 *
 * 删除的二次确认走 `useRowActionMenu`：它是全局同一套 confirm（含后果段与具体按钮文案），
 * 不在卡片里另写一份 `modal.confirm`。
 */
import {
  ApiOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  KeyOutlined,
  MoreOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { Alert, Button, Card, Dropdown, Flex, Tag, Tooltip, Typography } from "antd";
import { useLocale } from "../../i18n/i18nContext";
import { useRowActionMenu } from "../../components/common/rowActionMenu";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { providerHostOf, type AsrProfile, type AsrTestResult } from "./asrApi";
import { ASR_PRESETS } from "./asrPresets";

const PROTOCOL_LABEL_KEYS: Record<string, MessageKey> = {
  openai: "voiceInput.settings.protocol.openai",
  dashscope: "voiceInput.settings.protocol.dashscope",
};

interface Props {
  profile: AsrProfile;
  active: boolean;
  /** 这一条正在执行「使用 / 删除 / 清除 Key」。 */
  busy: boolean;
  /** 任意一条在忙 / 列表动作进行中：整张卡的按钮都禁用，避免并发写。 */
  cardBusy: boolean;
  testing: boolean;
  testResult?: AsrTestResult;
  onUse: () => void;
  onTest: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onClearKey: () => void;
  onDelete: () => void;
}

export default function AsrProfileCard({
  profile,
  active,
  busy,
  cardBusy,
  testing,
  testResult,
  onUse,
  onTest,
  onEdit,
  onDuplicate,
  onClearKey,
  onDelete,
}: Props) {
  useLocale();
  const buildMenu = useRowActionMenu();
  const preset = ASR_PRESETS.find((item) => item.id === profile.preset_id) ?? null;
  const presetLabel = preset ? t(preset.labelKey) : t("voiceInput.settings.provider.custom");
  const host = providerHostOf(profile.base_url) || profile.base_url;

  // 缺什么由前端拼（后端只回 has_key / configured），Tooltip 用它说清"为什么不能使用"。
  const missing: string[] = [];
  if (!profile.base_url) missing.push(t("voiceInput.settings.profile.missing.baseUrl"));
  if (!profile.model) missing.push(t("voiceInput.settings.profile.missing.model"));
  if (!profile.has_key) missing.push(t("voiceInput.settings.profile.missing.key"));
  const incompleteHint = t("voiceInput.settings.profile.incomplete", {
    fields: missing.join(t("voiceInput.settings.profile.missingSeparator")),
  });

  const actionsDisabled = cardBusy || busy;

  const menu = buildMenu(
    [
      {
        key: "edit",
        icon: <EditOutlined />,
        label: t("voiceInput.settings.profile.edit"),
        onClick: onEdit,
      },
      {
        key: "duplicate",
        icon: <CopyOutlined />,
        label: t("voiceInput.settings.profile.duplicate"),
        onClick: onDuplicate,
      },
      {
        key: "clear-key",
        icon: <KeyOutlined />,
        label: t("voiceInput.settings.key.clear"),
        disabled: !profile.has_key,
        onClick: onClearKey,
      },
      {
        key: "delete",
        icon: <DeleteOutlined />,
        label: t("voiceInput.settings.profile.delete"),
        danger: true,
        onClick: onDelete,
        confirm: t("voiceInput.settings.profile.deleteTitle"),
        confirmBody: t("voiceInput.settings.profile.deleteConfirm"),
        confirmOkText: t("voiceInput.settings.profile.delete"),
        confirmCancelText: t("common.action.cancel"),
      },
    ],
    {},
  );

  const applyButton = (
    <Button
      size="small"
      type={active ? "default" : "primary"}
      icon={<SwapOutlined />}
      loading={busy}
      disabled={actionsDisabled || active || !profile.configured || undefined}
      onClick={onUse}
    >
      {active ? t("voiceInput.settings.profile.using") : t("voiceInput.settings.profile.use")}
    </Button>
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t("voiceInput.settings.profile.editAria", { name: profile.name })}
      onClick={onEdit}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onEdit();
      }}
      style={{ cursor: "pointer" }}
    >
      <Card
        size="small"
        title={
          <Flex gap={8} wrap align="center">
            <Typography.Text strong>{profile.name}</Typography.Text>
            {active ? <Tag color="blue">{t("voiceInput.settings.badge.active")}</Tag> : null}
          </Flex>
        }
      >
        <Flex gap={8} wrap style={{ marginBottom: 12 }}>
          <Tag>{presetLabel}</Tag>
          <Typography.Text type="secondary">
            {host || t("voiceInput.settings.profile.unset")}
          </Typography.Text>
          <Typography.Text type="secondary">
            {profile.model || t("voiceInput.settings.profile.unset")}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t(PROTOCOL_LABEL_KEYS[profile.protocol] ?? "voiceInput.settings.protocol.openai")}
          </Typography.Text>
        </Flex>

        <div
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            // 动作区里的 Enter/空格属于按钮自己，不能冒泡成"打开编辑"。
            if (event.key === "Enter" || event.key === " ") event.stopPropagation();
          }}
        >
          <Flex gap={8} wrap>
            {active || profile.configured ? (
              applyButton
            ) : (
              <Tooltip title={incompleteHint}>
                {/* 禁用的按钮不接收鼠标事件，Tooltip 必须挂在能收到 hover 的壳上。 */}
                <span>{applyButton}</span>
              </Tooltip>
            )}
            <Button
              size="small"
              icon={<ApiOutlined />}
              loading={testing}
              disabled={actionsDisabled || undefined}
              onClick={onTest}
            >
              {t("voiceInput.settings.test")}
            </Button>
            <Dropdown menu={{ items: menu }} trigger={["click"]} disabled={actionsDisabled}>
              <Button
                size="small"
                icon={<MoreOutlined />}
                aria-label={t("voiceInput.settings.profile.more", { name: profile.name })}
                disabled={actionsDisabled || undefined}
              />
            </Dropdown>
          </Flex>
          {testResult ? (
            <Alert
              style={{ marginTop: 12 }}
              type={testResult.ok ? "success" : "error"}
              showIcon
              title={
                testResult.ok
                  ? testResult.latency_ms != null
                    ? t("voiceInput.settings.testOk", { ms: testResult.latency_ms })
                    : testResult.message
                  : testResult.message
              }
            />
          ) : null}
        </div>
      </Card>
    </div>
  );
}
