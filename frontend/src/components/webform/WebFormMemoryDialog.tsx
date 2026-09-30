/** 「记住这条」的资料目标选择器。 */
import { CheckCircleFilled, DownOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { App, Button, Card, Empty, Input, Modal, Radio, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { WebFormMemoryTarget, WebFormRememberPending } from "../../types";

export interface WebFormMemorySelection {
  target_id: string;
  value: string;
  label: string;
  reuse: "general";
}

interface Props {
  open: boolean;
  pending: WebFormRememberPending | null;
  targets: WebFormMemoryTarget[];
  loading: boolean;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (selection: WebFormMemorySelection) => void;
}

const GROUP_TONES = [
  { color: "#2e6da4", border: "#b8d4f2", background: "#f2f7ff" },
  { color: "#247a65", border: "#a9d9cb", background: "#effaf6" },
  { color: "#6344a2", border: "#c8b9ed", background: "#f7f3ff" },
  { color: "#a76720", border: "#f1c58e", background: "#fff8ed" },
  { color: "#a34d5c", border: "#e9b3bd", background: "#fff3f5" },
  { color: "#26728a", border: "#a9d3de", background: "#effaff" },
];

function groupTone(group: string) {
  let hash = 0;
  for (const char of group) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return GROUP_TONES[Math.abs(hash) % GROUP_TONES.length];
}

function fuzzyIncludes(text: string, keyword: string): boolean {
  const source = text.toLocaleLowerCase();
  const needle = keyword.toLocaleLowerCase();
  if (!needle) return true;
  if (source.includes(needle)) return true;
  let cursor = 0;
  for (const char of source) {
    if (char === needle[cursor]) {
      cursor += 1;
      if (cursor === needle.length) return true;
    }
  }
  return false;
}

// 「记住这条」的落点**只有「网申资料」**（见 services/webform/profile_targets.py）。
// 以前这里还会渲染「我的资料」，也就是按一下就能改简历资料——2026-09-28 收掉了，
// 所以不再需要按来源分支的标签。
const SOURCE_LABEL = "网申资料";

function inputKind(target: WebFormMemoryTarget | undefined): "text" | "textarea" {
  return target?.kind === "longtext" ? "textarea" : "text";
}

export default function WebFormMemoryDialog({
  open,
  pending,
  targets,
  loading,
  saving,
  onCancel,
  onSubmit,
}: Props) {
  const { message } = App.useApp();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("custom");
  const [customLabel, setCustomLabel] = useState("");
  const [value, setValue] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || !pending) return;
    const preferred = targets.find((target) => target.field_key === pending.field_key);
    setSearch("");
    setSelectedId(preferred?.target_id ?? "custom");
    setCustomLabel(preferred ? "" : pending.field_label || pending.control_label || "");
    setValue(pending.value);
    setCollapsedGroups(
      new Set(targets.map((target) => target.group).filter((group) => group !== "自定义")),
    );
  }, [open, pending, targets]);

  const selectedTarget = targets.find((target) => target.target_id === selectedId);
  const filteredTargets = useMemo(
    () =>
      targets.filter((target) =>
        fuzzyIncludes(
          [target.group, target.label, target.value, target.field_key].join(" "),
          search.trim(),
        ),
      ),
    [search, targets],
  );

  const groupedTargets = useMemo(() => {
    const groups = new Map<string, WebFormMemoryTarget[]>();
    for (const target of filteredTargets) {
      const items = groups.get(target.group) ?? [];
      items.push(target);
      groups.set(target.group, items);
    }
    return [...groups.entries()];
  }, [filteredTargets]);

  const canSubmit = Boolean(value.trim() && (selectedId !== "custom" || customLabel.trim()));
  const searching = Boolean(search.trim());

  const toggleGroup = (group: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const selectTarget = (target: WebFormMemoryTarget) => {
    setSelectedId(target.target_id);
    setCollapsedGroups((current) => {
      const next = new Set(current);
      next.delete(target.group);
      return next;
    });
  };

  const handleSubmit = () => {
    if (!canSubmit) {
      message.warning(selectedId === "custom" ? "请先填写自定义字段名称" : "请先填写要记住的值");
      return;
    }
    onSubmit({
      target_id: selectedId,
      value: value.trim(),
      label: selectedId === "custom" ? customLabel.trim() : (selectedTarget?.label ?? ""),
      reuse: "general",
    });
  };

  return (
    <Modal
      open={open}
      width={760}
      title="记住这条：选择要更新的资料"
      okText="保存到选中的资料"
      cancelText="暂不保存"
      confirmLoading={saving}
      okButtonProps={{ disabled: !canSubmit }}
      onCancel={onCancel}
      onOk={handleSubmit}
      destroyOnClose
    >
      {pending ? (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Card size="small" style={{ background: "#f5f8ff" }}>
            <Space direction="vertical" size={4}>
              <Typography.Text type="secondary">当前浏览器字段</Typography.Text>
              <Typography.Text strong>
                {pending.control_label || pending.field_label || "未命名字段"}
              </Typography.Text>
              <Typography.Text>本次要记住：{pending.value}</Typography.Text>
              <Typography.Text type="secondary">
                已有相同字段时，系统会优先帮你定位到对应目标；是否写入仍由你最后确认。
              </Typography.Text>
            </Space>
          </Card>

          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索字段、模块或当前值；支持模糊搜索"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <div style={{ maxHeight: 330, overflow: "auto", paddingRight: 4 }}>
            <Card
              size="small"
              hoverable
              style={{
                marginBottom: 12,
                borderColor: selectedId === "custom" ? "#1677ff" : undefined,
                background: selectedId === "custom" ? "#f5f8ff" : undefined,
              }}
              onClick={() => setSelectedId("custom")}
            >
              <Space align="start">
                <Radio checked={selectedId === "custom"} />
                <PlusOutlined style={{ color: "#1677ff", marginTop: 4 }} />
                <Space direction="vertical" size={2}>
                  <Space wrap size={6}>
                    <Typography.Text strong>新增一条网申自定义字段</Typography.Text>
                    <Tag color="blue">网申资料 · 自定义</Tag>
                  </Space>
                  <Typography.Text type="secondary">
                    网申资料里没有对应字段时使用；以后可在「我的资料 → 网申资料」里编辑。
                  </Typography.Text>
                </Space>
              </Space>
            </Card>

            {loading ? (
              <Typography.Text type="secondary">正在读取完整资料目录…</Typography.Text>
            ) : groupedTargets.length ? (
              groupedTargets.map(([group, items]) => {
                const expanded = searching || !collapsedGroups.has(group);
                const tone = groupTone(group);
                return (
                  <section key={group} style={{ marginBottom: 14 }}>
                    <Button
                      type="text"
                      block
                      aria-expanded={expanded}
                      aria-controls={`webform-memory-group-${group}`}
                      onClick={() => toggleGroup(group)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        justifyContent: "flex-start",
                        marginBottom: expanded ? 8 : 0,
                        padding: "7px 10px",
                        height: "auto",
                        border: `1px solid ${tone.border}`,
                        borderRadius: 8,
                        color: tone.color,
                        background: expanded ? tone.background : "#fff",
                        fontWeight: 700,
                      }}
                    >
                      <DownOutlined rotate={expanded ? 0 : -90} />
                      <span
                        style={{
                          minWidth: 0,
                          flex: 1,
                          textAlign: "left",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        网申资料 · {group}
                      </span>
                      <Tag
                        style={{
                          marginInlineEnd: 0,
                          color: tone.color,
                          borderColor: tone.border,
                          background: "#fff",
                        }}
                      >
                        {items.length} 条
                      </Tag>
                    </Button>
                    {expanded ? (
                      <Space
                        id={`webform-memory-group-${group}`}
                        direction="vertical"
                        size={8}
                        style={{ width: "100%" }}
                      >
                        {items.map((target) => {
                          const selected = target.target_id === selectedId;
                          return (
                            <Card
                              key={target.target_id}
                              size="small"
                              hoverable
                              style={{
                                borderColor: selected ? "#1677ff" : undefined,
                                background: selected ? "#f5f8ff" : undefined,
                              }}
                              onClick={() => selectTarget(target)}
                            >
                              <Space align="start" style={{ width: "100%" }}>
                                <Radio checked={selected} />
                                <Space
                                  direction="vertical"
                                  size={2}
                                  style={{ minWidth: 0, flex: 1 }}
                                >
                                  <Space wrap size={6}>
                                    <Typography.Text strong>{target.label}</Typography.Text>
                                    <Tag color="orange">{SOURCE_LABEL}</Tag>
                                    {selected ? (
                                      <CheckCircleFilled style={{ color: "#1677ff" }} />
                                    ) : null}
                                  </Space>
                                  <Typography.Text type="secondary" ellipsis>
                                    当前值：{target.value || "（尚未填写）"}
                                  </Typography.Text>
                                </Space>
                              </Space>
                            </Card>
                          );
                        })}
                      </Space>
                    ) : null}
                  </section>
                );
              })
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的已有资料" />
            )}
          </div>

          {selectedId === "custom" ? (
            <Input
              autoFocus
              addonBefore="字段名称"
              placeholder="如：实验室、导师姓名、家庭住址补充"
              value={customLabel}
              onChange={(event) => setCustomLabel(event.target.value)}
              maxLength={40}
            />
          ) : null}

          <Space direction="vertical" size={6} style={{ width: "100%" }}>
            <Typography.Text strong>要保存的值</Typography.Text>
            {inputKind(selectedTarget) === "textarea" ? (
              <Input.TextArea
                rows={3}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            ) : (
              <Input value={value} onChange={(event) => setValue(event.target.value)} />
            )}
          </Space>

          <Typography.Text type="secondary">
            保存后会按通用资料复用，下次遇到相同类型的网申字段时自动参与匹配。
          </Typography.Text>
        </Space>
      ) : null}
    </Modal>
  );
}
