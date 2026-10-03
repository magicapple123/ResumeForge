/** 简历模板工作台：浏览、导入、编辑和管理模板。 */
import {
  CopyOutlined,
  ImportOutlined,
  PlusOutlined,
  RobotOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { App, Button, Card, Collapse, Dropdown, Empty, Space, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchResumeTemplates } from "../../api/resumes";
import {
  deleteResumeTemplate,
  fetchBuiltinTemplateSource,
  listResumeTemplates,
} from "../../api/resumeTemplates";
import type { ResumeTemplateCatalog, ResumeTemplateDetail } from "../../types";
import FileDropZone from "../common/FileDropZone";
import BuiltinStyleGallery from "./BuiltinStyleGallery";
import FormatTemplateEditorModal from "./FormatTemplateEditorModal";
import TemplateImportModal from "./TemplateImportModal";
import TemplateCustomTable from "./TemplateCustomTable";
import TemplateWorkbenchIntro from "./TemplateWorkbenchIntro";
import StyleTemplateEditorModal from "./StyleTemplateEditorModal";
import TemplatePreviewModal from "./TemplatePreviewModal";

interface Props {
  /** 模板变化后通知外层刷新缓存。 */
  onChanged?: () => void;
}

export default function TemplateWorkbench({ onChanged }: Props) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<ResumeTemplateDetail[]>([]);
  const [catalog, setCatalog] = useState<ResumeTemplateCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      setCatalog(await fetchResumeTemplates());
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取模板目录失败");
    } finally {
      setCatalogLoading(false);
    }
  }, [message]);

  const [styleEditor, setStyleEditor] = useState<{
    open: boolean;
    id?: number | null;
    html: string;
    name: string;
    config: Record<string, unknown>;
  }>({ open: false, html: "", name: "", config: {} });
  const [formatEditor, setFormatEditor] = useState<{
    open: boolean;
    template: ResumeTemplateDetail | null;
  }>({ open: false, template: null });
  const [previewTemplate, setPreviewTemplate] = useState<ResumeTemplateDetail | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTemplates(await listResumeTemplates());
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取自制模板失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
    void loadCatalog();
  }, [load, loadCatalog]);

  const refreshAll = () => {
    void load();
    void loadCatalog();
    onChanged?.();
  };

  /** 跳到助手页预填问题，不自动发送。 */
  const askAssistant = (prompt: string) => navigate(`/assistant?ask=${encodeURIComponent(prompt)}`);

  const remove = async (template: ResumeTemplateDetail) => {
    try {
      await deleteResumeTemplate(template.id);
      message.success(`已删除「${template.name}」；引用它的简历会退回默认模板`);
      refreshAll();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  const copyBuiltin = async (name: string) => {
    try {
      const source = await fetchBuiltinTemplateSource(name);
      setStyleEditor({
        open: true,
        html: source.html,
        name: source.label + " 副本",
        config: source.config ?? {},
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取内置模板失败");
    }
  };

  const importFile = async (file: File) => {
    if (file.size > 400 * 1024) {
      message.warning("模板文件不要超过 400 KB");
      return;
    }
    const text = await file.text();
    setStyleEditor({
      open: true,
      html: text,
      name: file.name.replace(/\.(html?|j2)$/i, "").slice(0, 40),
      config: {},
    });
  };

  const styleTemplates = templates.filter((item) => item.kind === "style");
  const formatTemplates = templates.filter((item) => item.kind === "format");

  const editTemplate = (row: ResumeTemplateDetail) => {
    if (row.kind === "style") {
      setStyleEditor({ open: true, id: row.id, html: "", name: row.name, config: {} });
    } else {
      setFormatEditor({ open: true, template: row });
    }
  };

  const askTemplate = (row: ResumeTemplateDetail) =>
    askAssistant(`帮我调整格式模板「${row.name}」：`);

  return (
    <div className="template-workbench">
      <TemplateWorkbenchIntro />

      <Card
        size="small"
        className="settings-card"
        title="样式模板"
        style={{ marginTop: 16 }}
        extra={
          <Space wrap>
            <Dropdown
              menu={{
                items: (catalog?.templates ?? [])
                  .filter((item) => !item.custom)
                  .map((item) => ({
                    key: item.name,
                    label: `${item.label} · ${item.description}`,
                  })),
                onClick: ({ key }) => void copyBuiltin(key),
                disabled: catalogLoading,
              }}
            >
              <Button icon={<CopyOutlined />}>复制改一份</Button>
            </Dropdown>
            <FileDropZone
              accept=".html,.htm,.j2,.jinja,.txt"
              multiple={false}
              disabled={catalogLoading}
              hint="松开即可导入模板 HTML"
              onFiles={(files) => void importFile(files[0])}
              className="template-upload-drop"
            >
              <label className="template-upload-button">
                <input
                  type="file"
                  accept=".html,.htm,.j2,.jinja,.txt"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void importFile(file);
                  }}
                />
                <Button icon={<UploadOutlined />} onClick={(event) => event.preventDefault()}>
                  导入 HTML
                </Button>
              </label>
            </FileDropZone>
            <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
              导入参考模板
            </Button>
          </Space>
        }
      >
        <Collapse
          ghost
          defaultActiveKey={["builtin"]}
          items={[
            {
              key: "builtin",
              label: `内置样式（${(catalog?.templates ?? []).filter((item) => !item.custom).length} 个，只读）`,
              children: (
                <BuiltinStyleGallery
                  items={(catalog?.templates ?? [])
                    .filter((item) => !item.custom)
                    .map((item) => ({
                      name: item.name,
                      label: item.label,
                      description: item.description,
                    }))}
                />
              ),
            },
          ]}
        />
        {styleTemplates.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有自制样式模板。点右上角「复制改一份」从内置模板开始。"
          />
        ) : (
          <TemplateCustomTable
            templates={styleTemplates}
            loading={loading}
            onPreview={setPreviewTemplate}
            onEdit={editTemplate}
            onAsk={askTemplate}
            onDelete={(row) => void remove(row)}
          />
        )}
      </Card>

      <Card
        size="small"
        className="settings-card"
        title="格式模板（版式）"
        style={{ marginTop: 16 }}
        extra={
          <Space wrap>
            <Button icon={<RobotOutlined />} onClick={() => askAssistant("帮我新建一个格式模板：")}>
              找求职助手制作
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setFormatEditor({ open: true, template: null })}
            >
              自制版式
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          内置版式：
          {(catalog?.format_presets ?? [])
            .filter((item) => !item.custom)
            .map((item) => (
              <Tag key={item.name} className="template-chip">
                {item.label}
              </Tag>
            ))}
        </Typography.Paragraph>
        {formatTemplates.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有自制格式模板。想压进一页时，用它调行高与页边距最快。"
          />
        ) : (
          <TemplateCustomTable
            templates={formatTemplates}
            loading={loading}
            onPreview={setPreviewTemplate}
            onEdit={editTemplate}
            onAsk={askTemplate}
            onDelete={(row) => void remove(row)}
          />
        )}
      </Card>

      <StyleTemplateEditorModal
        open={styleEditor.open}
        templateId={styleEditor.id ?? null}
        initialHtml={styleEditor.html}
        initialName={styleEditor.name}
        initialConfig={styleEditor.config}
        fields={catalog?.style_fields ?? []}
        onClose={() => setStyleEditor({ open: false, html: "", name: "", config: {} })}
        onSaved={refreshAll}
      />
      <FormatTemplateEditorModal
        open={formatEditor.open}
        fields={catalog?.format_fields ?? []}
        template={formatEditor.template}
        onClose={() => setFormatEditor({ open: false, template: null })}
        onSaved={refreshAll}
      />
      <TemplatePreviewModal
        template={previewTemplate}
        formatPresets={catalog?.format_presets ?? []}
        onClose={() => setPreviewTemplate(null)}
      />
      <TemplateImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        styleFields={catalog?.style_fields ?? []}
        onImported={() => refreshAll()}
      />
    </div>
  );
}
