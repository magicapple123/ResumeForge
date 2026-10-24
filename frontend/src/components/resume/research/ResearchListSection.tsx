// SPDX-License-Identifier: Apache-2.0
/**
 * 科研三栏共用的**可重复条目容器**（W14）：标题 + 计数 + 条目卡 + 上移/下移/删除 + 添加。
 *
 * ## 为什么不复用 `resume-editor/ResumeListSection`
 *
 * 那个容器是给"教育/经历"这类**只有平铺字段**的分区用的：它有「从我的资料填入」的耦合，
 * 而且没有排序能力。科研条目有两件它做不到的事：
 * 1. 条目内还有**嵌套列表**（论文的作者、专利的发明人），空值里带对象数组；
 * 2. 顺序本身就是语义（作者顺序 = 署名顺序），需要真实的上移/下移动作。
 * 视觉上刻意沿用同一套容器样式（同一组 CSS 变量、同样的卡片圆角与内边距），
 * 让"科研栏目"与既有分区看起来是一个编辑器。
 *
 * ## 与表单的关系
 *
 * 它只是 `Form.List` 的外壳：字段名就是 content 的键（`publications` 等），
 * 新增/删除/移动都由 antd 的 operations 完成，**不自己改数组**——两套写法会出现
 * "表单里有、界面没刷新"或者反过来的分叉。
 */
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { Button, Form, Space, Tooltip } from "antd";
import type { FormListFieldData } from "antd";
import type { ReactNode } from "react";
import EmptyState from "../../common/EmptyState";
import { rt } from "../../../features/resume-research/i18n";

interface Props<T extends object> {
  /** content 里的字段名：publications / research_projects / patents。 */
  name: string;
  /** 已本地化的板块名（论文发表 / 科研项目 / 专利），用于文案插值与 aria。 */
  label: string;
  /** 空列表时的说明（紧凑容器内，用 inline 空态）。 */
  emptyDescription: string;
  /** 添加按钮文案（"添加论文发表"这类具体动作）。 */
  addLabel: string;
  /** 新增一条的初始值（只含后端默认值，见 researchFields 的空工厂）。 */
  makeEmpty: () => T;
  /** 条目正文（受控于外层 Form.List 的 field）。 */
  children: (field: FormListFieldData) => ReactNode;
}

const CARD_STYLE = {
  position: "relative",
  marginBottom: 12,
  padding: "12px 16px 4px",
  border: "1px solid var(--rf-border-subtle)",
  borderRadius: 8,
  background: "var(--rf-surface-alt)",
} as const;

export default function ResearchListSection<T extends object>({
  name,
  label,
  emptyDescription,
  addLabel,
  makeEmpty,
  children,
}: Props<T>) {
  return (
    <div data-research-section={name}>
      <Form.List name={name}>
        {(fields, operations) => (
          <div>
            {/* 计数用 Form.List 自己的 fields.length：与列表渲染同源，不需要再订阅表单值。 */}
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 8,
                marginBottom: 10,
              }}
            >
              <span style={{ fontWeight: 600 }}>{label}</span>
              <span style={{ color: "var(--rf-text-secondary)", fontSize: 12 }}>
                {rt("research.section.count", { count: fields.length })}
              </span>
            </div>
            {fields.length === 0 ? (
              <div style={{ marginBottom: 12 }}>
                <EmptyState inline description={emptyDescription} />
              </div>
            ) : null}
            {fields.map((field, index) => (
              <div key={field.key} data-research-entry={index} style={CARD_STYLE}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <span style={{ fontWeight: 600, minWidth: 0, marginRight: "auto" }}>
                    {label} {index + 1}
                  </span>
                  <Space size={2}>
                    <Tooltip title={rt("research.list.moveUp")}>
                      <Button
                        type="text"
                        size="small"
                        icon={<ArrowUpOutlined />}
                        aria-label={rt("research.list.moveUpAria", { label, index: index + 1 })}
                        disabled={index === 0 || undefined}
                        onClick={() => operations.move(index, index - 1)}
                      />
                    </Tooltip>
                    <Tooltip title={rt("research.list.moveDown")}>
                      <Button
                        type="text"
                        size="small"
                        icon={<ArrowDownOutlined />}
                        aria-label={rt("research.list.moveDownAria", { label, index: index + 1 })}
                        disabled={index === fields.length - 1 || undefined}
                        onClick={() => operations.move(index, index + 1)}
                      />
                    </Tooltip>
                    <Tooltip title={rt("research.list.remove", { label })}>
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={rt("research.list.removeAria", { label, index: index + 1 })}
                        onClick={() => operations.remove(field.name)}
                      />
                    </Tooltip>
                  </Space>
                </div>
                {children(field)}
              </div>
            ))}
            <Button
              type="dashed"
              block
              icon={<PlusOutlined />}
              aria-label={addLabel}
              onClick={() => operations.add(makeEmpty())}
            >
              {addLabel}
            </Button>
          </div>
        )}
      </Form.List>
    </div>
  );
}
