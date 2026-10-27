// SPDX-License-Identifier: Apache-2.0
/** 技能详情 / 编辑：提示词与知识文件都在这一个弹窗里查看和修改。 */

import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Alert, App, Button, Form, Input, Modal, Space, Spin, Switch, Typography } from "antd";
import { useEffect, useState } from "react";
import { createSkill, getSkill, updateSkill } from "../../api/skill";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { AssistantSkillFileInput } from "../../types";

/** 新建技能时用的预填内容（来自工作台的模板）。 */
export interface SkillDraft {
  name?: string;
  description?: string;
  prompt?: string;
}

interface Props {
  open: boolean;
  /** 传 id 表示编辑已有技能，传 null 表示新建。 */
  skillId: number | null;
  draft?: SkillDraft | null;
  /**
   * 只读查看：不渲染「保存」，输入与开关全部禁用。
   *
   * 设置页的技能摘要卡是**只读**摘要（技能管理入口统一在工作台），点技能名只是
   * 看一眼内容；如果沿用可编辑弹窗，等于给设置页留了一个隐形的写入口。
   * 工作台侧不传它，行为与之前完全一致。
   */
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (skillId: number) => void;
}

export default function SkillEditorModal({
  open,
  skillId,
  draft,
  readOnly = false,
  onClose,
  onSaved,
}: Props) {
  const { message } = App.useApp();
  // 本弹窗用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [files, setFiles] = useState<AssistantSkillFileInput[]>([]);
  const [filesTruncated, setFilesTruncated] = useState(false);

  // Compiler 规范：随输入变化的表单回填用渲染期守卫式调整（新建分支）；异步加载
  // 留在 effect。原实现 draft 变化会在编辑既有技能时整单重取——那属于误触发，
  // 拆分后 draft 只驱动"新建"分支（它才是 draft 语义相关的场景）。
  const [prevSync, setPrevSync] = useState({ open, skillId, draft });
  if (prevSync.open !== open || prevSync.skillId !== skillId || prevSync.draft !== draft) {
    setPrevSync({ open, skillId, draft });
    if (open && skillId === null) {
      setName(draft?.name ?? "");
      setDescription(draft?.description ?? "");
      setPrompt(draft?.prompt ?? "");
      setEnabled(true);
      setFiles([]);
      setFilesTruncated(false);
    }
    // 进入"编辑既有技能"分支时同步把加载态打开（fetch effect 只负责收尾）。
    if (open && skillId !== null) setLoading(true);
  }

  useEffect(() => {
    if (!open || skillId === null) return;
    void getSkill(skillId)
      .then((detail) => {
        setName(detail.name);
        setDescription(detail.description);
        setPrompt(detail.prompt);
        setEnabled(detail.enabled);
        setFiles(detail.file_details.map((item) => ({ path: item.path, content: item.content })));
        setFilesTruncated(detail.files_truncated);
      })
      .catch((error) =>
        message.error(error instanceof Error ? error.message : t("skills.editor.loadFailed")),
      )
      .finally(() => setLoading(false));
  }, [message, open, skillId]);

  const save = async () => {
    if (!name.trim()) {
      message.warning(t("skills.editor.nameRequired"));
      return;
    }
    if (!prompt.trim()) {
      message.warning(t("skills.editor.promptRequired"));
      return;
    }
    setSaving(true);
    try {
      const base = { name: name.trim(), description: description.trim(), prompt, enabled };
      if (skillId === null) {
        const created = await createSkill({ ...base, files });
        message.success(t("skills.editor.created", { name: created.name }));
        onSaved(created.id);
      } else {
        // 知识文件正文没完全加载时不要提交 files：那会把没加载到的内容覆盖成空。
        const updated = await updateSkill(skillId, filesTruncated ? base : { ...base, files });
        message.success(t("skills.editor.saved", { name: updated.name }));
        onSaved(updated.id);
      }
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("skills.editor.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      className="skill-editor-modal"
      title={
        readOnly
          ? t("skills.editor.detailTitle")
          : skillId === null
            ? t("skills.editor.createTitle")
            : t("skills.editor.editTitle")
      }
      open={open}
      width={760}
      mask={{ closable: false }}
      // 内容长时 body 自己滚动：`--rf-modal-body-max-h` 是弹窗内容区的统一上限
      // （tokens 里定义，深浅主题同值）。只给 maxHeight 不给固定高度，内容少时弹窗
      // 仍按内容收缩。下边距比左右多留一点，最后一个「添加知识文件」按钮才不会贴着
      // 页脚（此前首尾都显得"顶格"）。
      styles={{
        body: {
          padding: "20px 24px 28px",
          scrollPaddingTop: 12,
          maxHeight: "var(--rf-modal-body-max-h)",
          overflowY: "auto",
        },
      }}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose} disabled={saving}>
            {t("common.action.close")}
          </Button>
          {/* 只读查看不提供保存：这条链路（设置页）不允许改动技能。 */}
          {!readOnly && (
            <Button type="primary" loading={saving} onClick={() => void save()}>
              {t("common.action.save")}
            </Button>
          )}
        </Space>
      }
    >
      {loading ? (
        <Spin />
      ) : (
        <div className="skill-editor-body">
          {/* 只读查看时 Form 的 disabled 会把全部控件（含「启用」开关）置灰，
              让这条链路在视觉上也明确「只能看」。 */}
          <Form layout="vertical" disabled={readOnly}>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              title={t("skills.editor.intro")}
            />
            <Form.Item label={t("skills.editor.name")} required>
              <Input
                value={name}
                maxLength={64}
                placeholder={t("skills.editor.namePlaceholder")}
                onChange={(event) => setName(event.target.value)}
              />
            </Form.Item>
            <Form.Item label={t("skills.editor.scenario")}>
              <Input
                value={description}
                maxLength={255}
                placeholder={t("skills.editor.scenarioPlaceholder")}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Form.Item>
            <Form.Item label={t("skills.editor.enabled")}>
              <Switch checked={enabled} onChange={setEnabled} />
            </Form.Item>
            <Form.Item label={t("skills.editor.prompt")} required>
              <Input.TextArea
                value={prompt}
                autoSize={{ minRows: 8, maxRows: 20 }}
                placeholder={t("skills.editor.promptPlaceholder")}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </Form.Item>
            <Form.Item
              label={
                <Space>
                  <span>{t("skills.editor.files")}</span>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t("skills.editor.filesHint")}
                  </Typography.Text>
                </Space>
              }
            >
              {filesTruncated && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12 }}
                  title={t("skills.editor.filesTruncated")}
                />
              )}
              <Space orientation="vertical" style={{ width: "100%" }}>
                {files.map((file, index) => (
                  <div key={`${file.path}-${index}`} className="skill-file-editor">
                    <Space style={{ width: "100%" }} align="start">
                      <Input
                        value={file.path}
                        maxLength={255}
                        placeholder={t("skills.editor.filePathPlaceholder")}
                        style={{ width: 240 }}
                        onChange={(event) =>
                          setFiles((current) =>
                            current.map((item, i) =>
                              i === index ? { ...item, path: event.target.value } : item,
                            ),
                          )
                        }
                      />
                      {/* 按钮不在 Form 的 disabled 上下文里，只读时要单独藏掉。 */}
                      {!readOnly && (
                        <Button
                          type="text"
                          danger
                          aria-label={t("skills.editor.removeFile", { path: file.path })}
                          icon={<DeleteOutlined />}
                          onClick={() =>
                            setFiles((current) => current.filter((_, i) => i !== index))
                          }
                        />
                      )}
                    </Space>
                    <Input.TextArea
                      value={file.content}
                      autoSize={{ minRows: 3, maxRows: 10 }}
                      placeholder={t("skills.editor.fileContentPlaceholder")}
                      onChange={(event) =>
                        setFiles((current) =>
                          current.map((item, i) =>
                            i === index ? { ...item, content: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
                {!readOnly && (
                  <Button
                    icon={<PlusOutlined />}
                    onClick={() => setFiles((current) => [...current, { path: "", content: "" }])}
                  >
                    {t("skills.editor.addFile")}
                  </Button>
                )}
              </Space>
            </Form.Item>
          </Form>
        </div>
      )}
    </Modal>
  );
}
