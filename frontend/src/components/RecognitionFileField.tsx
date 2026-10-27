// SPDX-License-Identifier: Apache-2.0
/** 识别前的文件暂存区：图片显示缩略图（可点开预览），文档显示名称与体积。 */

import { DeleteOutlined, PictureOutlined } from "@ant-design/icons";
import { App, Button, Image, Tooltip, Typography, Upload } from "antd";
import type { StagedFile } from "../hooks/useRecognitionFiles";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import { MAX_ATTACHMENT_COUNT, RECOGNITION_ACCEPT } from "../utils/attachments";
import FileDropZone from "./common/FileDropZone";
import RecognitionFilePreview from "./RecognitionFilePreview";

interface Props {
  files: StagedFile[];
  reading: boolean;
  disabled?: boolean;
  onAddFiles: (files: File[]) => void;
  onRemove: (id: number) => void;
}

export default function RecognitionFileField({
  files,
  reading,
  disabled = false,
  onAddFiles,
  onRemove,
}: Props) {
  useLocale();
  const { message } = App.useApp();
  const full = files.length >= MAX_ATTACHMENT_COUNT;
  const busy = reading || disabled;

  return (
    <FileDropZone
      accept={RECOGNITION_ACCEPT}
      disabled={busy || full}
      hint={t("componentsMisc.recognitionField.dropHint")}
      onFiles={onAddFiles}
      onRejected={(count) =>
        message.warning(t("componentsMisc.recognitionField.ignoredUnsupported", { count }))
      }
    >
      <div className="recognition-files">
        <div className="recognition-files-actions">
          <Upload
            accept={RECOGNITION_ACCEPT}
            multiple
            showUploadList={false}
            disabled={busy || full}
            // 页面上有多个上传入口，这个 aria-label 让它们（以及测试）都能精确定位。
            aria-label={t("componentsMisc.recognitionField.add")}
            beforeUpload={(file) => {
              onAddFiles([file as File]);
              // 与仓库其它上传一致：本地读取后自行提交，不走 antd 的上传通道。
              return Upload.LIST_IGNORE;
            }}
          >
            <Button icon={<PictureOutlined />} loading={reading} disabled={busy || full}>
              {t("componentsMisc.recognitionField.add")}
            </Button>
          </Upload>
          <Typography.Text type="secondary">
            {t("componentsMisc.recognitionField.pasteHint", { count: MAX_ATTACHMENT_COUNT })}
          </Typography.Text>
        </div>

        {files.length > 0 && (
          // 同一个 PreviewGroup 包住整个列表：同一次暂存的多张图点开后可以左右切换/缩放，
          // 而不是各自弹一个只能看自己那一张的浮层。
          <Image.PreviewGroup>
            <div className="recognition-files-list">
              {files.map((file) => (
                <div key={file.id} className="recognition-file-item">
                  <RecognitionFilePreview file={file} />
                  {/* 动作区独立成块：D16 的整行布局靠它"绝不收缩"（体积/删除不会换行）。 */}
                  <span className="recognition-file-actions">
                    <Tooltip
                      title={t("componentsMisc.recognitionField.removeTooltip", {
                        name: file.name,
                      })}
                    >
                      <Button
                        type="text"
                        size="small"
                        danger
                        aria-label={t("componentsMisc.recognitionField.removeAria", {
                          name: file.name,
                        })}
                        icon={<DeleteOutlined />}
                        disabled={busy}
                        onClick={() => onRemove(file.id)}
                      />
                    </Tooltip>
                  </span>
                </div>
              ))}
            </div>
          </Image.PreviewGroup>
        )}
      </div>
    </FileDropZone>
  );
}
