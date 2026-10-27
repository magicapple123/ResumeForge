// SPDX-License-Identifier: Apache-2.0
/** 投投剪贴板：双击悬浮球打开的常用资料片段夹，点一下就复制到系统剪贴板。
 *
 * 与助手卡片（TouTouAssistantCard）同一形态：fixed 小卡片、顶部把手可拖动、
 * 会话内记住位置——用 antd Modal 会被固定在屏幕中央，拖不走也不贴着球。
 * 数据只存本机 localStorage（`resumeforge.toutou.clipboard.v1`）：这些是用户
 * 打算反复粘贴的原文片段，量小、私有、且没有跨设备诉求，不值得为它加一张表
 * 和一条同步链路。换浏览器/清缓存会丢，界面文案里如实说明。
 */
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { App, Button, ConfigProvider, Input, Listy, Typography } from "antd";
import EmptyState from "../../components/common/EmptyState";
import { ListyItem, ListyMeta } from "../../components/common/ListyItem";
import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { layer } from "../../theme/tokens";
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
  useLocale();
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

  // 打开时从浏览器本地剪贴板存储读回条目（同一份实现，事件路径复用）。
  // Compiler 规范：随 open 变化的加载用渲染期守卫（哨兵 null：挂载即打开也加载
  // 一次，与原 effect 语义一致）；DOM 定位副作用留在 effect。
  const [prevOpen, setPrevOpen] = useState<boolean | null>(null);
  if (prevOpen === null || prevOpen !== open) {
    setPrevOpen(open);
    if (open) setItems(loadItems());
  }

  useEffect(() => {
    if (open) placeNextToOrb();
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
    const trimmedTitle =
      title.trim() || content.trim().slice(0, 20) || t("touTou.clipboard.untitled");
    const trimmedContent = content.trimEnd();
    if (!trimmedContent.trim()) {
      message.warning(t("touTou.clipboard.emptyContent"));
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
    message.success(t("touTou.clipboard.saved"));
    closeEditor();
  };

  const removeItem = (id: number) => {
    setItems((current) => {
      const next = current.filter((item) => item.id !== id);
      persistItems(next);
      return next;
    });
    message.success(t("touTou.clipboard.deleted"));
  };

  const copyItem = async (item: ClipboardItem) => {
    setCopyingId(item.id);
    try {
      const ok = await copyText(item.content);
      if (ok) message.success(t("touTou.clipboard.copied", { title: item.title }));
      else message.warning(t("touTou.clipboard.copyFailed"));
    } finally {
      setCopyingId(null);
    }
  };

  const classes = ["tt-clipboard-card", dragging ? "is-dragging" : ""].filter(Boolean).join(" ");

  return (
    <section
      className={classes}
      style={cardStyle}
      role="dialog"
      aria-label={t("touTou.clipboard.ariaLabel")}
    >
      {/*
        卡片内弹层基准抬层：全局 zIndexPopupBase（3100）配 antd 的组件偏移
        （+50~+80）到不了本卡（3500）之上，「···」下拉从这里挂到 body 后被卡片
        盖住（用户看是"删除项被裁掉"）。局部把基准提到 layer.cardPopup（3550），
        下拉落在 3600——卡片之上、悬浮球（3650）之下。其余 token 继承全局主题。
      */}
      <ConfigProvider theme={{ token: { zIndexPopupBase: layer.cardPopup } }}>
        <div
          ref={gripRef}
          className="tt-clipboard-card-grip"
          role="button"
          tabIndex={0}
          aria-label={t("touTou.clipboard.gripLabel")}
          onPointerDown={handlePointerDown}
          onKeyDown={handleKeyDown}
        >
          <span className="tt-clipboard-card-title">{t("touTou.clipboard.title")}</span>
        </div>
        <button
          type="button"
          className="tt-clipboard-card-close"
          aria-label={t("touTou.clipboard.close")}
          onClick={onClose}
        >
          ×
        </button>
        <div className="tt-clipboard-card-body">
          <Typography.Paragraph type="secondary" className="tt-clipboard-card-hint">
            {t("touTou.clipboard.hint")}
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
                {items.length >= MAX_ITEMS
                  ? t("touTou.clipboard.limitReached", { count: MAX_ITEMS })
                  : t("touTou.clipboard.add")}
              </Button>
              <div className="tt-clipboard-card-list">
                {items.length === 0 ? (
                  <EmptyState inline description={t("touTou.clipboard.empty")} />
                ) : (
                  <Listy
                    items={items}
                    rowKey={(item) => item.id}
                    itemRender={(item) => (
                      <ListyItem
                        actions={[
                          <Button
                            key="copy"
                            size="small"
                            type="primary"
                            ghost
                            loading={copyingId === item.id}
                            onClick={() => void copyItem(item)}
                          >
                            {t("touTou.clipboard.copy")}
                          </Button>,
                          // 编辑/删除收进「···」菜单：删除不再以红图标裸露在行内
                          // （全局约定：除回收站外，删除一律走菜单 + 二次确认）。
                          <RowActions
                            key="more"
                            more={[
                              {
                                key: "edit",
                                label: t("touTou.clipboard.edit"),
                                icon: <EditOutlined />,
                                onClick: () => startEdit(item),
                              },
                              {
                                key: "delete",
                                label: t("touTou.clipboard.delete"),
                                icon: <DeleteOutlined />,
                                danger: true,
                                confirm: t("touTou.clipboard.deleteConfirm"),
                                onClick: () => removeItem(item.id),
                              },
                            ]}
                          />,
                        ]}
                      >
                        <ListyMeta
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
                      </ListyItem>
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
                placeholder={t("touTou.clipboard.titlePlaceholder", { max: MAX_TITLE_CHARS })}
                onChange={(event) => setTitle(event.target.value)}
                style={{ marginBottom: 8 }}
              />
              <Input.TextArea
                value={content}
                onChange={(event) => setContent(event.target.value.slice(0, MAX_CONTENT_CHARS))}
                placeholder={t("touTou.clipboard.contentPlaceholder")}
                autoSize={{ minRows: 6, maxRows: 12 }}
                // 不用 antd showCount（"0/4000" 常驻计数打扰且会与按钮行叠字）：
                // maxLength 作硬上限，达到上限才出现一行红色小字提示。
                maxLength={MAX_CONTENT_CHARS}
              />
              {content.length >= MAX_CONTENT_CHARS ? (
                <div className="tt-clipboard-card-limit-hint" role="note">
                  {t("touTou.clipboard.contentLimit", { max: MAX_CONTENT_CHARS })}
                </div>
              ) : null}
              <div style={{ marginTop: 12, textAlign: "right" }}>
                <Button onClick={closeEditor} style={{ marginRight: 8 }}>
                  {t("touTou.clipboard.cancel")}
                </Button>
                <Button type="primary" onClick={saveEditing}>
                  {t("touTou.clipboard.save")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </ConfigProvider>
    </section>
  );
}
