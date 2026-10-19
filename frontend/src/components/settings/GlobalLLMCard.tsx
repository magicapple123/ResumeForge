/**
 * 全局模型配置（R21）：多套 profile，所有数据集共用其中"当前"的一套。
 *
 * 为什么需要它：一份数据集就是一个完整的 SQLite 文件，"用哪个模型"其实是跨数据集的
 * 偏好。用户在「秋招」和「社招」两份数据之间切换时，不该每换一次就重填一遍地址、
 * 模型和 API Key；多套 profile 让"日常/长文本/便宜模型"可以随时切换。
 *
 * 与下方「模型服务」的关系要一眼看清：那个管的是**当前数据集**的配置。这里的开关打开时
 * 会接管所有数据集，界面必须把这件事说白——否则用户在 A 数据集里改了下方的配置，
 * 却发现调用还是走全局，会以为保存失败。
 */
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import {
  activateGlobalLLMProfile,
  clearGlobalLLM,
  createGlobalLLMProfile,
  deleteGlobalLLMProfile,
  getGlobalLLM,
  saveGlobalLLM,
  updateGlobalLLMProfile,
  type GlobalLLMProfile,
  type GlobalLLMSummary,
} from "../../api/settings";

interface FormValues {
  name: string;
  base_url: string;
  model: string;
  api_key?: string;
  clear_key?: boolean;
}

type EditorState = { mode: "create" } | { mode: "edit"; profile: GlobalLLMProfile };

export default function GlobalLLMCard() {
  const { message, modal } = App.useApp();
  const [summary, setSummary] = useState<GlobalLLMSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form] = Form.useForm<FormValues>();

  useEffect(() => {
    let cancelled = false;
    getGlobalLLM()
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        // 读不到（老后端 / 文件损坏）就当作"没配过"，仍可新增。
        if (!cancelled) setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const profiles = summary?.profiles ?? [];
  const enabled = Boolean(summary?.enabled);
  const activeProfile =
    profiles.find((profile) => profile.id === summary?.active_profile_id) ?? profiles[0];
  const active = Boolean(enabled && activeProfile?.configured);

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({ name: "", base_url: "", model: "", api_key: "" });
    setEditor({ mode: "create" });
  };

  const openEdit = (profile: GlobalLLMProfile) => {
    form.resetFields();
    form.setFieldsValue({
      name: profile.name,
      base_url: profile.base_url,
      model: profile.model,
      api_key: "",
      clear_key: false,
    });
    setEditor({ mode: "edit", profile });
  };

  const submit = async () => {
    if (!editor) return;
    const values = await form.validateFields();
    setSaving(true);
    try {
      const config = {
        base_url: values.base_url.trim(),
        model: values.model.trim(),
        ...(editor.mode === "edit" ? { provider: editor.profile.provider } : {}),
      };
      const apiKey = values.api_key ? values.api_key : values.clear_key ? "__clear__" : undefined;
      const next =
        editor.mode === "create"
          ? await createGlobalLLMProfile({ name: values.name.trim(), config, api_key: apiKey })
          : await updateGlobalLLMProfile(editor.profile.id, {
              name: values.name.trim(),
              config,
              ...(apiKey ? { api_key: apiKey } : {}),
            });
      setSummary(next);
      setEditor(null);
      message.success(editor.mode === "create" ? "已新增模型配置" : "已保存模型配置");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存全局模型失败");
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (next: boolean) => {
    if (!activeProfile) return;
    setSaving(true);
    try {
      setSummary(
        await saveGlobalLLM({
          enabled: next,
          config: {
            provider: activeProfile.provider,
            base_url: activeProfile.base_url,
            model: activeProfile.model,
          },
        }),
      );
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存全局模型失败");
    } finally {
      setSaving(false);
    }
  };

  const activate = async (profile: GlobalLLMProfile) => {
    setBusyId(profile.id);
    try {
      setSummary(await activateGlobalLLMProfile(profile.id));
      message.success(`已切换到「${profile.name}」`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "切换全局模型失败");
    } finally {
      setBusyId(null);
    }
  };

  const remove = (profile: GlobalLLMProfile) => {
    modal.confirm({
      title: `删除「${profile.name}」？`,
      content:
        profile.id === summary?.active_profile_id
          ? "这是当前生效的配置：删除后会自动切换到剩下的第一套；如果这是最后一套，全局配置将关闭。"
          : "删除后不影响数据集自己的「模型服务」配置。",
      okText: "删 除",
      okButtonProps: { danger: true },
      cancelText: "取 消",
      onOk: async () => {
        try {
          setSummary(await deleteGlobalLLMProfile(profile.id));
          message.success("已删除模型配置");
        } catch (err) {
          message.error(err instanceof Error ? err.message : "删除失败");
        }
      },
    });
  };

  const clearAll = () => {
    modal.confirm({
      title: "清除全部全局模型配置？",
      content: "清除后每个数据集回到各自「模型服务」里填的那一份。",
      okText: "清 除",
      okButtonProps: { danger: true },
      cancelText: "取 消",
      onOk: async () => {
        await clearGlobalLLM();
        setSummary(null);
        message.success("已清除全局模型配置");
      },
    });
  };

  return (
    <Card
      className="settings-card"
      title="全局模型（所有数据集共用）"
      loading={loading}
      extra={
        <Space>
          {profiles.length > 0 ? (
            <Button type="text" danger onClick={clearAll}>
              全部清除
            </Button>
          ) : null}
          <Button onClick={openCreate}>新 增</Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        可以保存多套模型配置，页头会显示当前这一套；打开开关后，简历生成、岗位解读、求职助手等
        **所有数据集**都用它。配置存在数据目录的 <code>global_settings.json</code> 里，
        密钥加密保存，不会进备份包。
      </Typography.Paragraph>
      {active ? (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 12 }}
          title={`全局模型正在生效：${activeProfile?.name} · ${activeProfile?.model}`}
          description="下方「模型服务」里保存的配置此刻不生效；要改回按数据集分别配置，关掉开关即可。"
        />
      ) : null}
      <Form name="global-llm" layout="vertical" requiredMark={false}>
        <Form.Item label="对所有数据集生效" style={{ marginBottom: 12 }}>
          <Switch
            checked={enabled}
            disabled={profiles.length === 0 || saving}
            onChange={(checked) => void toggleEnabled(checked)}
            aria-label="对所有数据集生效"
          />
          {profiles.length === 0 ? (
            <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              先新增一套配置
            </Typography.Text>
          ) : null}
        </Form.Item>
      </Form>

      {profiles.length === 0 ? (
        <Empty description="还没有全局模型配置；数据集会各用各的「模型服务」" />
      ) : (
        <List
          size="small"
          dataSource={profiles}
          renderItem={(profile) => {
            const isActive = profile.id === summary?.active_profile_id;
            return (
              <List.Item
                actions={[
                  ...(isActive
                    ? []
                    : [
                        <Button
                          key="activate"
                          type="link"
                          size="small"
                          loading={busyId === profile.id}
                          onClick={() => void activate(profile)}
                        >
                          设为当前
                        </Button>,
                      ]),
                  <Button key="edit" type="link" size="small" onClick={() => openEdit(profile)}>
                    编 辑
                  </Button>,
                  <Button
                    key="delete"
                    type="link"
                    size="small"
                    danger
                    onClick={() => remove(profile)}
                  >
                    删 除
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space size={6} wrap>
                      <span>{profile.name}</span>
                      {isActive ? <Tag color="green">当前</Tag> : null}
                      {profile.is_default ? <Tag>默认</Tag> : null}
                    </Space>
                  }
                  description={
                    profile.configured
                      ? `${profile.model} · ${profile.base_url}`
                      : "地址或模型未填全，暂不会接管调用"
                  }
                />
              </List.Item>
            );
          }}
        />
      )}

      <Modal
        title={editor?.mode === "edit" ? `编辑「${editor.profile.name}」` : "新增模型配置"}
        open={editor !== null}
        okText="保 存"
        cancelText="取 消"
        confirmLoading={saving}
        destroyOnHidden
        onOk={() => void submit()}
        onCancel={() => {
          if (!saving) setEditor(null);
        }}
      >
        <Form form={form} name="global-llm-profile" layout="vertical" requiredMark={false}>
          <Form.Item
            name="name"
            label="配置名称"
            rules={[{ required: true, message: "请填写名称" }]}
          >
            <Input maxLength={64} placeholder="例如：DeepSeek 日常" autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="base_url"
            label="接口地址"
            rules={[{ required: true, message: "请填写接口地址" }]}
          >
            <Input placeholder="https://api.deepseek.com/v1" autoComplete="off" />
          </Form.Item>
          <Form.Item name="model" label="模型" rules={[{ required: true, message: "请填写模型" }]}>
            <Input placeholder="deepseek-chat" autoComplete="off" />
          </Form.Item>
          <Form.Item name="api_key" label="密钥">
            <Input.Password
              placeholder={
                editor?.mode === "edit" ? "留空表示保留已保存的密钥" : "sk-…（加密保存）"
              }
              autoComplete="new-password"
            />
          </Form.Item>
          {editor?.mode === "edit" ? (
            <Form.Item name="clear_key" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Checkbox>清除已保存的密钥</Checkbox>
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </Card>
  );
}
