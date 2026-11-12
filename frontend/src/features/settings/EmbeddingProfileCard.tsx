// SPDX-License-Identifier: Apache-2.0
/**
 * 一张命名配置卡：名称 + 生效中/厂商/密钥标签 + host、模型 + 使用 / 测试连接 / ⋮。
 *
 * - 点卡本体（普通 div + onClick）打开编辑弹窗。**不能给卡根加 `role="button"`
 *   或 `tabIndex`**——卡里已经有「使用 / 测试连接 / ⋮」三个可聚焦按钮，交互角色套
 *   交互角色会被 axe 判 `nested-interactive`（serious）。键盘用户的等价入口是
 *   ⋮ → 编辑，功能不丢；鼠标用户仍可整卡点击。
 * - 动作区 stopPropagation，避免点按钮顺带打开弹窗；
 * - ⋮ 的 aria-label 带配置名，键盘可打开（antd Dropdown 自带）；
 * - 测试结果用卡内 Alert（与 LLMConfigCard 对齐），错误逐条归属。
 */
import { ApiOutlined, MoreOutlined, SwapOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Dropdown, Flex, Tag, Tooltip, Typography } from "antd";
import type { EmbeddingProbeResult, EmbeddingProfile } from "../../api/settings";
import { embeddingGuidanceKey, profilePresetLabelKey } from "./embeddingHelpers";
import type { EmbeddingActionId } from "./useEmbeddingSettings";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  profile: EmbeddingProfile;
  /** 当前生效（且已就绪）的那条。 */
  active: boolean;
  /** 生效项保存后有未生效改动（updated_at 晚于激活时间）。 */
  pendingChanges: boolean;
  busy: EmbeddingActionId | null;
  testing: boolean;
  testResult?: EmbeddingProbeResult;
  onUse: () => void;
  onTest: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onClearKey: () => void;
  onDelete: () => void;
}

export default function EmbeddingProfileCard({
  profile,
  active,
  pendingChanges,
  busy,
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
  const cardBusy = busy !== null;
  return (
    <Card
      size="small"
      style={{ cursor: "pointer" }}
      onClick={onEdit}
      title={
        <Flex gap={8} wrap align="center">
          <Typography.Text strong>{profile.name}</Typography.Text>
          {active ? <Tag color="blue">{t("embeddingSearch.remote.profile.active")}</Tag> : null}
          {pendingChanges ? (
            <Tag color="orange">{t("embeddingSearch.remote.profile.pendingChanges")}</Tag>
          ) : null}
        </Flex>
      }
    >
      <Flex gap={8} wrap style={{ marginBottom: 8 }}>
        <Tag>{t(profilePresetLabelKey(profile.preset_id))}</Tag>
        <Typography.Text type="secondary">{profile.host || profile.model}</Typography.Text>
        {profile.host && profile.model ? (
          <Typography.Text type="secondary">{profile.model}</Typography.Text>
        ) : null}
        {/* 维度原先只在就绪面板上出现；面板收掉那三行后由这里承担（清单 §3.3）。 */}
        {profile.dim > 0 ? (
          <Typography.Text type="secondary">
            {t("embeddingSearch.remote.profile.dimValue", { dim: profile.dim })}
          </Typography.Text>
        ) : null}
        {profile.key_configured ? (
          <Tag color="green">{t("embeddingSearch.remote.profile.keyConfigured")}</Tag>
        ) : null}
      </Flex>
      <div
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Flex gap={8} wrap>
          {/* 生效项不再渲染「使用中」禁用按钮：标题旁已有「生效中」标签，
              同一状态说两遍还占一个按钮位（清单 §3.2 第 5 条）。 */}
          {active ? null : (
            <Button
              size="small"
              type="primary"
              icon={<SwapOutlined />}
              disabled={cardBusy || undefined}
              aria-label={t("embeddingSearch.remote.profile.use")}
              onClick={onUse}
            >
              {t("embeddingSearch.remote.profile.use")}
            </Button>
          )}
          <Button
            size="small"
            icon={<ApiOutlined />}
            disabled={cardBusy || undefined}
            loading={testing}
            aria-label={t("embeddingSearch.remote.profile.test")}
            onClick={onTest}
          >
            {t("embeddingSearch.remote.profile.test")}
          </Button>
          <Tooltip title={t("embeddingSearch.remote.profile.moreActions", { name: profile.name })}>
            <Dropdown
              trigger={["click"]}
              disabled={cardBusy}
              menu={{
                items: [
                  { key: "edit", label: t("embeddingSearch.remote.profile.edit") },
                  { key: "duplicate", label: t("embeddingSearch.remote.profile.duplicate") },
                  { key: "clear-key", label: t("embeddingSearch.remote.clear") },
                  {
                    key: "delete",
                    label: t("embeddingSearch.remote.profile.delete"),
                    danger: true,
                  },
                ],
                onClick: ({ key }) => {
                  if (key === "edit") onEdit();
                  else if (key === "duplicate") onDuplicate();
                  else if (key === "clear-key") onClearKey();
                  else onDelete();
                },
              }}
            >
              <Button
                size="small"
                icon={<MoreOutlined />}
                aria-label={t("embeddingSearch.remote.profile.moreActions", { name: profile.name })}
                disabled={cardBusy}
              />
            </Dropdown>
          </Tooltip>
        </Flex>
        {testResult ? (
          <Alert
            style={{ marginTop: 12 }}
            type={testResult.ok ? "success" : "error"}
            showIcon
            title={
              testResult.ok
                ? t("embeddingSearch.remote.testOk", { dim: testResult.dim })
                : t("embeddingSearch.remote.testFailed")
            }
            description={
              testResult.ok ? (
                testResult.model
              ) : (
                <>
                  <div>{testResult.error || t("embeddingSearch.guidance.retry")}</div>
                  <Typography.Text type="secondary">
                    {t(embeddingGuidanceKey(testResult.error))}
                  </Typography.Text>
                </>
              )
            }
          />
        ) : null}
      </div>
    </Card>
  );
}
