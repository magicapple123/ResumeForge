// SPDX-License-Identifier: Apache-2.0
/** 我的资料页的页内提示区：待处理公告、深链目标分区被隐藏的提示、旧数据升级提示。 */
import { Alert, Button } from "antd";
import type { WorkspaceOut } from "../features/profile/library/types";
import ProfileDeepLinkNotice from "../features/profile/ProfileDeepLinkNotice";
import ProfileUpgradeNotice from "../features/profile/library/ProfileUpgradeNotice";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

interface Props {
  workspace: WorkspaceOut | null;
  /** 公告条「知道了」：把当前组的 pending_notice 标记为已读。 */
  onAcknowledgeNotice: (noticeId: string) => void;
  /** 深链指向的分区 key；空串表示没有待展示的深链缺失提示。 */
  missingSectionKey: string;
  /** 深链目标分区的展示名。 */
  missingSectionName: string;
  onShowMissingSection: () => void;
  onOpenBackup: () => void;
  onStartFill: () => void;
}

export default function ProfilePageNotices({
  workspace,
  onAcknowledgeNotice,
  missingSectionKey,
  missingSectionName,
  onShowMissingSection,
  onOpenBackup,
  onStartFill,
}: Props) {
  useLocale();
  return (
    <>
      {workspace?.pending_notice ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title={workspace.pending_notice.message ?? t("profileGroups.notice.fallback")}
          action={
            <Button
              size="small"
              onClick={() => onAcknowledgeNotice(workspace.pending_notice?.notice_id ?? "")}
            >
              {t("profileGroups.notice.ack")}
            </Button>
          }
        />
      ) : null}
      {missingSectionKey ? (
        <ProfileDeepLinkNotice sectionName={missingSectionName} onShow={onShowMissingSection} />
      ) : null}
      {workspace ? (
        <ProfileUpgradeNotice
          hasLegacyData={workspace.upgrade.has_legacy_data}
          newProfileHasEntries={workspace.upgrade.new_profile_has_entries}
          onOpenBackup={onOpenBackup}
          onStartFill={onStartFill}
        />
      ) : null}
    </>
  );
}
