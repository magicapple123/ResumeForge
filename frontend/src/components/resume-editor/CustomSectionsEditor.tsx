// SPDX-License-Identifier: Apache-2.0
/**
 * 自建大字段的编辑块（C2/R-79）：**独立栏目**，不塞进 summary 或任何系统分区。
 *
 * 数据形状与后端 `ResumeCustomSection` 一致：一个栏目 = 标题 + 若干条目，条目 = 主文本 +
 * 若干「标签：值」行。标签行由服务端投影生成，这里只做**编辑/往返**，不重新拼标签。
 * `key` / `entry_id` 用隐藏字段保留：一次保存不能把稳定身份抹掉（旧内容指纹/纸面定位用）。
 */
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input, Space, Tooltip } from "antd";
import { t } from "../../i18n";

const EMPTY_LINE = { label: "", value: "" };

export default function CustomSectionsEditor() {
  return (
    <Form.List name="custom_sections">
      {(sections, sectionOps) => (
        <div style={{ display: "grid", gap: 16 }}>
          {sections.map((section) => (
            <div
              key={section.key}
              style={{
                border: "1px solid var(--rf-border-subtle)",
                borderRadius: 8,
                padding: "12px 16px",
                background: "var(--rf-surface-alt)",
              }}
            >
              <Form.Item name={[section.name, "key"]} hidden>
                <Input />
              </Form.Item>
              <Space style={{ display: "flex", marginBottom: 8 }} wrap>
                <Form.Item
                  name={[section.name, "title"]}
                  label={t("editor.tab.custom-sections")}
                  rules={[{ required: true }]}
                  style={{ marginBottom: 0, minWidth: 260 }}
                >
                  <Input maxLength={40} />
                </Form.Item>
                <Tooltip title={t("editor.custom-sections.remove-section")}>
                  <Button
                    type="text"
                    danger
                    aria-label={t("editor.custom-sections.remove-section")}
                    icon={<DeleteOutlined />}
                    onClick={() => sectionOps.remove(section.name)}
                  />
                </Tooltip>
              </Space>
              <Form.List name={[section.name, "entries"]}>
                {(entries, entryOps) => (
                  <div style={{ display: "grid", gap: 12 }}>
                    {entries.map((entry) => (
                      <div
                        key={entry.key}
                        style={{
                          border: "1px dashed var(--rf-border-subtle)",
                          borderRadius: 6,
                          padding: "10px 12px",
                        }}
                      >
                        <Form.Item name={[entry.name, "entry_id"]} hidden>
                          <Input />
                        </Form.Item>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginBottom: 6,
                          }}
                        >
                          <Form.Item
                            name={[entry.name, "text"]}
                            label={t("editor.custom-sections.text")}
                            style={{ flex: 1, marginBottom: 0 }}
                          >
                            <Input.TextArea rows={3} maxLength={4000} />
                          </Form.Item>
                          <Tooltip title={t("editor.custom-sections.remove-entry")}>
                            <Button
                              type="text"
                              danger
                              aria-label={t("editor.custom-sections.remove-entry")}
                              icon={<DeleteOutlined />}
                              onClick={() => entryOps.remove(entry.name)}
                            />
                          </Tooltip>
                        </div>
                        <Form.List name={[entry.name, "lines"]}>
                          {(lines, lineOps) => (
                            <div style={{ display: "grid", gap: 6 }}>
                              {lines.map((line) => (
                                <Space key={line.key} align="start" wrap>
                                  <Form.Item
                                    name={[line.name, "label"]}
                                    label={t("editor.custom-sections.label")}
                                    rules={[{ required: true }]}
                                    style={{ marginBottom: 0 }}
                                  >
                                    <Input maxLength={64} />
                                  </Form.Item>
                                  <Form.Item
                                    name={[line.name, "value"]}
                                    label={t("editor.custom-sections.value")}
                                    style={{ marginBottom: 0, minWidth: 260 }}
                                  >
                                    <Input maxLength={2000} />
                                  </Form.Item>
                                  <Tooltip title={t("editor.custom-sections.remove-line")}>
                                    <Button
                                      type="text"
                                      danger
                                      aria-label={t("editor.custom-sections.remove-line")}
                                      icon={<DeleteOutlined />}
                                      onClick={() => lineOps.remove(line.name)}
                                    />
                                  </Tooltip>
                                </Space>
                              ))}
                              <Button
                                size="small"
                                type="dashed"
                                icon={<PlusOutlined />}
                                onClick={() => lineOps.add({ ...EMPTY_LINE })}
                              >
                                {t("editor.custom-sections.add-line")}
                              </Button>
                            </div>
                          )}
                        </Form.List>
                      </div>
                    ))}
                    <Button
                      type="dashed"
                      icon={<PlusOutlined />}
                      onClick={() => entryOps.add({ entry_id: "", text: "", lines: [] })}
                    >
                      {t("editor.custom-sections.add-entry")}
                    </Button>
                  </div>
                )}
              </Form.List>
            </div>
          ))}
        </div>
      )}
    </Form.List>
  );
}
