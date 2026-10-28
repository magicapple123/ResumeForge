// SPDX-License-Identifier: Apache-2.0
/** 简历编辑器的可重复分区容器。 */

import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Tooltip } from "antd";
import type { FormListFieldData } from "antd";
import { memo, useRef } from "react";
import type { ReactNode } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ProfileFillSection } from "../../features/profile/profileFillOptions";
import AppendedCarrierFields from "./AppendedCarrierFields";
import ProfileFillBar from "./ProfileFillBar";
import { useProfileEntryFill } from "./profileEntryFill";

interface Props {
  title: string;
  name: string;
  emptyValue: Record<string, string | string[]>;
  children: (field: FormListFieldData) => ReactNode;
  /**
   * 对应「我的资料」里的哪个模块候选。给了才渲染条目级「从资料填入本条」，
   * 且只在宿主提供了候选（`ProfileFillProvider`）时才会出现。
   */
  fillSection?: ProfileFillSection;
}

/**
 * 一条目的**字段区**（需求 #12）：Form.List 在它管辖的数组每次变化时都会重跑渲染函数，
 * 而数组引用在"某一条的某个字段被改"时必然变——于是打字会把这个分区**所有**条目的所有
 * Form.Item 整天重渲染一遍（实测一条内容就是 18 个栅格列陪跑）。
 *
 * 字段区本身只依赖「第几条（field.name）」和宿主给的渲染函数（`children` 在分区组件
 * 不重渲染时引用稳定），所以用身份比较把它钉住：实际变化交给各 Form.Item 自己的订阅。
 * 注意不能拿 `field` 对象做浅比较——Form.List 每次渲染都会新建这个对象。
 */
const EntryFields = memo(
  function EntryFields({
    field,
    children,
  }: {
    field: FormListFieldData;
    children: (field: FormListFieldData) => ReactNode;
  }) {
    return <>{children(field)}</>;
  },
  (previous, next) =>
    previous.field.name === next.field.name &&
    previous.field.key === next.field.key &&
    previous.children === next.children,
);

export default function ResumeListSection({
  title,
  name,
  emptyValue,
  children,
  fillSection,
}: Props) {
  useLocale();
  const rootRef = useRef<HTMLDivElement | null>(null);
  // 任务 #9：每个条目都有「从资料填入本条」；板块级的「从我的资料追加一条」已下线。
  const { available, items, entryKeys, fillEntry } = useProfileEntryFill(name, fillSection);

  /**
   * 聚焦第 index 条的第一个输入框（字段填入之后用）。
   *
   * 跳过条目头部「从资料填入本条」的搜索框（`.resume-profile-fill` 里的 `input`）：
   * 它排在 DOM 最前面，但它是**工具条**——用户刚刚才用过它，把焦点交回去等于让他
   * 从下拉里重新选一遍；而且 antd 的 Select 聚焦即展开候选，会盖住刚填好的字段。
   */
  const focusEntry = (index: number) => {
    window.requestAnimationFrame(() => {
      const entries = rootRef.current?.querySelectorAll<HTMLElement>("[data-resume-entry]");
      const controls = Array.from(
        entries?.[index]?.querySelectorAll<HTMLElement>("input, textarea") ?? [],
      );
      controls.find((control) => !control.closest(".resume-profile-fill"))?.focus();
    });
  };

  const handleFillEntry = (index: number, item: Parameters<typeof fillEntry>[1]): void => {
    fillEntry(index, item);
    focusEntry(index);
  };

  return (
    <div ref={rootRef} data-resume-section={name}>
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
                  border: "1px solid var(--rf-border-subtle)",
                  borderRadius: 8,
                  background: "var(--rf-surface-alt)",
                }}
              >
                {/* 标题与条目级填入同一行：`minWidth: 0` + `marginRight: auto` 让长标题
                    不挤压下拉，窄屏时下拉换到下一行而不是把标题压成两三个字一行。 */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 8,
                    marginBottom: 10,
                    // 右上角是绝对定位的删除按钮，别让下拉钻到它下面。
                    paddingRight: 28,
                  }}
                >
                  <div style={{ fontWeight: 600, minWidth: 0, marginRight: "auto" }}>
                    {title} {index + 1}
                  </div>
                  {available && (
                    <ProfileFillBar
                      label={title}
                      items={items}
                      // 传"其它条目"用过的键：本条引用过的资料条目不必再选一次。
                      existingKeys={
                        new Set(
                          entryKeys.filter(
                            (key, position): key is string => position !== index && Boolean(key),
                          ),
                        )
                      }
                      currentKey={entryKeys[index]}
                      onFill={(item) => handleFillEntry(index, item)}
                    />
                  )}
                </div>
                <Tooltip title={t("editor.listSection.removeEntry", { label: title })}>
                  <Button
                    aria-label={t("editor.listSection.removeEntryAria", { label: title })}
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    style={{ position: "absolute", top: 10, right: 8 }}
                    onClick={() => remove(field.name)}
                  />
                </Tooltip>
                <EntryFields field={field} children={children} />
                {/* 需求 #5：方案里这个板块的自定义字段（无独立槽位）也在这里录入——
                    值直接写进承载区（description / achievements / level …）的「标签：值」行。 */}
                <AppendedCarrierFields sectionField={name} entryName={field.name} />
              </div>
            ))}
            <Button
              type="dashed"
              block
              icon={<PlusOutlined />}
              onClick={() => add({ ...emptyValue })}
            >
              {t("editor.listSection.addEntry", { label: title })}
            </Button>
          </div>
        )}
      </Form.List>
    </div>
  );
}
