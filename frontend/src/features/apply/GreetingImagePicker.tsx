// SPDX-License-Identifier: Apache-2.0
/**
 * 招呼语配图选择器（CR-18）：队列行与设置页共用同一份"选图 / 上传 / 删除"。
 *
 * 为什么抽出来：两处原先各写一个 `Select`，上传入口一加就得写两遍；而"哪些图能删"
 * 必须由后端 `deletable` 决定（全局默认 / 队列行 / 投递审计任一引用即不可删），
 * 前端重算必然与后端漂移。
 *
 * 上传成功后**自动选中**（新图就是用户刚放进去的那张，再让他回下拉里找一遍是多余的）；
 * 删除只对 `deletable` 的图给入口，仍被引用的那张显示"使用中"而不是禁用按钮——
 * 禁用按钮不解释原因，用户只会反复点。
 */
import { DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import { App, Button, Select, Space, Typography, Upload } from "antd";
import { useState } from "react";
import { deleteGreetingImage, uploadGreetingImage } from "../../api/applyExtras";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ApplyGreetingImageOption } from "../../types";
import { formatBytes } from "../../utils/format";

export interface GreetingImagePickerProps {
  mode: "single" | "multiple";
  /** 直接使用时传值；放在 `Form.Item` 里时由表单项注入（因此可省略）。 */
  value?: number | number[] | null;
  onChange?: (next: number | number[] | null) => void;
  options: ApplyGreetingImageOption[];
  maxCount?: number;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel: string;
}

export default function GreetingImagePicker({
  mode,
  value,
  onChange,
  options,
  maxCount = 4,
  disabled,
  placeholder,
  ariaLabel,
}: GreetingImagePickerProps) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块停在旧文案。
  useLocale();
  const { message } = App.useApp();
  const [uploading, setUploading] = useState(false);
  const [items, setItems] = useState<ApplyGreetingImageOption[]>(options);
  // 渲染期镜像同步（与 ApplyGreetingImageSection 同一模式）：父组件每次渲染都新建数组，
  // 按 id + deletable 的签名判断"真的变了"再灌一次，避免 setState → 重渲染的死循环。
  const signature = options.map((item) => `${item.id}:${item.deletable ? 1 : 0}`).join(",");
  const [sourceSignature, setSourceSignature] = useState(signature);
  if (signature !== sourceSignature) {
    setSourceSignature(signature);
    setItems(options);
  }

  const selectedIds: number[] =
    mode === "single"
      ? typeof value === "number"
        ? [value]
        : []
      : Array.isArray(value)
        ? value
        : [];

  const commit = (next: number[]) => {
    onChange?.(mode === "single" ? (next[0] ?? null) : next);
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const uploaded = await uploadGreetingImage(file);
      setItems((previous) =>
        previous.some((item) => item.id === uploaded.id) ? previous : [...previous, uploaded],
      );
      const next = selectedIds.includes(uploaded.id)
        ? selectedIds
        : [...selectedIds, uploaded.id].slice(0, maxCount);
      commit(next);
      message.success(t("applyQueue.image.uploaded"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("applyQueue.image.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (option: ApplyGreetingImageOption) => {
    try {
      await deleteGreetingImage(option.id);
      setItems((previous) => previous.filter((item) => item.id !== option.id));
      commit(selectedIds.filter((id) => id !== option.id));
      message.success(t("applyQueue.image.deleted"));
    } catch (error) {
      // 409 的文案由后端给（说清是哪一处还在引用），原样展示比"删除失败"更有用。
      message.error(error instanceof Error ? error.message : t("applyQueue.image.deleteFailed"));
    }
  };

  const selectOptions = items.map((item) => ({
    value: item.id,
    label: t("applyQueue.image.editorOption", {
      name: item.name,
      size: formatBytes(item.size_bytes),
    }),
  }));

  return (
    <Space orientation="vertical" size={8} style={{ width: "100%" }}>
      <Space.Compact style={{ width: "100%" }}>
        <Select<number | number[]>
          mode={mode === "multiple" ? "multiple" : undefined}
          allowClear
          maxCount={mode === "multiple" ? maxCount : undefined}
          value={mode === "single" ? (selectedIds[0] ?? undefined) : (selectedIds as number[])}
          onChange={(next) => commit(Array.isArray(next) ? next : next === undefined ? [] : [next])}
          options={selectOptions}
          disabled={disabled}
          style={{ flex: 1 }}
          aria-label={ariaLabel}
          placeholder={placeholder}
        />
        <Upload
          accept="image/png,image/jpeg,image/webp,image/gif"
          showUploadList={false}
          disabled={disabled || uploading}
          beforeUpload={(file) => {
            void handleUpload(file as File);
            return Upload.LIST_IGNORE;
          }}
        >
          <Button icon={<UploadOutlined />} loading={uploading} disabled={disabled}>
            {t("applyQueue.image.upload")}
          </Button>
        </Upload>
      </Space.Compact>
      {items.length > 0 && (
        // 候选清单：能删的给删除入口，仍被引用的写明"使用中"。
        // 高度限死并内部滚动，避免图片多时把队列编辑弹窗撑长。
        <div style={{ maxHeight: 160, overflowY: "auto", width: "100%" }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                {t("applyQueue.image.editorOption", {
                  name: item.name,
                  size: formatBytes(item.size_bytes),
                })}
              </Typography.Text>
              {item.deletable ? (
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  aria-label={t("applyQueue.image.deleteAria", { name: item.name })}
                  onClick={() => void handleDelete(item)}
                />
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t("applyQueue.image.inUse")}
                </Typography.Text>
              )}
            </div>
          ))}
        </div>
      )}
    </Space>
  );
}
