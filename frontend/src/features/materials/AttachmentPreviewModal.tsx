// SPDX-License-Identifier: Apache-2.0
/**
 * 资料箱附件预览弹层：点附件就把它的内容摊开看，而不是只有一个回形针图标。
 *
 * 两种能看的东西（数据形状见 `types/material.ts` 的 `MaterialFile`）：
 * - **图片**：`data_url` 是一张图片 data URL（后端只接受图片），直接大图看；
 * - **文档**（PDF/Word/Excel/纯文本…）：后端**只存了提取出来的 `text`**，没有原始
 *   字节，所以这里只能展示"文本层"。这点必须明说（`previewTextNote`），否则用户会以为
 *   这就是原件的排版，从而对"预览里格式全没了"产生疑问。
 *
 * 两者都没有（历史上传但没提取出文字的附件）→ 明确告知没有可预览内容。
 */
import { FileTextOutlined } from "@ant-design/icons";
import { Alert, Image, Modal, Typography } from "antd";
import type { MaterialFile } from "../../types";
import { canPreviewImage } from "../../utils/attachments";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 图片预览的最大高度：60vh 让宽图/长图都能完整落在视口里，不必滚动整页。 */
const IMAGE_MAX_HEIGHT = "60vh";

export function AttachmentPreviewModal({
  file,
  onClose,
}: {
  /** null = 关闭。 */
  file: MaterialFile | null;
  onClose: () => void;
}) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后弹层文案不重渲染。
  useLocale();
  const isImage = Boolean(file?.data_url) && canPreviewImage(file?.mime_type ?? "");
  const text = (file?.text ?? "").trim();

  return (
    <Modal
      open={file !== null}
      title={file?.name ?? t("materials.attachments.previewTitle")}
      onCancel={onClose}
      footer={null}
      width={880}
      destroyOnHidden
    >
      {isImage && file ? (
        <div className="material-preview-image">
          <Image
            src={file.data_url}
            alt={file.name}
            style={{ maxHeight: IMAGE_MAX_HEIGHT, objectFit: "contain" }}
          />
        </div>
      ) : text ? (
        <>
          <Alert
            type="info"
            showIcon
            title={t("materials.attachments.previewTextNote")}
            style={{ marginBottom: 12 }}
          />
          <Typography.Paragraph className="material-preview-text">{text}</Typography.Paragraph>
        </>
      ) : (
        <Alert type="warning" showIcon title={t("materials.attachments.previewEmpty")} />
      )}
      {file ? (
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 12 }}>
          <FileTextOutlined /> {file.mime_type || "-"}
        </Typography.Text>
      ) : null}
    </Modal>
  );
}

export default AttachmentPreviewModal;
