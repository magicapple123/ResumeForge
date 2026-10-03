/** 可视化模板调节器：只写入后端白名单配置，不让用户必须编辑 CSS。 */
import { DeleteOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  ColorPicker,
  Input,
  InputNumber,
  Select,
  Space,
  Typography,
  Upload,
} from "antd";
import type { UploadProps } from "antd";
import { useMemo } from "react";
import type { ResumeStyleField } from "../../types";

interface BadgeValue {
  image: string;
  label: string;
  alt: string;
}

interface Props {
  fields: ResumeStyleField[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

export default function TemplateStyleControls({ fields, values, onChange }: Props) {
  const { message } = App.useApp();
  const badges = useMemo(
    () => (Array.isArray(values.badges) ? (values.badges as BadgeValue[]) : []),
    [values.badges],
  );
  const setValue = (key: string, value: unknown) => onChange({ ...values, [key]: value });
  const setBadge = (index: number, patch: Partial<BadgeValue>) => {
    const next = badges.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item,
    );
    setValue("badges", next);
  };
  const removeBadge = (index: number) =>
    setValue(
      "badges",
      badges.filter((_, i) => i !== index),
    );
  const addBadge = () => setValue("badges", [...badges, { image: "", label: "", alt: "模板装饰" }]);

  const uploadProps = (index: number): UploadProps => ({
    accept: ".png,.jpg,.jpeg,.webp",
    showUploadList: false,
    beforeUpload: async (file) => {
      if (file.size > 300 * 1024) {
        message.error("自定义标签图片不能超过 300 KB，请先缩小或压缩图片");
        return false;
      }
      try {
        const image = await readAsDataUrl(file as File);
        setBadge(index, { image });
      } catch {
        // 预览编辑器不应因为一张装饰图片读取失败而打断其它字段。
      }
      return false;
    },
  });

  return (
    <div className="template-style-controls">
      <div className="template-style-control-grid">
        {fields.map((field) => {
          const value = values[field.key];
          return (
            <div key={field.key} className="template-style-control-item">
              <Typography.Text strong>{field.label}</Typography.Text>
              {field.type === "color" ? (
                <Space>
                  <ColorPicker
                    aria-label={field.label}
                    value={isHexColor(value) ? value : undefined}
                    onChange={(_, hex) => setValue(field.key, hex)}
                  />
                  <Input
                    aria-label={field.label + "十六进制"}
                    size="small"
                    value={typeof value === "string" ? value : ""}
                    placeholder="#16365c"
                    onChange={(event) => setValue(field.key, event.target.value)}
                    style={{ width: 112 }}
                  />
                </Space>
              ) : field.type === "select" ? (
                <Select
                  aria-label={field.label}
                  size="small"
                  value={typeof value === "string" ? value : undefined}
                  placeholder="沿用模板"
                  allowClear
                  options={field.options}
                  onChange={(next) => setValue(field.key, next ?? null)}
                />
              ) : (
                <InputNumber
                  aria-label={field.label}
                  size="small"
                  value={typeof value === "number" ? value : null}
                  min={field.min}
                  max={field.max}
                  step={field.step ?? 0.1}
                  placeholder="沿用模板"
                  onChange={(next) => setValue(field.key, next ?? null)}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="template-badge-editor">
        <Space align="center" style={{ marginBottom: 8 }}>
          <Typography.Text strong>自定义标签 / 图片</Typography.Text>
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={addBadge}
            disabled={badges.length >= 8}
          >
            添加
          </Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 0, fontSize: 12 }}>
          可添加个人品牌、证书、语言或作品标签；图片需为 ≤300 KB 的 PNG / JPG /
          WEBP，内嵌到模板，不会请求外部地址。
        </Typography.Paragraph>
        {badges.map((badge, index) => (
          <div className="template-badge-editor-row" key={String(index) + "-" + badge.alt}>
            {badge.image ? (
              <img src={badge.image} alt={badge.alt} className="template-badge-editor-image" />
            ) : (
              <Upload {...uploadProps(index)}>
                <Button size="small" icon={<UploadOutlined />}>
                  上传图片
                </Button>
              </Upload>
            )}
            <Input
              size="small"
              value={badge.label}
              placeholder="标签文字（可留空）"
              onChange={(event) => setBadge(index, { label: event.target.value })}
            />
            <Button
              size="small"
              danger
              type="text"
              icon={<DeleteOutlined />}
              aria-label={"删除第 " + (index + 1) + " 个自定义标签"}
              onClick={() => removeBadge(index)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
