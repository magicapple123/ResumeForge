// SPDX-License-Identifier: Apache-2.0
/** 简历编辑器的可重复分区容器。 */

import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Tooltip } from "antd";
import type { FormListFieldData } from "antd";
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

/**
 * 「这个字段算不算空」——`fillEntry` 只往空字段里写。
 *
 * 表单里"空"有三种写法：字段根本不存在（新加的空条目里，没被填过的键就是 `undefined`）、
 * 空串、空数组（多行文本/技术栈）。三者都要认，否则"我明明没写学校，为什么填不进去"。
 */
function isBlankValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
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
  // 每条自己的键：顶部追加用它算"已加入"，条目旁用它算"当前条目/已在其他条目"。
  const entryKeys: (string | undefined)[] = keyOf ? (current ?? []).map((item) => keyOf(item)) : [];
  const existingKeys = new Set<string>(entryKeys.filter((key): key is string => Boolean(key)));
  const items: ProfileFillItem[] = (fillSection ? fill?.sources[fillSection] : undefined) ?? [];

  /**
   * 聚焦第 index 条的第一个输入框（新条目追加、字段填入之后都用它）。
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

  const appendItem = (item: ProfileFillItem) => {
    const list = (form.getFieldValue(name) as unknown[] | undefined) ?? [];
    // 只做加法：已有内容一条都不动，新条目追加在最后。
    form.setFieldValue(name, [...list, item.value]);
    fill?.onFilled();
    // 新条目渲染出来之后再聚焦它的第一个输入框——否则用户填完还得自己再滚下去找。
    focusEntry(list.length);
  };

  /**
   * 把资料里的一条**填进当前这一条**的空字段。
   *
   * 与 `appendItem` 的分工：那个是"整条加进来"，这个是"这一条我写了一半，剩下的带过来"。
   * 只填空字段是硬约束——用户手写过的东西一定比资料里那份更贴近目标岗位，覆盖它等于
   * 把他刚做的编辑删掉，而界面上不会提示。
   */
  const fillEntry = (index: number, item: ProfileFillItem) => {
    const list = (form.getFieldValue(name) as unknown[] | undefined) ?? [];
    const next: Record<string, unknown> = { ...((list[index] ?? {}) as Record<string, unknown>) };
    const source = (item.value ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(source)) {
      if (!isBlankValue(next[key]) || isBlankValue(value)) continue;
      // 数组要复制一份：直接把候选里的引用塞进表单，两次填写会共用同一个数组对象。
      next[key] = Array.isArray(value) ? [...value] : value;
    }
    // 整表写回（而不是 `[name, index]`）：Form.List 的数组本身必须是**新引用**，
    // 否则 `useWatch` 与列表渲染都不会认为它变了；其它条目原样带过去。
    form.setFieldValue(
      name,
      list.map((entry, position) => (position === index ? next : entry)),
    );
    fill?.onFilled();
    focusEntry(index);
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
                  {/* `entryFill !== false`：岗位详情里的「自行编写」关掉条目级入口，只留
                      模块顶部的「从我的资料追加一条」。缺省（不传）保持旧行为。 */}
                  {fill && fillSection && fill.entryFill !== false && (
                    <ProfileFillBar
                      variant="entry"
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
                      onFill={(item) => fillEntry(index, item)}
                    />
                  )}
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
