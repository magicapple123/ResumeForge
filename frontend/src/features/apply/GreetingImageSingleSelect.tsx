// SPDX-License-Identifier: Apache-2.0
/**
 * 配图单选（「投递设置 → 附带图片」的默认图）：一个下拉 + 一份可删的库清单。
 *
 * 这里的清单**故意**保留删除入口——设置页就是图片库的管理位置，删库是这里的正当动作。
 * 队列编辑里那套"缩略图 + 折叠库"（`GreetingImageMultiSelect`）不出现删除按钮，边界在
 * 「配图 ≠ 图库管理」：两处的语义不同，所以是两个组件，不是一个组件加一堆 `mode` 分支。
 *
 * 可删性仍由后端 `deletable` 决定（全局默认 / 队列行 / 投递审计任一引用即不可删）：
 * 前端重算引用关系必然与后端漂移，而漂移的表现是"界面给了按钮、后端回 409"。
 */
import { DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import { App, Button, Select, Space, Typography, Upload } from "antd";
import { useRef, useState } from "react";
import { deleteGreetingImage } from "../../api/applyExtras";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ApplyGreetingImageOption } from "../../types";
import { formatBytes } from "../../utils/format";
import { greetingImageSignature } from "./greetingImageSelection";
import { useGreetingImagePaste, useGreetingImageUpload } from "./useGreetingImageUpload";
import "./greetingImages.css";

export interface GreetingImageSingleSelectProps {
  /** 由 `Form.Item` 注入；也允许直接当受控组件用。 */
  value?: number | null;
  onChange?: (next: number | null) => void;
  options: ApplyGreetingImageOption[];
  /** 后端下发的单张体积上限（`max_image_bytes`）；缺省时用同源镜像常量。 */
  maxImageBytes?: number;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel: string;
}

export default function GreetingImageSingleSelect({
  value,
  onChange,
  options,
  maxImageBytes,
  disabled,
  placeholder,
  ariaLabel,
}: GreetingImageSingleSelectProps) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块停在旧文案。
  useLocale();
  const { message } = App.useApp();
  const [items, setItems] = useState(options);
  // 同一批多个文件串行上传：提示顺序与选择顺序一致，也不会并发挤后端。
  const uploadChain = useRef<Promise<void>>(Promise.resolve());

  // 渲染期镜像同步：父组件每次渲染都新建数组，按签名判断"真的变了"再灌一次，
  // 避免 setState → 重渲染的死循环（上传/删除后的本地副本要留住）。
  const signature = greetingImageSignature(options);
  const [sourceSignature, setSourceSignature] = useState(signature);
  if (signature !== sourceSignature) {
    setSourceSignature(signature);
    setItems(options);
  }

  const selectedId = typeof value === "number" ? value : null;

  const { uploading, uploadMany } = useGreetingImageUpload((option) => {
    setItems((previous) =>
      previous.some((item) => item.id === option.id) ? previous : [...previous, option],
    );
    // 单选模式：上传成功直接选它——用户刚放进去的那张就是要用的那张。
    onChange?.(option.id);
  }, maxImageBytes);

  const enqueue = (files: File[]): void => {
    uploadChain.current = uploadChain.current
      .then(async () => {
        await uploadMany(files);
      })
      .then(() => undefined);
  };

  // 设置页也能直接粘贴截图：与「选择文件」同一个入口、同一份校验。
  useGreetingImagePaste((files) => enqueue(files), !disabled);

  const handleDelete = async (option: ApplyGreetingImageOption) => {
    try {
      await deleteGreetingImage(option.id);
      setItems((previous) => previous.filter((item) => item.id !== option.id));
      if (selectedId === option.id) onChange?.(null);
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
        <Select<number>
          allowClear
          value={selectedId ?? undefined}
          onChange={(next) => onChange?.(next ?? null)}
          options={selectOptions}
          disabled={disabled}
          style={{ flex: 1 }}
          aria-label={ariaLabel}
          placeholder={placeholder}
        />
        <Upload
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          showUploadList={false}
          disabled={disabled || uploading}
          beforeUpload={(file) => {
            enqueue([file as File]);
            return Upload.LIST_IGNORE;
          }}
        >
          <Button icon={<UploadOutlined />} loading={uploading} disabled={disabled}>
            {t("applyQueue.image.upload")}
          </Button>
        </Upload>
      </Space.Compact>
      <Typography.Text type="secondary" className="rf-greeting-image-paste-hint">
        {t("applyQueue.image.pasteHint")}
      </Typography.Text>
      {items.length > 0 && (
        // 库清单：能删的给删除入口，仍被引用的写明「使用中」而不是禁用按钮——
        // 禁用按钮不解释原因，用户只会反复点。
        <div className="rf-greeting-image-manage">
          {items.map((item) => (
            <div className="rf-greeting-image-manage-row" key={item.id}>
              <Typography.Text type="secondary" className="rf-greeting-image-manage-name" ellipsis>
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
                <Typography.Text type="secondary" className="rf-greeting-image-manage-inuse">
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
