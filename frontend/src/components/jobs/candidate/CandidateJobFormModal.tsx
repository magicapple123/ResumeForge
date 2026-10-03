/**
 * 备选岗位表单弹窗：受控组件——formState 所有权留在抽屉，经 props 双向联动。
 * （自 CandidateJobsDrawer 拆出：:543-642 整块 + FileDropZone/Upload/截图预览逐字随迁；
 * 拒绝回调经 onRejected prop 由抽屉传入（不新增 App.useApp() 调用点）。）
 */
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Image, Input, Modal, Space, Typography, Upload } from "antd";
import FileDropZone from "../../common/FileDropZone";
import type { CandidateJob } from "../../../types";
import type { FormState } from "./candidateShared";
import { MAX_CANDIDATE_IMAGES } from "./candidateShared";

export function CandidateJobFormModal({
  open,
  editing,
  submitting,
  formState,
  onChange,
  onAddImages,
  onSubmit,
  onCancel,
  onRejected,
}: {
  open: boolean;
  editing: CandidateJob | null;
  submitting: boolean;
  formState: FormState;
  onChange: (updater: (current: FormState) => FormState) => void;
  onAddImages: (file: File) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onRejected: () => void;
}) {
  return (
    <Modal
      title={editing ? "编辑备选岗位" : "添加备选岗位"}
      open={open}
      width={720}
      confirmLoading={submitting}
      onCancel={() => {
        if (!submitting) onCancel();
      }}
      onOk={() => void onSubmit()}
    >
      <Form layout="vertical">
        <Form.Item label="招聘信息来源">
          <Typography.Text type="secondary">
            由系统按你添加的内容自动标注（{formState.images.length > 0 ? "招聘截图" : "粘贴文本"}
            ）
          </Typography.Text>
        </Form.Item>
        <Form.Item label="岗位名称（可留空，导入时再补）">
          <Input
            value={formState.title}
            maxLength={128}
            placeholder="如：市场营销专员"
            onChange={(event) => onChange((c) => ({ ...c, title: event.target.value }))}
          />
        </Form.Item>
        <Form.Item label="公司名称">
          <Input
            value={formState.company}
            maxLength={128}
            placeholder="如：字节跳动"
            onChange={(event) => onChange((c) => ({ ...c, company: event.target.value }))}
          />
        </Form.Item>
        <Form.Item label="招聘原文">
          <Input.TextArea
            value={formState.rawText}
            autoSize={{ minRows: 6, maxRows: 14 }}
            placeholder="把招聘信息原样粘贴进来，导入时会用它预填 JD"
            onChange={(event) => onChange((c) => ({ ...c, rawText: event.target.value }))}
          />
        </Form.Item>
        <Form.Item label={`招聘截图（最多 ${MAX_CANDIDATE_IMAGES} 张，单张不超过 2 MB）`}>
          <Space orientation="vertical" style={{ width: "100%" }}>
            <FileDropZone
              accept="image/jpeg,image/png,image/webp"
              disabled={formState.images.length >= MAX_CANDIDATE_IMAGES}
              hint="松开即可添加招聘截图"
              onFiles={(dropped) => dropped.forEach((file) => void onAddImages(file))}
              onRejected={onRejected}
            >
              <Space wrap>
                <Upload
                  accept="image/jpeg,image/png,image/webp"
                  showUploadList={false}
                  beforeUpload={(file) => {
                    void onAddImages(file as File);
                    return Upload.LIST_IGNORE;
                  }}
                >
                  <Button icon={<PlusOutlined />}>添加截图</Button>
                </Upload>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  也可以直接拖进来
                </Typography.Text>
              </Space>
            </FileDropZone>
            {formState.images.length > 0 && (
              <Space wrap>
                {formState.images.map((source, index) => (
                  <div key={`${index}-${source.slice(-16)}`} className="job-note-image-item">
                    <Image src={source} alt={`招聘截图 ${index + 1}`} width={96} />
                    <Button
                      type="text"
                      size="small"
                      danger
                      aria-label={`移除截图 ${index + 1}`}
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        onChange((c) => ({
                          ...c,
                          images: c.images.filter((_, i) => i !== index),
                        }))
                      }
                    />
                  </div>
                ))}
              </Space>
            )}
          </Space>
        </Form.Item>
        <Form.Item label="备注" style={{ marginBottom: 0 }}>
          <Input.TextArea
            value={formState.note}
            autoSize={{ minRows: 2, maxRows: 4 }}
            placeholder="为什么先留着它、准备什么时候投（选填）"
            onChange={(event) => onChange((c) => ({ ...c, note: event.target.value }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
