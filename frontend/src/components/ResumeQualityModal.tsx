// SPDX-License-Identifier: Apache-2.0
/** 质量检测弹窗：风险扫描（R-08~R-09）与 ATS 本地检测（R-10）同用一个 Tabs 面板。 */
import { Modal, Tabs } from "antd";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import AtsCheckPanel from "./AtsCheckPanel";
import ResumeRiskPanel from "./ResumeRiskPanel";

interface Props {
  open: boolean;
  resumeId: number | null;
  /** 简历内容的签名：风险扫描完成后用它判断"内容是不是改过了"。 */
  contentSignature?: string;
  /** 关联岗位 id：ATS 面板据此提供「从关联岗位载入 JD」。 */
  jobId?: number;
  onClose: () => void;
}

export default function ResumeQualityModal({
  open,
  resumeId,
  contentSignature,
  jobId,
  onClose,
}: Props) {
  useLocale();
  return (
    <Modal
      title={t("componentsMisc.qualityModal.title")}
      open={open}
      onCancel={onClose}
      width="min(880px, calc(100vw - 24px))"
      footer={null}
      destroyOnHidden
      styles={{ body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto" } }}
    >
      {resumeId != null && (
        <Tabs
          items={[
            {
              key: "risk",
              label: t("componentsMisc.qualityModal.tab.risk"),
              children: <ResumeRiskPanel resumeId={resumeId} contentSignature={contentSignature} />,
            },
            {
              key: "ats",
              label: t("componentsMisc.qualityModal.tab.ats"),
              children: <AtsCheckPanel resumeId={resumeId} jobId={jobId} />,
            },
          ]}
        />
      )}
    </Modal>
  );
}
