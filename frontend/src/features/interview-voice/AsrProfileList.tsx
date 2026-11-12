// SPDX-License-Identifier: Apache-2.0
/** 语音配置列表：配置卡列表 + 空态（新建入口在卡头，空态不再内嵌主按钮）。 */
import { Flex } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import EmptyState from "../../components/common/EmptyState";
import AsrProfileCard from "./AsrProfileCard";
import type { AsrProfile, AsrTestResult } from "./asrApi";

interface Props {
  profiles: AsrProfile[];
  activeId: string;
  /** 正在执行动作的配置 id（同一时刻只允许一个）。 */
  busyId: string | null;
  testingId: string | null;
  testResults: Record<string, AsrTestResult>;
  onUse: (profile: AsrProfile) => void;
  onTest: (profile: AsrProfile) => void;
  onEdit: (profile: AsrProfile) => void;
  onDuplicate: (profile: AsrProfile) => void;
  onClearKey: (profile: AsrProfile) => void;
  onDelete: (profile: AsrProfile) => void;
}

export default function AsrProfileList({
  profiles,
  activeId,
  busyId,
  testingId,
  testResults,
  onUse,
  onTest,
  onEdit,
  onDuplicate,
  onClearKey,
  onDelete,
}: Props) {
  useLocale();
  // 任意一条在忙时整组动作禁用：并发写 global_settings.json 会互相覆盖。
  const cardBusy = busyId !== null || testingId !== null;

  if (profiles.length === 0) {
    return (
      // 不内嵌主按钮：卡头 extra 已有「新建配置」，同一屏再放一颗 primary 就是两个同义主
      // 动作（§4.1）。描述里点名那个按钮即可（它同屏可见）。
      <EmptyState inline description={t("voiceInput.settings.profiles.emptyHint")} />
    );
  }

  return (
    <Flex vertical gap={12}>
      {profiles.map((profile) => (
        <AsrProfileCard
          key={profile.id}
          profile={profile}
          active={profile.id === activeId}
          busy={busyId === profile.id}
          cardBusy={cardBusy && busyId !== profile.id}
          testing={testingId === profile.id}
          testResult={testResults[profile.id]}
          onUse={() => onUse(profile)}
          onTest={() => onTest(profile)}
          onEdit={() => onEdit(profile)}
          onDuplicate={() => onDuplicate(profile)}
          onClearKey={() => onClearKey(profile)}
          onDelete={() => onDelete(profile)}
        />
      ))}
    </Flex>
  );
}
