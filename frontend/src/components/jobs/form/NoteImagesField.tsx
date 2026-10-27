// SPDX-License-Identifier: Apache-2.0
/** 岗位表单的备注图片区块：添加截图（转 dataUrl）与缩略图移除。
 *
 * 纯展示——图片的读取/上限校验（addNoteImage）留在 JobFormModal，经回调回传。
 */
import { DeleteOutlined, PictureOutlined } from "@ant-design/icons";
import { Button, Form, Image, Space, Typography, Upload } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

/** 与后端 MAX_JOB_NOTE_IMAGES 一致（服务端仍是权威校验）。 */
export const MAX_NOTE_IMAGES = 2;

interface Props {
  noteImages: string[];
  onAddImage: (file: File) => void;
  onRemove: (index: number) => void;
}

export default function NoteImagesField({ noteImages, onAddImage, onRemove }: Props) {
  useLocale();
  return (
    <Form.Item label={t("jobsForm.noteImages.label", { count: MAX_NOTE_IMAGES })}>
      <Space orientation="vertical" style={{ width: "100%" }}>
        <Space wrap>
          <Upload
            accept="image/jpeg,image/png,image/webp"
            showUploadList={false}
            beforeUpload={(file) => {
              onAddImage(file as File);
              return Upload.LIST_IGNORE;
            }}
          >
            <Button icon={<PictureOutlined />}>{t("jobsForm.noteImages.add")}</Button>
          </Upload>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("jobsForm.noteImages.hint")}
          </Typography.Text>
        </Space>
        {noteImages.length > 0 && (
          <Space wrap>
            {noteImages.map((source, index) => (
              <div key={`${index}-${source.slice(-16)}`} className="job-note-image-item">
                <Image
                  src={source}
                  alt={t("jobsForm.noteImages.imageAlt", { index: index + 1 })}
                  width={96}
                />
                <Button
                  type="text"
                  size="small"
                  danger
                  aria-label={t("jobsForm.noteImages.remove", { index: index + 1 })}
                  icon={<DeleteOutlined />}
                  onClick={() => onRemove(index)}
                />
              </div>
            ))}
          </Space>
        )}
      </Space>
    </Form.Item>
  );
}
