// SPDX-License-Identifier: Apache-2.0
/** 识别前的文件暂存区：图片显示缩略图（可点开预览），文档显示名称与体积。 */

import { DeleteOutlined, PictureOutlined } from "@ant-design/icons";
import { App, Button, Image, Tooltip, Typography, Upload } from "antd";
import type { StagedFile } from "../hooks/useRecognitionFiles";
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
  const { message } = App.useApp();
  const full = files.length >= MAX_ATTACHMENT_COUNT;
  const busy = reading || disabled;

  return (
    <FileDropZone
      accept={RECOGNITION_ACCEPT}
      disabled={busy || full}
      hint="松开即可添加截图或文档"
      onFiles={onAddFiles}
      onRejected={(count) =>
        message.warning(`已忽略 ${count} 个不支持的文件（只接受截图与 pdf/docx）`)
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
            aria-label="添加截图或文档"
            beforeUpload={(file) => {
              onAddFiles([file as File]);
              // 与仓库其它上传一致：本地读取后自行提交，不走 antd 的上传通道。
              return Upload.LIST_IGNORE;
            }}
          >
            <Button icon={<PictureOutlined />} loading={reading} disabled={busy || full}>
              添加截图或文档
            </Button>
          </Upload>
          <Typography.Text type="secondary">
            也可以把文件直接拖到这里，或在文本框里按 Ctrl+V 粘贴截图（最多 {MAX_ATTACHMENT_COUNT}{" "}
            个，单个 ≤ 2 MB，合计 ≤ 5 MB；支持截图与 pdf/docx 文档）
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
                  <Tooltip title={`移除 ${file.name}`}>
                    <Button
                      type="text"
                      size="small"
                      danger
                      aria-label={`移除文件 ${file.name}`}
                      icon={<DeleteOutlined />}
                      disabled={busy}
                      onClick={() => onRemove(file.id)}
                    />
                  </Tooltip>
                </div>
              ))}
            </div>
          </Image.PreviewGroup>
        )}
      </div>
    </FileDropZone>
  );
}
