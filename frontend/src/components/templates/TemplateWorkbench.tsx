/**
 * 简历模板工作台：管理样式模板（长什么样）与格式模板（排得多密）。
 *
 * 三层结构，用户不必懂技术也能用上：
 * 1. **内置模板**只读，永远可用，删不掉；
 * 2. **自制样式模板**从某个内置模板复制一份开始改，或用文件导入；
 * 3. **格式模板**只调参数（行高、页边距、强调色），不碰 HTML。
 */
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  RobotOutlined,
  ImportOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Col,
  Collapse,
  Dropdown,
  Empty,
  Row,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchResumeTemplates } from "../../api/resumes";
import {
  deleteResumeTemplate,
  fetchBuiltinTemplateSource,
  listResumeTemplates,
} from "../../api/resumeTemplates";
import type { ResumeFontScale, ResumeTemplateCatalog, ResumeTemplateDetail } from "../../types";
import type { TemplateMarketPreset } from "../../types/templateMarket";
import FileDropZone from "../common/FileDropZone";
import { RowActions } from "../common/RowActions";
import BuiltinStyleGallery from "./BuiltinStyleGallery";
import FormatTemplateEditorModal from "./FormatTemplateEditorModal";
import TemplateImportModal from "./TemplateImportModal";
import StyleTemplateEditorModal from "./StyleTemplateEditorModal";
import TemplatePreviewModal, { type TemplatePresetPreview } from "./TemplatePreviewModal";

function styleLabel(catalog: ResumeTemplateCatalog | null | undefined, name: string): string {
  return catalog?.templates.find((item) => item.name === name)?.label ?? name;
}

function formatLabel(catalog: ResumeTemplateCatalog | null | undefined, name: string): string {
  if (!name) return "模板自带版式";
  return catalog?.format_presets.find((item) => item.name === name)?.label ?? name;
}

function fontLabel(catalog: ResumeTemplateCatalog | null | undefined, name: string): string {
  return catalog?.font_scales.find((item) => item.name === name)?.label ?? name;
}

interface Props {
  /** 模板增删改之后通知外层（生成弹窗里缓存的目录需要重新取）。 */
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
  }>({ open: false, html: "", name: "" });
  const [formatEditor, setFormatEditor] = useState<{
    open: boolean;
    template: ResumeTemplateDetail | null;
  }>({ open: false, template: null });
  const [previewTemplate, setPreviewTemplate] = useState<ResumeTemplateDetail | null>(null);
  // 模板市场（原独立「模板市场」卡片，已并入本工作台）：按场景给「样式+版式+字号」建议组合。
  const [marketPreset, setMarketPreset] = useState<TemplatePresetPreview | null>(null);
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

  /**
   * 带着上下文跳到求职助手，并用 `?ask=` 预填一句提问。
   *
   * 只把模板名放进问题里当上下文，**不自动发送**——助手页只负责预填，用户改完再发。
   * 刻意只引导到「格式模板」：样式模板是完整 HTML，助手生成/清洗后容易悄悄变样，
   * 那类改动仍留给工作台里的编辑器。
   */
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

  // **这里刻意只说「建议组合」而不是「已选用」**：预设只是"样式 + 版式 + 字号"的一组建议，
  // 点它并不会套用任何配置（工作台没有一个"当前简历"可套）。文案说「已选用」就是在骗人。
  const announcePreset = (item: TemplateMarketPreset) => {
    message.info(
      `「${item.label}」的建议组合：${styleLabel(catalog, item.template)} 样式 + ` +
        `${formatLabel(catalog, item.format_name)} 版式 + ${fontLabel(catalog, item.font_scale)} 字号。` +
        `生成或预览简历时，用「样式」和「版式」按这个组合选一下即可。`,
    );
  };

  /** 从内置模板复制一份开始自制。 */
  const copyBuiltin = async (name: string) => {
    try {
      const source = await fetchBuiltinTemplateSource(name);
      setStyleEditor({
        open: true,
        html: source.html,
        name: `${source.label} 副本`,
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取内置模板失败");
    }
  };

  /** 导入 HTML 文件：内容直接读进编辑器，保存前用户还能改。 */
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
    });
  };

  const styleTemplates = templates.filter((item) => item.kind === "style");
  const formatTemplates = templates.filter((item) => item.kind === "format");

  const customColumns: ColumnsType<ResumeTemplateDetail> = [
    {
      title: "模板",
      dataIndex: "name",
      render: (value: string, row) => (
        <Space orientation="vertical" size={0}>
          <Space size={6}>
            <b>{value}</b>
            {row.source_name ? <Tag>来自 {row.source_name}</Tag> : null}
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.description || "（无说明）"}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 96,
      render: (_, row) => (
        <RowActions
          more={[
            {
              key: "preview",
              label: "预览效果",
              icon: <EyeOutlined />,
              onClick: () => setPreviewTemplate(row),
            },
            {
              key: "edit",
              label: "编辑",
              icon: <EditOutlined />,
              onClick: () =>
                row.kind === "style"
                  ? setStyleEditor({ open: true, id: row.id, html: "", name: row.name })
                  : setFormatEditor({ open: true, template: row }),
            },
            // 只有格式模板能交给助手改（样式模板是 HTML，助手不生成）。跳过去时把模板名
            // 一起带上，助手才知道用户说的是哪一个。
            ...(row.kind === "format"
              ? [
                  {
                    key: "ask",
                    label: "找助手改这个模板",
                    icon: <RobotOutlined />,
                    onClick: () => askAssistant(`帮我调整格式模板「${row.name}」：`),
                  },
                ]
              : []),
            {
              key: "delete",
              label: "删除",
              icon: <DeleteOutlined />,
              danger: true,
              confirm: `删除模板「${row.name}」？引用它的简历会退回默认模板。`,
              onClick: () => void remove(row),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <div className="template-workbench">
      <Card size="small" className="settings-card">
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          简历模板是什么
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          <b>样式模板</b>决定简历长什么样（配色、字体、标题样式），内置 6 种，也可以自制；
          <b>格式模板</b>决定排得多密（行高、页边距、强调色），只调参数、不用写代码。
          两者可以自由组合——例如"优雅样式 + 紧凑版式"。
        </Typography.Paragraph>
        <Typography.Title level={5}>工作台怎么用</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          1. 想换个样子：从下面挑一个内置样式，点「复制改一份」开始编辑，右侧会实时预览； 2.
          想压进一页：用「自制版式」调行高与页边距，不用碰 HTML； 3.
          生成简历和预览简历时都能随时切换样式与版式，不会重新生成内容。
        </Typography.Paragraph>
      </Card>

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
                    // 清空 value：同一个文件连续导入两次也要触发 change。
                    event.target.value = "";
                    if (file) void importFile(file);
                  }}
                />
                <Button icon={<UploadOutlined />} onClick={(event) => event.preventDefault()}>
                  导入 HTML
                </Button>
              </label>
            </FileDropZone>
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
                // 用真实渲染的缩略图代替纯文字标签：光看「经典 / 现代」这些名字，
                // 用户并不知道自己选的是什么，只能挨个点开来试。
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
            {
              // 模板市场并进工作台：同一批内置样式的"场景化建议"，不再单独立一张
              // 与下面内容重复的卡片。默认收起，需要时展开。
              key: "market",
              label: "按场景选：模板市场建议",
              children: (
                <>
                  <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
                    按求职场景给出「样式 + 版式 + 字号」的组合建议。所有预设都映射到内置模板，
                    全离线、无需联网。
                  </Typography.Paragraph>
                  {(catalog?.market ?? []).length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无模板市场预设" />
                  ) : (
                    <Row gutter={[16, 16]}>
                      {(catalog?.market ?? []).map((item) => (
                        <Col key={item.name} xs={24} sm={12} lg={12}>
                          <Card size="small" title={item.label}>
                            <Typography.Paragraph type="secondary" style={{ minHeight: 44 }}>
                              {item.description}
                            </Typography.Paragraph>
                            <Space wrap size={4} style={{ marginBottom: 12 }}>
                              <Tag>样式：{styleLabel(catalog, item.template)}</Tag>
                              <Tag>版式：{formatLabel(catalog, item.format_name)}</Tag>
                              <Tag>字号：{fontLabel(catalog, item.font_scale)}</Tag>
                            </Space>
                            <Space>
                              <Button
                                onClick={() =>
                                  setMarketPreset({
                                    title: `模板市场 · ${item.label}`,
                                    templateName: item.template,
                                    formatName: item.format_name,
                                    formatConfig: item.format_config,
                                    // 目录里 font_scale 是 string（预设可能带新档位），弹窗按枚举收口。
                                    fontScale: item.font_scale as ResumeFontScale,
                                    pageLimit: item.page_limit,
                                  })
                                }
                              >
                                预览
                              </Button>
                              <Button type="primary" onClick={() => announcePreset(item)}>
                                这套怎么选
                              </Button>
                            </Space>
                          </Card>
                        </Col>
                      ))}
                    </Row>
                  )}
                </>
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
          <Table
            rowKey="id"
            size="small"
            loading={loading}
            columns={customColumns}
            dataSource={styleTemplates}
            pagination={false}
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
            {/* 「导入目标模板」：手里有一份想照着做的简历（图片/PDF/Word）时，
                让模型读出它的版式参数，省掉逐项手调。产出的是一份格式模板。 */}
            <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
              导入目标模板
            </Button>
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
          <Table
            rowKey="id"
            size="small"
            loading={loading}
            columns={customColumns}
            dataSource={formatTemplates}
            pagination={false}
          />
        )}
      </Card>

      <StyleTemplateEditorModal
        open={styleEditor.open}
        templateId={styleEditor.id ?? null}
        initialHtml={styleEditor.html}
        initialName={styleEditor.name}
        onClose={() => setStyleEditor({ open: false, html: "", name: "" })}
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
        preset={marketPreset}
        formatPresets={catalog?.format_presets ?? []}
        onClose={() => {
          setPreviewTemplate(null);
          setMarketPreset(null);
        }}
      />
      <TemplateImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => void load()}
      />
    </div>
  );
}
