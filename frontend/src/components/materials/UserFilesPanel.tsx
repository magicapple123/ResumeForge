// SPDX-License-Identifier: Apache-2.0
/** 「我的文件」面板：当前数据集里用户上传内容的落盘清单（附件、照片、截图等）。
 *
 * 这些文件与数据库同目录存放——**属于当前数据集**：随数据集导出/导入、切换数据集
 * 与应用升级都不会丢（备份包从 2026-10 起附带 user_files/ 目录）。
 * 每一行提供：图片缩略图（antd Image 点开放大）、pdf 的抽屉内嵌预览，以及
 * 「打开文件夹」（后端在文件管理器里定位到副本文件）。
 */

import { FolderOpenOutlined, SearchOutlined } from "@ant-design/icons";
import { App, Button, Drawer, Empty, Image, Input, Table, Tag, Typography } from "antd";
import LoadingBlock from "../common/LoadingBlock";
import type { TableColumnsType, TablePaginationConfig } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  listUserFiles,
  revealUserFile,
  userFileRawUrl,
  type UserFileItem,
  type UserFileListResult,
} from "../../api/userFiles";
import { canPreviewImage } from "../../utils/attachments";
import { formatDateTime } from "../../utils/format";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 来源标注 → 界面文案 key（与后端 user_files 服务的 source_type 一致）。 */
const SOURCE_LABEL_KEYS: Record<string, MessageKey> = {
  material: "materials.files.source.material",
  photo: "materials.files.source.photo",
  job_note: "materials.files.source.jobNote",
  candidate_image: "materials.files.source.candidateImage",
  chat_attachment: "materials.files.source.chatAttachment",
};

const PAGE_SIZE = 20;

function sourceLabel(item: UserFileItem): string {
  const key = SOURCE_LABEL_KEYS[item.source_type];
  return key ? t(key) : item.source_type || t("materials.files.source.unknown");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isPdf(item: UserFileItem): boolean {
  return item.mime.split(";", 1)[0].trim().toLowerCase() === "application/pdf";
}

export default function UserFilesPanel() {
  useLocale();
  const { message } = App.useApp();
  const [rows, setRows] = useState<UserFileItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [pdfPreview, setPdfPreview] = useState<UserFileItem | null>(null);
  const [openingId, setOpeningId] = useState<number | null>(null);

  // 纯取数（不含 setState）：effect 内联调用时 Compiler 才能验证非同步更新。
  const fetchFiles = useCallback(async (): Promise<UserFileListResult | null> => {
    try {
      return await listUserFiles({ page, page_size: PAGE_SIZE, keyword });
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("materials.files.toast.loadFailed"));
      return null;
    }
  }, [keyword, message, page]);

  // Compiler 规范：初始加载的 setState 放 .then 回调（外部数据到达时应用）。
  useEffect(() => {
    let cancelled = false;
    void fetchFiles().then((result) => {
      if (cancelled) return;
      if (result) {
        setRows(result.items);
        setTotal(result.total);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchFiles]);

  const revealInFolder = async (item: UserFileItem) => {
    setOpeningId(item.id);
    try {
      await revealUserFile(item.id);
      message.success(t("materials.files.toast.revealed"));
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("materials.files.toast.revealFailed"),
      );
    } finally {
      setOpeningId(null);
    }
  };

  const columns: TableColumnsType<UserFileItem> = [
    {
      title: t("materials.files.column.name"),
      dataIndex: "original_name",
      ellipsis: true,
      render: (_: unknown, item: UserFileItem) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {canPreviewImage(item.mime) ? (
            <Image src={userFileRawUrl(item.id)} alt={item.original_name} width={40} height={40} />
          ) : null}
          <Typography.Text ellipsis>
            {item.original_name || t("materials.files.untitled")}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: t("materials.files.column.type"),
      dataIndex: "mime",
      width: 180,
      render: (mime: string) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {mime}
        </Typography.Text>
      ),
    },
    {
      title: t("materials.files.column.size"),
      dataIndex: "size",
      width: 90,
      render: (size: number) => formatSize(size),
    },
    {
      title: t("materials.files.column.source"),
      dataIndex: "source_type",
      width: 150,
      render: (_: unknown, item: UserFileItem) => <Tag color="blue">{sourceLabel(item)}</Tag>,
    },
    {
      title: t("materials.files.column.savedAt"),
      dataIndex: "created_at",
      width: 160,
      render: (value: string | null) => (
        <Typography.Text type="secondary">{formatDateTime(value ?? undefined)}</Typography.Text>
      ),
    },
    {
      title: t("materials.files.column.actions"),
      key: "actions",
      width: 170,
      render: (_: unknown, item: UserFileItem) => (
        <div style={{ display: "flex", gap: 4 }}>
          {isPdf(item) && (
            <Button type="link" size="small" onClick={() => setPdfPreview(item)}>
              {t("materials.files.action.preview")}
            </Button>
          )}
          <Button
            type="link"
            size="small"
            icon={<FolderOpenOutlined />}
            loading={openingId === item.id}
            onClick={() => void revealInFolder(item)}
          >
            {t("materials.files.action.openFolder")}
          </Button>
        </div>
      ),
    },
  ];

  const pagination: TablePaginationConfig = {
    current: page,
    pageSize: PAGE_SIZE,
    total,
    showSizeChanger: false,
    showTotal: (count) => t("materials.files.total", { count }),
    onChange: (next) => setPage(next),
  };

  return (
    <div className="user-files-panel">
      <div style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          placeholder={t("materials.files.searchPlaceholder")}
          prefix={<SearchOutlined />}
          style={{ width: 260 }}
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
        />
      </div>

      {loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <Empty description={t("materials.files.empty")} />
      ) : (
        <Table
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={rows}
          pagination={pagination}
        />
      )}

      <Drawer
        title={pdfPreview?.original_name || t("materials.files.pdfPreviewTitle")}
        open={pdfPreview !== null}
        size={720}
        onClose={() => setPdfPreview(null)}
        destroyOnHidden
      >
        {pdfPreview && (
          <iframe
            title={pdfPreview.original_name}
            src={userFileRawUrl(pdfPreview.id)}
            style={{ width: "100%", height: "80vh", border: "none" }}
          />
        )}
      </Drawer>
    </div>
  );
}
