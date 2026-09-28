/** 「记住这条」的资料目标选择器。 */
import { CheckCircleFilled, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { App, Card, Empty, Input, Modal, Radio, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { WebFormMemoryReuse, WebFormMemoryTarget, WebFormRememberPending } from "../../types";

export interface WebFormMemorySelection {
  target_id: string;
  value: string;
  label: string;
  reuse: WebFormMemoryReuse;
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

const REUSE_OPTIONS: Array<{ value: WebFormMemoryReuse; label: string; hint: string }> = [
  { value: "general", label: "通用", hint: "换家公司也成立，下次优先自动使用" },
  { value: "scenario", label: "场景", hint: "只在相近投递场景使用，并保留来源提示" },
  { value: "once", label: "本次", hint: "只记在资料里，不在下次自动填" },
];

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
  const [reuse, setReuse] = useState<WebFormMemoryReuse>("general");

  useEffect(() => {
    if (!open || !pending) return;
    const preferred = targets.find((target) => target.field_key === pending.field_key);
    setSearch("");
    setSelectedId(preferred?.target_id ?? "custom");
    setCustomLabel(preferred ? "" : pending.field_label || pending.control_label || "");
    setValue(pending.value);
    setReuse("general");
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

  const selectedReuse = REUSE_OPTIONS.find((option) => option.value === reuse) ?? REUSE_OPTIONS[0];
  const canSubmit = Boolean(value.trim() && (selectedId !== "custom" || customLabel.trim()));

  const handleSubmit = () => {
    if (!canSubmit) {
      message.warning(selectedId === "custom" ? "请先填写自定义字段名称" : "请先填写要记住的值");
      return;
    }
    onSubmit({
      target_id: selectedId,
      value: value.trim(),
      label: selectedId === "custom" ? customLabel.trim() : (selectedTarget?.label ?? ""),
      reuse,
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
                  <Typography.Text strong>新增一条网申自定义字段</Typography.Text>
                  <Typography.Text type="secondary">
                    我的资料和网申资料里都没有对应字段时使用；以后可在「我的资料 →
                    网申资料」里编辑。
                  </Typography.Text>
                </Space>
              </Space>
            </Card>

            {loading ? (
              <Typography.Text type="secondary">正在读取完整资料目录…</Typography.Text>
            ) : groupedTargets.length ? (
              groupedTargets.map(([group, items]) => (
                <section key={group} style={{ marginBottom: 14 }}>
                  <Typography.Title level={5} style={{ margin: "0 0 8px" }}>
                    {group}
                  </Typography.Title>
                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
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
                          onClick={() => setSelectedId(target.target_id)}
                        >
                          <Space align="start" style={{ width: "100%" }}>
                            <Radio checked={selected} />
                            <Space direction="vertical" size={2} style={{ minWidth: 0, flex: 1 }}>
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
                </section>
              ))
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

          <Space direction="vertical" size={6} style={{ width: "100%" }}>
            <Typography.Text strong>下次怎么复用</Typography.Text>
            <Radio.Group value={reuse} onChange={(event) => setReuse(event.target.value)}>
              {REUSE_OPTIONS.map((option) => (
                <Radio.Button key={option.value} value={option.value}>
                  {option.label}
                </Radio.Button>
              ))}
            </Radio.Group>
            <Typography.Text type="secondary">{selectedReuse.hint}</Typography.Text>
          </Space>
        </Space>
      ) : null}
    </Modal>
  );
}
