// SPDX-License-Identifier: Apache-2.0
/**
 * 「已就绪」态：状态行 + 切换入口 + 一行说明（2026-11-10 第二轮重排）。
 *
 * 第 1/16 条之前这里只有「关闭语义检索」+ ⋮：想换到另一边必须先关掉再走一遍启用流程，
 * 而且旧写路径会把对方的配置整段覆盖掉。现在切换 = `POST /profiles/{id}/activate`
 * （本地/远程各存一条 profile，互不覆盖），失败时当前 provider 不变。
 *
 * 重排的三条依据（清单 §3）：
 * - **同一事实只说一遍**：host / 模型 / 维度此前在这里与生效配置卡上各说一次，现在只在
 *   配置卡上说（维度补进它的 meta 行），这里只留"能不能用 + 怎么换"。
 * - 顶部 ⋮ 与配置卡的 ⋮ 是同一批动作的两个入口，删掉；本地态的「删除已下载文件」改成
 *   显式文字按钮——它是那条路径的唯一出口，不能跟着 ⋮ 一起消失。
 * - 回退说明与重建代价本来就是一句话的两半，合成第二行小字。
 */
import { DownOutlined } from "@ant-design/icons";
import { Badge, Button, Dropdown, Flex, Popconfirm, Tooltip, Typography } from "antd";
import type { EmbeddingProfile, EmbeddingStatus } from "../../api/settings";
import type { EmbeddingActionId } from "./useEmbeddingSettings";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  status: EmbeddingStatus;
  busy: EmbeddingActionId | null;
  /** 可切换的远程配置（有密钥的）。 */
  remoteCandidates: EmbeddingProfile[];
  onSwitchToLocal: () => void;
  onDownloadLocal: () => void;
  onSwitchToRemote: (profile: EmbeddingProfile) => void;
  onRemoveAssets: () => void;
}

export default function EmbeddingReadyPanel({
  status,
  busy,
  remoteCandidates,
  onSwitchToLocal,
  onDownloadLocal,
  onSwitchToRemote,
  onRemoveAssets,
}: Props) {
  useLocale();
  const local = status.provider !== "openai-http";
  const localReady = status.local.state === "ready";

  const remoteSwitch =
    remoteCandidates.length === 0 ? (
      <Tooltip title={t("embeddingSearch.ready.switchRemoteEmpty")}>
        <span>
          <Button size="small" disabled>
            {t("embeddingSearch.ready.switchRemote")}
          </Button>
        </span>
      </Tooltip>
    ) : remoteCandidates.length === 1 ? (
      <Button
        size="small"
        loading={busy === "activate"}
        onClick={() => onSwitchToRemote(remoteCandidates[0])}
      >
        {t("embeddingSearch.ready.switchRemoteHost", { host: remoteCandidates[0].host })}
      </Button>
    ) : (
      <Dropdown
        trigger={["click"]}
        disabled={busy !== null}
        menu={{
          items: remoteCandidates.map((profile) => ({
            key: profile.id,
            label: `${profile.name} · ${profile.host}`,
          })),
          onClick: ({ key }) => {
            const target = remoteCandidates.find((item) => item.id === key);
            if (target) onSwitchToRemote(target);
          },
        }}
      >
        <Button size="small" loading={busy === "activate"}>
          {t("embeddingSearch.ready.switchRemote")}
          <DownOutlined />
        </Button>
      </Dropdown>
    );

  const switchNode = local ? (
    remoteSwitch
  ) : localReady ? (
    <Button size="small" loading={busy === "activate"} onClick={onSwitchToLocal}>
      {t("embeddingSearch.ready.switchLocal")}
    </Button>
  ) : (
    <Button size="small" loading={busy === "download"} onClick={onDownloadLocal}>
      {t("embeddingSearch.ready.downloadLocal")}
    </Button>
  );

  return (
    <Flex vertical gap={4}>
      <Flex justify="space-between" align="center" gap={12} wrap>
        <Flex align="center" gap={8} wrap>
          <Badge status="success" />
          <Typography.Text strong>
            {local ? t("embeddingSearch.state.readyLocal") : t("embeddingSearch.state.readyRemote")}
          </Typography.Text>
        </Flex>
        <Flex align="center" gap={8} wrap>
          {switchNode}
          {local && localReady ? (
            // 删除本地模型文件是这条路径的**唯一**出口（顶部 ⋮ 已去掉），
            // 保留原有的二次确认语义：删完必须重新下载才能用。
            <Popconfirm
              title={t("embeddingSearch.local.removeTitle")}
              description={t("embeddingSearch.local.removeConfirm")}
              okText={t("embeddingSearch.local.remove")}
              cancelText={t("common.action.cancel")}
              okButtonProps={{ danger: true, loading: busy === "remove" }}
              onConfirm={onRemoveAssets}
            >
              <Button type="text" danger size="small">
                {t("embeddingSearch.local.remove")}
              </Button>
            </Popconfirm>
          ) : null}
        </Flex>
      </Flex>
      <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: 1.35 }}>
        {local ? t("embeddingSearch.local.readyHint") : t("embeddingSearch.fallbackNote")} ·{" "}
        {t("embeddingSearch.ready.rebuildHint")}
      </Typography.Text>
    </Flex>
  );
}
