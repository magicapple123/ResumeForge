// SPDX-License-Identifier: Apache-2.0
/**
 * 资料箱详情里的附件列表：每一行都**可点开预览**（图片看大图，文档看提取出的全文）。
 *
 * 自 `MaterialsPage` 拆出（原始需求：附件此前只是个不可点的缩略图/回形针图标，用户
 * 点不开任何附件；另外该页已贴 500 行预算，拆出来才有地方放预览逻辑）。
 *
 * 可访问性用原生 `<button type="button">`：回车/空格天然可用，不需要手写 keydown，
 * 也不会像 `role="button"` + div 那样漏掉焦点环。
 */
import { EyeOutlined, PaperClipOutlined } from "@ant-design/icons";
import { Typography } from "antd";
import type { MaterialFile } from "../../types";
import { canPreviewImage } from "../../utils/attachments";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export function AttachmentList({
  files,
  onPreview,
}: {
  files: MaterialFile[];
  /** 点击某一行时把该附件交给父组件（由父组件打开预览弹层）。 */
  onPreview: (file: MaterialFile) => void;
}) {
  useLocale();
  return (
    <div className="material-file-list">
      {files.map((file, index) => {
        const isImage = Boolean(file.data_url) && canPreviewImage(file.mime_type);
        return (
          <button
            key={`${file.name}-${index}`}
            type="button"
            className="material-file-item material-file-item--clickable"
            onClick={() => onPreview(file)}
            aria-label={t("materials.attachments.previewAction")}
          >
            {isImage ? (
              <img className="material-file-thumb" src={file.data_url} alt={file.name} />
            ) : (
              <PaperClipOutlined className="material-file-icon" />
            )}
            <div className="material-file-meta">
              <Typography.Text ellipsis={{ tooltip: file.name }}>{file.name}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {file.data_url
                  ? t("materials.file.image", { size: Math.round(file.size_bytes / 1024) })
                  : t("materials.file.text", { count: file.text.length })}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                <EyeOutlined /> {t("materials.attachments.previewAction")}
              </Typography.Text>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default AttachmentList;
