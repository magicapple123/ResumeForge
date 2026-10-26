// SPDX-License-Identifier: Apache-2.0
/**
 * 「版本与变体」弹窗（W13）：命名版本 + 岗位变体两个只读/显式动作页。
 *
 * 挂载由 shell 完成（发过接入单）；本组件内部不再开第二层弹窗：比较视图内联在列表下方，
 * 恢复用就地 Popconfirm（符合 AGENTS 的叠层约束）。
 */
import { Modal, Tabs } from "antd";
import { t } from "../../../i18n";
import { useVariants } from "../../../features/resume-versions/useVariants";
import { useVersions } from "../../../features/resume-versions/useVersions";
import type { VersionRestoreOut } from "../../../features/resume-versions/types";
import ScenarioVariantSection from "./ScenarioVariantSection";
import VariantsPanel from "./VariantsPanel";
import VersionList from "./VersionList";
import { useLocale } from "../../../i18n/i18nContext";

export interface VersionsModalProps {
  open: boolean;
  onClose: () => void;
  resumeId?: number | null;
  /** 宿主当前 revision：恢复时作为 expected_revision（过期 409 不自动覆盖）。 */
  currentRevision?: number;
  /** 宿主当前内容：选择性同步的路径来源。 */
  currentContent?: Record<string, unknown> | null;
  /** 恢复成功：宿主据此更新简历详情/revision（不要猜后端的新 revision）。 */
  onRestored?: (result: VersionRestoreOut) => void;
}

export default function VersionsModal({
  open,
  onClose,
  resumeId,
  currentRevision,
  currentContent,
  onRestored,
}: VersionsModalProps) {
  useLocale();
  const versions = useVersions({ resumeId: open ? resumeId : null, onRestored });
  const variants = useVariants({ resumeId: open ? resumeId : null });

  const items = [
    {
      key: "versions",
      label: t("versions.tab.versions"),
      children: (
        <VersionList
          versions={versions.versions}
          loading={versions.loading}
          error={versions.error}
          actionError={versions.actionError}
          restoringId={versions.restoringId}
          conflict={versions.conflict}
          currentRevision={currentRevision}
          onCreate={versions.create}
          onFreeze={versions.setFrozen}
          onRestore={versions.restore}
          onCompare={versions.compare}
          onRefresh={() => void versions.reload()}
        />
      ),
    },
    {
      key: "variants",
      label: t("versions.tab.variants"),
      children: (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* A5：先派生场景变体、生成候选并采纳；源简历只读，不经过本弹窗写回。 */}
          <ScenarioVariantSection
            resumeId={resumeId ?? null}
            variants={variants.variants}
            onChanged={() => void variants.reload()}
          />
          <VariantsPanel
            variants={variants.variants}
            loading={variants.loading}
            error={variants.error}
            actionError={variants.actionError}
            syncing={variants.syncing}
            versions={versions.versions}
            currentContent={currentContent}
            onCreate={variants.create}
            onSync={variants.sync}
            onRefresh={() => void variants.reload()}
          />
        </div>
      ),
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={t("versions.title")}
      footer={null}
      width={960}
      destroyOnHidden
    >
      <Tabs items={items} />
    </Modal>
  );
}
