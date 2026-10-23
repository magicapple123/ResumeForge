// SPDX-License-Identifier: Apache-2.0
/**
 * 简历版式工作台：浏览内置版式、自制与管理版式。
 *
 * ## 2026-11：自制**模板**下线，只留**版式**
 *
 * 「自制模板」这条路（写 HTML/CSS、导入 HTML、从内置复制、导入参考图片/PDF 识别）已从界面
 * 撤掉：模板是"长什么样"，改它的成本是高阶用户的，而绝大多数人真正要调的是行高、页边距、
 * 强调色这类**参数**——那正是「版式」。所以这一页现在只有一张「版式」卡片。
 *
 * 保留的东西：
 *
 * - **内置版式**的标签行（只读、永远可用）；
 * - **自制版式**的增删改查（`FormatTemplateEditorModal` + `TemplateCustomTable`）；
 * - 版式预览（`TemplatePreviewModal`，它同时服务模板与版式，所以 `previewTemplate` 还在）。
 *
 * 撤掉的东西：`StyleTemplateEditorModal`、`TemplateImportModal`、`BuiltinStyleGallery`、
 * `FileDropZone` 的引用。**组件文件本身没有删除**（文件头有"已下线"标注）——历史测试仍能
 * 独立跑，真要回滚时不必从 git 里捞。
 *
 * 接口层一行没删：`api/resumeTemplates.ts` 里的导出仍被 `tsc` 检查，删函数只会换来编译失败，
 * 而"没有 UI 入口"已经足够表达下线。旧简历引用的自制模板仍按原样渲染，只是不再能新建。
 */
import { PlusOutlined, RobotOutlined } from "@ant-design/icons";
import { App, Button, Card, Space, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchResumeTemplates } from "../../api/resumes";
import { deleteResumeTemplate, listResumeTemplates } from "../../api/resumeTemplates";
import type { ResumeTemplateCatalog, ResumeTemplateDetail } from "../../types";
import FormatTemplateEditorModal from "./FormatTemplateEditorModal";
import TemplateCustomTable from "./TemplateCustomTable";
import TemplatePreviewModal from "./TemplatePreviewModal";
import TemplateWorkbenchIntro from "./TemplateWorkbenchIntro";

interface Props {
  /** 模板变化后通知外层刷新缓存。 */
  onChanged?: () => void;
}

export default function TemplateWorkbench({ onChanged }: Props) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<ResumeTemplateDetail[]>([]);
  const [catalog, setCatalog] = useState<ResumeTemplateCatalog | null>(null);
  const [loading, setLoading] = useState(true);

  const [formatEditor, setFormatEditor] = useState<{
    open: boolean;
    template: ResumeTemplateDetail | null;
  }>({ open: false, template: null });
  const [previewTemplate, setPreviewTemplate] = useState<ResumeTemplateDetail | null>(null);

  // 纯取数（不含 setState）：effect 内联调用时 Compiler 才能验证非同步更新；
  // 返回 null 表示失败（错误提示在这里统一给出）。
  const fetchTemplates = useCallback(async (): Promise<ResumeTemplateDetail[] | null> => {
    try {
      return await listResumeTemplates();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取自制版式失败");
      return null;
    }
  }, [message]);

  const fetchCatalog = useCallback(async (): Promise<ResumeTemplateCatalog | null> => {
    try {
      return await fetchResumeTemplates();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取版式目录失败");
      return null;
    }
  }, [message]);

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [nextTemplates, nextCatalog] = await Promise.all([fetchTemplates(), fetchCatalog()]);
      if (cancelled) return;
      if (nextTemplates !== null) setTemplates(nextTemplates);
      if (nextCatalog !== null) setCatalog(nextCatalog);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchTemplates, fetchCatalog]);

  // 事件路径（保存/删除后的整表重拉，含 loading 翻动）。
  const load = useCallback(async () => {
    setLoading(true);
    const next = await fetchTemplates();
    if (next !== null) setTemplates(next);
    setLoading(false);
  }, [fetchTemplates]);

  const loadCatalog = useCallback(async () => {
    const next = await fetchCatalog();
    if (next !== null) setCatalog(next);
  }, [fetchCatalog]);

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
      message.success(`已删除「${template.name}」；引用它的简历会退回默认版式`);
      refreshAll();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  // 只剩版式：模板那一类不再有入口，也不再从列表里过滤出来展示。
  const formatTemplates = templates.filter((item) => item.kind === "format");

  const askTemplate = (row: ResumeTemplateDetail) => askAssistant(`帮我调整版式「${row.name}」：`);

  return (
    <div className="template-workbench">
      <TemplateWorkbenchIntro />

      <Card
        size="small"
        className="settings-card"
        title="版式"
        style={{ marginTop: 16 }}
        extra={
          <Space wrap>
            <Button icon={<RobotOutlined />} onClick={() => askAssistant("帮我新建一个版式：")}>
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
          <Typography.Text type="secondary">
            还没有自制版式。想压进一页时，用它调行高与页边距最快。
          </Typography.Text>
        ) : (
          <TemplateCustomTable
            templates={formatTemplates}
            loading={loading}
            onPreview={setPreviewTemplate}
            onEdit={(row) => setFormatEditor({ open: true, template: row })}
            onAsk={askTemplate}
            onDelete={(row) => void remove(row)}
          />
        )}
      </Card>

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
      {/* catalogLoading 已随自制模板下线一起移除：目录只用来渲染内置版式标签与字段表，
          晚到几百毫秒不影响任何可点动作。 */}
    </div>
  );
}
