/** 岗位表单的备注图片区块：添加截图（转 dataUrl）与缩略图移除。
 *
 * 纯展示——图片的读取/上限校验（addNoteImage）留在 JobFormModal，经回调回传。
 */
import { DeleteOutlined, PictureOutlined } from "@ant-design/icons";
import { Button, Form, Image, Space, Typography, Upload } from "antd";

/** 与后端 MAX_JOB_NOTE_IMAGES 一致（服务端仍是权威校验）。 */
export const MAX_NOTE_IMAGES = 2;

interface Props {
  noteImages: string[];
  onAddImage: (file: File) => void;
  onRemove: (index: number) => void;
}

export default function NoteImagesField({ noteImages, onAddImage, onRemove }: Props) {
  return (
    <Form.Item label={`备注图片（选填，最多 ${MAX_NOTE_IMAGES} 张）`}>
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
            <Button icon={<PictureOutlined />}>添加图片</Button>
          </Upload>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            招聘截图、内推码等，每张不超过 2 MB
          </Typography.Text>
        </Space>
        {noteImages.length > 0 && (
          <Space wrap>
            {noteImages.map((source, index) => (
              <div key={`${index}-${source.slice(-16)}`} className="job-note-image-item">
                <Image src={source} alt={`备注图片 ${index + 1}`} width={96} />
                <Button
                  type="text"
                  size="small"
                  danger
                  aria-label={`移除备注图片 ${index + 1}`}
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
