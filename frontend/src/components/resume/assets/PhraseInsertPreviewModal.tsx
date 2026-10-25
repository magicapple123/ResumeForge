// SPDX-License-Identifier: Apache-2.0
/** 插入资产前的确认层（W17）：当前目标文本 → 将插入的新文本，确认才写库。 */
import { Button, Modal, Typography } from "antd";
import { at } from "../../../features/resume-assets/i18n";
import type { ResumePhrase } from "../../../features/resume-assets/types";
import PhraseDiffPreview from "./PhraseDiffPreview";

interface Props {
  open: boolean;
  phrase: ResumePhrase | null;
  /** 插入目标的展示文本（如 `experience.0.description`）；空 = 未指定。 */
  targetLabel?: string;
  /** 目标位置当前文本（有选中要点时由宿主提供）；缺省只展示新增。 */
  currentText?: string;
  inserting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function PhraseInsertPreviewModal({
  open,
  phrase,
  targetLabel,
  currentText = "",
  inserting = false,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <Modal
      open={open}
      title={at("assets.insert.previewTitle")}
      onCancel={onCancel}
      mask={{ closable: false }}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={inserting || undefined}>
          {at("assets.insert.previewCancel")}
        </Button>,
        <Button key="confirm" type="primary" loading={inserting || undefined} onClick={onConfirm}>
          {at("assets.insert.confirm")}
        </Button>,
      ]}
    >
      <Typography.Paragraph style={{ marginBottom: 8 }}>
        {at("assets.insert.previewHint")}
      </Typography.Paragraph>
      {targetLabel ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {at("assets.insert.previewTarget", { target: targetLabel })}
        </Typography.Text>
      ) : null}
      {phrase ? (
        <div style={{ marginTop: 8 }}>
          <PhraseDiffPreview
            before={currentText}
            after={phrase.text}
            beforeLabel={at("assets.insert.previewCurrent")}
            afterLabel={at("assets.insert.previewNew")}
          />
        </div>
      ) : null}
    </Modal>
  );
}
