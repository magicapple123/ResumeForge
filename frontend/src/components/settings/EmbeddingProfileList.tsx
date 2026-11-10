// SPDX-License-Identifier: Apache-2.0
/**
 * 远程服务列表：标题行 +「新建配置」+ 已保存配置卡 + 空态。
 *
 * 空态不内嵌主按钮（同 LLMConfigCard）：主操作就在同一行的「新建配置」上。
 * 本地模式下也能管理远程配置，只是没有「生效中」。
 */
import { PlusOutlined } from "@ant-design/icons";
import { Button, Flex, Typography } from "antd";
import type { EmbeddingProbeResult, EmbeddingProfile } from "../../api/settings";
import { profileHasPendingChanges } from "../../features/settings/embeddingHelpers";
import type { EmbeddingActionId } from "../../features/settings/useEmbeddingSettings";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import EmptyState from "../common/EmptyState";
import { useCollapsedList } from "../common/useCollapsedList";
import EmbeddingProfileCard from "./EmbeddingProfileCard";

interface Props {
  profiles: EmbeddingProfile[];
  activeProfileId: string | undefined;
  activeProfileUpdatedAt: string | undefined;
  /** 远程是否真的在生效（决定「生效中」标签是否显示）。 */
  remoteReady: boolean;
  busy: EmbeddingActionId | null;
  testingId: string | null;
  testResults: Record<string, EmbeddingProbeResult>;
  onCreate: () => void;
  onUse: (profile: EmbeddingProfile) => void;
  onTest: (profile: EmbeddingProfile) => void;
  onEdit: (profile: EmbeddingProfile) => void;
  onDuplicate: (profile: EmbeddingProfile) => void;
  onClearKey: (profile: EmbeddingProfile) => void;
  onDelete: (profile: EmbeddingProfile) => void;
}

export default function EmbeddingProfileList({
  profiles,
  activeProfileId,
  activeProfileUpdatedAt,
  remoteReady,
  busy,
  testingId,
  testResults,
  onCreate,
  onUse,
  onTest,
  onEdit,
  onDuplicate,
  onClearKey,
  onDelete,
}: Props) {
  useLocale();
  const { visibleItems, toggleNode } = useCollapsedList(profiles);

  return (
    <Flex vertical gap={12}>
      <Flex align="center" justify="space-between" gap={8} wrap>
        <Typography.Text strong>{t("embeddingSearch.remote.profiles.title")}</Typography.Text>
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          aria-label={t("embeddingSearch.remote.profiles.create")}
          disabled={busy !== null || undefined}
          onClick={onCreate}
        >
          {t("embeddingSearch.remote.profiles.create")}
        </Button>
      </Flex>
      {profiles.length === 0 ? (
        <EmptyState inline description={t("embeddingSearch.remote.profiles.emptyHint")} />
      ) : (
        <Flex vertical gap={12}>
          {visibleItems.map((profile) => {
            const active = remoteReady && profile.id === activeProfileId;
            return (
              <EmbeddingProfileCard
                key={profile.id}
                profile={profile}
                active={active}
                pendingChanges={profileHasPendingChanges(
                  profile,
                  activeProfileId,
                  activeProfileUpdatedAt,
                )}
                busy={busy}
                testing={testingId === profile.id}
                testResult={testResults[profile.id]}
                onUse={() => onUse(profile)}
                onTest={() => onTest(profile)}
                onEdit={() => onEdit(profile)}
                onDuplicate={() => onDuplicate(profile)}
                onClearKey={() => onClearKey(profile)}
                onDelete={() => onDelete(profile)}
              />
            );
          })}
          {toggleNode}
        </Flex>
      )}
    </Flex>
  );
}
