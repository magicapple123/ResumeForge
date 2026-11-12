// SPDX-License-Identifier: Apache-2.0
/**
 * 「版本与变体」弹窗（W13）：命名版本 + 岗位变体两个只读/显式动作页。
 *
 * 挂载由 shell 完成（发过接入单）；本组件内部不再开第二层弹窗：比较视图内联在列表下方，
 * 恢复用就地 Popconfirm（符合 AGENTS 的叠层约束）。
 */
import { Modal, Tabs } from "antd";
import "./versions.css";
import { t } from "../../../i18n";
import { useVariants } from "./useVariants";
import { useVersions } from "./useVersions";
import type { VersionRestoreOut } from "./types";
import type { ResumeDocument } from "../../../types/resumeDocument";
import ScenarioVariantSection from "./ScenarioVariantSection";
import VariantCreatePanel from "./VariantCreatePanel";
import VariantsPanel from "./VariantsPanel";
import VersionList from "./VersionList";
import { useLocale } from "../../../i18n/i18nContext";

export interface VersionsModalProps {
  open: boolean;
  onClose: () => void;
  resumeId?: number | null;
  /** 宿主当前 revision：恢复时作为 expected_revision（过期 409 不自动覆盖）。 */
  currentRevision?: number;
  /** 宿主当前文档：选择性同步的路径来源（R-23 起是 v2 文档，不再接受 v1 content）。 */
  currentContent?: ResumeDocument | null;
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
          {/* #29a：创建入口只有一块（Segmented 二选一 + 「创建变体」）。 */}
          <VariantCreatePanel
            resumeId={resumeId ?? null}
            versions={versions.versions}
            onCreateManual={variants.create}
            onCreated={() => void variants.reload()}
          />
          {/* 场景变体的候选生成（没创建过场景变体时整块不渲染）；源简历只读。 */}
          <ScenarioVariantSection
            resumeId={resumeId ?? null}
            variants={variants.variants}
            onChanged={() => void variants.reload()}
          />
          {/* 已有变体列表 + 同步到已有变体。 */}
          <VariantsPanel
            variants={variants.variants}
            loading={variants.loading}
            error={variants.error}
            actionError={variants.actionError}
            syncing={variants.syncing}
            versions={versions.versions}
            currentDocument={currentContent}
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
      // #28：body 限高内部滚动（长版本列表不再把弹窗顶出视口）；页签条 sticky。
      styles={{ body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto" } }}
      classNames={{ body: "rf-versions-body" }}
    >
      <Tabs items={items} />
    </Modal>
  );
}
