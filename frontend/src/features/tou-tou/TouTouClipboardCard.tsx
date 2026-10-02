/** 投投剪贴板：双击悬浮球打开的常用资料片段夹，点一下就复制到系统剪贴板。
 *
 * 与助手卡片（TouTouAssistantCard）同一形态：fixed 小卡片、顶部把手可拖动、
 * 会话内记住位置——用 antd Modal 会被固定在屏幕中央，拖不走也不贴着球。
 * 数据只存本机 localStorage（`resumeforge.toutou.clipboard.v1`）：这些是用户
 * 打算反复粘贴的原文片段，量小、私有、且没有跨设备诉求，不值得为它加一张表
 * 和一条同步链路。换浏览器/清缓存会丢，界面文案里如实说明。
 */
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { App, Button, Empty, Input, List, Typography } from "antd";
import { useEffect, useState } from "react";
import { RowActions } from "../../components/common/RowActions";
import { copyText } from "../../utils/clipboard";
import { useTouTouCardDrag } from "./useTouTouCardDrag";
import "./tou-tou-clipboard.css";

interface ClipboardItem {
  id: number;
  title: string;
  content: string;
}

const STORAGE_KEY = "resumeforge.toutou.clipboard.v1";
const MAX_ITEMS = 50;
const MAX_TITLE_CHARS = 60;
const MAX_CONTENT_CHARS = 4000;

function loadItems(): ClipboardItem[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is ClipboardItem =>
          !!item &&
          typeof item === "object" &&
          typeof (item as ClipboardItem).id === "number" &&
          typeof (item as ClipboardItem).title === "string" &&
          typeof (item as ClipboardItem).content === "string",
      )
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

function persistItems(items: ClipboardItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    // 存不进去（隐私模式等）就只保留在内存里：功能仍可用，重开卡片后丢失。
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function TouTouClipboardCard({ open, onClose }: Props) {
  const { message } = App.useApp();
  const [items, setItems] = useState<ClipboardItem[]>([]);
  /** 正在编辑的条目 id；``"new"`` 表示新增。null = 列表视图。 */
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [copyingId, setCopyingId] = useState<number | null>(null);
  const { cardStyle, dragging, gripRef, handleKeyDown, handlePointerDown, placeNextToOrb } =
    useTouTouCardDrag({
      selector: ".tt-clipboard-card",
      fallbackWidth: 360,
      fallbackHeight: 600,
    });

  useEffect(() => {
    if (open) {
      setItems(loadItems());
      placeNextToOrb();
    }
  }, [open, placeNextToOrb]);

  if (!open) return null;

  const startCreate = () => {
    setEditingId("new");
    setTitle("");
    setContent("");
  };

  const startEdit = (item: ClipboardItem) => {
    setEditingId(item.id);
    setTitle(item.title);
    setContent(item.content);
  };

  const closeEditor = () => {
    setEditingId(null);
    setTitle("");
    setContent("");
  };

  const saveEditing = () => {
    const trimmedTitle = title.trim() || content.trim().slice(0, 20) || "未命名片段";
    const trimmedContent = content.trimEnd();
    if (!trimmedContent.trim()) {
      message.warning("内容不能为空");
      return;
    }
    setItems((current) => {
      const next =
        editingId === "new"
          ? [
              {
                id: Date.now(),
                title: trimmedTitle.slice(0, MAX_TITLE_CHARS),
                content: trimmedContent,
              },
              ...current,
            ]
          : current.map((item) =>
              item.id === editingId
                ? {
                    ...item,
                    title: trimmedTitle.slice(0, MAX_TITLE_CHARS),
                    content: trimmedContent,
                  }
                : item,
            );
      persistItems(next);
      return next;
    });
    message.success("已保存片段");
    closeEditor();
  };

  const removeItem = (id: number) => {
    setItems((current) => {
      const next = current.filter((item) => item.id !== id);
      persistItems(next);
      return next;
    });
    message.success("已删除片段");
  };

  const copyItem = async (item: ClipboardItem) => {
    setCopyingId(item.id);
    try {
      const ok = await copyText(item.content);
      if (ok) message.success(`已复制「${item.title}」`);
      else message.warning("复制失败，请手动选择内容复制");
    } finally {
      setCopyingId(null);
    }
  };

  const classes = ["tt-clipboard-card", dragging ? "is-dragging" : ""].filter(Boolean).join(" ");

  return (
    <section className={classes} style={cardStyle} role="dialog" aria-label="投投剪贴板">
      <div
        ref={gripRef}
        className="tt-clipboard-card-grip"
        role="button"
        tabIndex={0}
        aria-label="拖动投投剪贴板"
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
      >
        <span className="tt-clipboard-card-title">投投剪贴板</span>
      </div>
      <button
        type="button"
        className="tt-clipboard-card-close"
        aria-label="关闭投投剪贴板"
        onClick={onClose}
      >
        ×
      </button>
      <div className="tt-clipboard-card-body">
        <Typography.Paragraph type="secondary" className="tt-clipboard-card-hint">
          把要反复粘贴的资料存成片段，点一下就复制。片段只保存在本机浏览器里，不会上传。
        </Typography.Paragraph>
        {editingId === null ? (
          <>
            <Button
              type="primary"
              ghost
              block
              icon={<PlusOutlined />}
              onClick={startCreate}
              disabled={items.length >= MAX_ITEMS}
            >
              {items.length >= MAX_ITEMS ? `片段已达上限（${MAX_ITEMS} 条）` : "新增片段"}
            </Button>
            <div className="tt-clipboard-card-list">
              {items.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="还没有片段：把常贴的内容存进来，随时一键复制。"
                />
              ) : (
                <List
                  dataSource={items}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button
                          key="copy"
                          size="small"
                          type="primary"
                          ghost
                          loading={copyingId === item.id}
                          onClick={() => void copyItem(item)}
                        >
                          复制
                        </Button>,
                        // 编辑/删除收进「···」菜单：删除不再以红图标裸露在行内
                        // （全局约定：除回收站外，删除一律走菜单 + 二次确认）。
                        <RowActions
                          key="more"
                          more={[
                            {
                              key: "edit",
                              label: "编辑",
                              icon: <EditOutlined />,
                              onClick: () => startEdit(item),
                            },
                            {
                              key: "delete",
                              label: "删除",
                              icon: <DeleteOutlined />,
                              danger: true,
                              confirm: "删除这条片段？",
                              onClick: () => removeItem(item.id),
                            },
                          ]}
                        />,
                      ]}
                    >
                      <List.Item.Meta
                        title={item.title}
                        description={
                          <Typography.Paragraph
                            type="secondary"
                            ellipsis={{ rows: 2 }}
                            className="tt-clipboard-card-item-content"
                          >
                            {item.content}
                          </Typography.Paragraph>
                        }
                      />
                    </List.Item>
                  )}
                />
              )}
            </div>
          </>
        ) : (
          <div>
            <Input
              value={title}
              maxLength={MAX_TITLE_CHARS}
              placeholder={`片段名称（留空则取内容前 20 字，最多 ${MAX_TITLE_CHARS} 字）`}
              onChange={(event) => setTitle(event.target.value)}
              style={{ marginBottom: 8 }}
            />
            <Input.TextArea
              value={content}
              onChange={(event) => setContent(event.target.value.slice(0, MAX_CONTENT_CHARS))}
              placeholder="片段内容（复制时按这里保存的原文粘贴）"
              autoSize={{ minRows: 6, maxRows: 12 }}
              showCount={{
                formatter: ({ count }: { count: number }) => `${count}/${MAX_CONTENT_CHARS}`,
              }}
              maxLength={MAX_CONTENT_CHARS}
            />
            <div style={{ marginTop: 12, textAlign: "right" }}>
              <Button onClick={closeEditor} style={{ marginRight: 8 }}>
                取消
              </Button>
              <Button type="primary" onClick={saveEditing}>
                保存
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
