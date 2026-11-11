// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「语音转写」卡：命名配置列表 + 新建/编辑弹窗。
 *
 * 信息架构（对齐「大模型 API 配置」卡）：
 * - 首屏 = 标题 + 未配置/已配置徽标 + 一句话 Alert + 已保存配置列表；
 * - 卡头 `extra` 是唯一主操作「新建配置」；地址/协议/模型/Key 只在弹窗里出现；
 * - 每张卡的动作是「使用 / 测试连接 / ⋮（编辑、复制、清除 Key、删除）」；
 * - 「使用」只切 active_profile_id，不探测网络；不完整的配置直接禁用并说明缺什么。
 *
 * 这里只做编排：数据与动作在 `useAsrProfiles`，列表/卡片/弹窗各自成文件——旧卡片曾经
 * 顶到 480/500 行，再加功能就走不动了。
 */
import { PlusOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Flex, Tag, Tooltip, Typography } from "antd";
import { useState } from "react";
import ErrorState from "../common/ErrorState";
import LoadingBlock from "../common/LoadingBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useAsrProfiles } from "../../features/settings/useAsrProfiles";
import AsrProfileList from "./AsrProfileList";
import AsrProfileModal from "./AsrProfileModal";
import MicSettingsRow from "./MicSettingsRow";
import {
  MAX_ASR_PROFILES,
  NEW_ASR_PROFILE_ID,
  providerHostOf,
  type AsrProfile,
  type AsrProfilePayload,
  type AsrProfileTestPayload,
} from "./asrApi";

export default function AsrSettingsCard() {
  useLocale();
  const { message } = App.useApp();
  const controller = useAsrProfiles();
  const [modalOpen, setModalOpen] = useState(false);
  // edit 的来源（null = 新建）；duplicateFrom 只用于"复制一份"的预填。
  const [editing, setEditing] = useState<AsrProfile | null>(null);
  const [duplicateFrom, setDuplicateFrom] = useState<AsrProfile | null>(null);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setDuplicateFrom(null);
    setModalOpen(true);
  };
  const openEdit = (profile: AsrProfile) => {
    setEditing(profile);
    setDuplicateFrom(null);
    setModalOpen(true);
  };
  const openDuplicate = (profile: AsrProfile) => {
    setEditing(null);
    setDuplicateFrom(profile);
    setModalOpen(true);
  };

  /** 弹窗的测试结论按"编辑目标 / 新建占位"存，关窗时清掉。 */
  const modalTestId = editing?.id ?? NEW_ASR_PROFILE_ID;
  const closeModal = () => {
    controller.clearTestResult(modalTestId);
    setModalOpen(false);
  };

  const saveModal = async (payload: AsrProfilePayload): Promise<void> => {
    setSaving(true);
    try {
      // 失败（重名 409、条数上限等）原样抛给弹窗就地显示，不在这里吞掉。
      await controller.save(payload);
      message.success(t("voiceInput.settings.saved"));
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const testModal = (draft: AsrProfileTestPayload) => controller.test(modalTestId, draft);

  const atLimit = controller.profiles.length >= MAX_ASR_PROFILES;
  const createButton = (
    <Button
      type="primary"
      icon={<PlusOutlined />}
      disabled={controller.loading || atLimit || controller.busyId !== null || undefined}
      onClick={openCreate}
    >
      {t("voiceInput.settings.profiles.create")}
    </Button>
  );
  const activeHost = controller.activeProfile
    ? providerHostOf(controller.activeProfile.base_url)
    : "";

  return (
    <>
      <Card
        className="settings-card"
        title={
          <Flex align="center" gap={8}>
            <span>{t("voiceInput.settings.title")}</span>
            <Tag color={controller.activeProfile?.configured ? "green" : undefined}>
              {controller.activeProfile?.configured
                ? t("voiceInput.settings.badge.configured")
                : t("voiceInput.settings.badge.notConfigured")}
            </Tag>
          </Flex>
        }
        extra={
          atLimit ? (
            <Tooltip title={t("voiceInput.settings.validation.profileLimit")}>
              {/* 按钮 disabled 时收不到 hover：Tooltip 必须挂在壳上。 */}
              <span>{createButton}</span>
            </Tooltip>
          ) : (
            createButton
          )
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={t("voiceInput.settings.cardHint")}
        />

        {/* 麦克风选择与「测试麦克风」放在配置列表之前：出现「没声音」时，
            第一件该做的事是确认输入设备，而不是改服务商配置。 */}
        <div style={{ marginBottom: 16 }}>
          <MicSettingsRow />
        </div>

        {controller.loadError ? (
          <div style={{ marginBottom: 16 }}>
            <ErrorState
              description={
                <>
                  <div>{t("voiceInput.settings.loadErrorTitle")}</div>
                  <Typography.Text type="secondary">
                    {t("voiceInput.settings.loadErrorBody", { message: controller.loadError })}
                  </Typography.Text>
                </>
              }
              onRetry={() => void controller.reload()}
              retryLabel={t("common.retry")}
            />
          </div>
        ) : null}

        <LoadingBlock spinning={controller.loading}>
          <AsrProfileList
            profiles={controller.profiles}
            activeId={controller.activeProfile?.id ?? ""}
            busyId={controller.busyId}
            testingId={controller.testingId}
            testResults={controller.testResults}
            onUse={(profile) => void controller.activate(profile)}
            onTest={(profile) => void controller.test(profile.id)}
            onEdit={openEdit}
            onDuplicate={openDuplicate}
            onClearKey={(profile) => void controller.clearKey(profile)}
            onDelete={(profile) => void controller.remove(profile)}
          />
        </LoadingBlock>

        <div style={{ marginTop: 16 }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
            {t("voiceInput.settings.limitHint")}
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
            {t("voiceInput.settings.providerNote")}
          </Typography.Paragraph>
          {controller.activeProfile?.configured && activeHost ? (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {t("voiceInput.settings.privacyNote", { host: activeHost })}
            </Typography.Paragraph>
          ) : null}
        </div>
      </Card>

      <AsrProfileModal
        open={modalOpen}
        mode={editing ? "edit" : "create"}
        source={editing ?? duplicateFrom}
        activeId={controller.activeProfile?.id ?? ""}
        takenNames={controller.profiles
          .filter((profile) => profile.id !== editing?.id)
          .map((profile) => profile.name)}
        saving={saving}
        testing={controller.testingId === modalTestId}
        testResult={controller.testResults[modalTestId]}
        onSave={saveModal}
        onTest={testModal}
        onClose={closeModal}
      />
    </>
  );
}
