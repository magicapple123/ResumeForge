/** 简历编辑器的可重复分区容器。 */

import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Tooltip } from "antd";
import type { FormListFieldData } from "antd/es/form/FormList";
import { useRef } from "react";
import type { ReactNode } from "react";
import {
  PROFILE_FILL_KEYS,
  type ProfileFillItem,
  type ProfileFillSection,
} from "../../features/profile/profileFillOptions";
import ProfileFillBar from "./ProfileFillBar";
import { useProfileFill } from "./profileFillContext";

interface Props {
  title: string;
  name: string;
  emptyValue: Record<string, string | string[]>;
  children: (field: FormListFieldData) => ReactNode;
  /**
   * 对应「我的资料」里的哪个模块。给了才渲染「从我的资料填入」，
   * 且只在宿主提供了候选（`ProfileFillProvider`）时才会出现。
   */
  fillSection?: ProfileFillSection;
}

export default function ResumeListSection({
  title,
  name,
  emptyValue,
  children,
  fillSection,
}: Props) {
  const fill = useProfileFill();
  const form = Form.useFormInstance();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const current = Form.useWatch(name, form) as unknown[] | undefined;

  const keyOf = fillSection ? PROFILE_FILL_KEYS[fillSection] : null;
  const existingKeys = new Set<string>(
    keyOf ? (current ?? []).map((item) => keyOf(item)).filter(Boolean) : [],
  );
  const items: ProfileFillItem[] = (fillSection ? fill?.sources[fillSection] : undefined) ?? [];

  const appendItem = (item: ProfileFillItem) => {
    const list = (form.getFieldValue(name) as unknown[] | undefined) ?? [];
    // 只做加法：已有内容一条都不动，新条目追加在最后。
    form.setFieldValue(name, [...list, item.value]);
    fill?.onFilled();
    // 新条目渲染出来之后再聚焦它的第一个输入框——否则用户填完还得自己再滚下去找。
    window.requestAnimationFrame(() => {
      const entries = rootRef.current?.querySelectorAll<HTMLElement>("[data-resume-entry]");
      const last = entries?.[entries.length - 1];
      const firstField = last?.querySelector<HTMLElement>("input, textarea");
      firstField?.focus();
    });
  };

  return (
    <div ref={rootRef} data-resume-section={name}>
      {fill && fillSection && (
        <div style={{ marginBottom: 12 }}>
          <ProfileFillBar
            label={title}
            items={items}
            existingKeys={existingKeys}
            onFill={appendItem}
          />
        </div>
      )}
      <Form.List name={name}>
        {(fields, { add, remove }) => (
          <div>
            {fields.map((field, index) => (
              <div
                key={field.key}
                data-resume-entry={index}
                style={{
                  position: "relative",
                  marginBottom: 12,
                  padding: "16px 42px 4px 16px",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  background: "#fafafa",
                }}
              >
                <div style={{ marginBottom: 10, fontWeight: 600 }}>
                  {title} {index + 1}
                </div>
                <Tooltip title={`删除这一条${title}`}>
                  <Button
                    aria-label={`删除${title}`}
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    style={{ position: "absolute", top: 10, right: 8 }}
                    onClick={() => remove(field.name)}
                  />
                </Tooltip>
                {children(field)}
              </div>
            ))}
            <Button
              type="dashed"
              block
              icon={<PlusOutlined />}
              onClick={() => add({ ...emptyValue })}
            >
              添加{title}
            </Button>
          </div>
        )}
      </Form.List>
    </div>
  );
}
