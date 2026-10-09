/** 用户文件副本面板：数据库内用户文件（附件、照片、截图）在磁盘上的副本清单。
 *
 * 每一行提供：图片缩略图（antd Image 点开放大）、pdf 的抽屉内嵌预览，以及
 * 「打开文件夹」（后端在文件管理器里定位到副本文件）。
 */

import { FolderOpenOutlined, SearchOutlined } from "@ant-design/icons";
import { App, Button, Drawer, Empty, Image, Input, Table, Tag, Typography } from "antd";
import LoadingBlock from "../common/LoadingBlock";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
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

/** 来源标注 → 界面文案（与后端 user_files 服务的 source_type 一致）。 */
const SOURCE_LABELS: Record<string, string> = {
  material: "资料箱",
  photo: "个人照片",
  job_note: "岗位备注图",
  candidate_image: "备选岗位截图",
  chat_attachment: "助手附件",
};

const PAGE_SIZE = 20;

function sourceLabel(item: UserFileItem): string {
  return SOURCE_LABELS[item.source_type] ?? (item.source_type || "未知来源");
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
      message.error(error instanceof Error ? error.message : "加载文件副本失败");
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
      message.success("已打开所在文件夹");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "打开文件夹失败");
    } finally {
      setOpeningId(null);
    }
  };

  const columns: ColumnsType<UserFileItem> = [
    {
      title: "名称",
      dataIndex: "original_name",
      ellipsis: true,
      render: (_: unknown, item: UserFileItem) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {canPreviewImage(item.mime) ? (
            <Image src={userFileRawUrl(item.id)} alt={item.original_name} width={40} height={40} />
          ) : null}
          <Typography.Text ellipsis>{item.original_name || "（未命名）"}</Typography.Text>
        </div>
      ),
    },
    {
      title: "类型",
      dataIndex: "mime",
      width: 180,
      render: (mime: string) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {mime}
        </Typography.Text>
      ),
    },
    {
      title: "大小",
      dataIndex: "size",
      width: 90,
      render: (size: number) => formatSize(size),
    },
    {
      title: "来源",
      dataIndex: "source_type",
      width: 150,
      render: (_: unknown, item: UserFileItem) => <Tag color="blue">{sourceLabel(item)}</Tag>,
    },
    {
      title: "保存时间",
      dataIndex: "created_at",
      width: 160,
      render: (value: string | null) => (
        <Typography.Text type="secondary">{formatDateTime(value ?? undefined)}</Typography.Text>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 170,
      render: (_: unknown, item: UserFileItem) => (
        <div style={{ display: "flex", gap: 4 }}>
          {isPdf(item) && (
            <Button type="link" size="small" onClick={() => setPdfPreview(item)}>
              预览
            </Button>
          )}
          <Button
            type="link"
            size="small"
            icon={<FolderOpenOutlined />}
            loading={openingId === item.id}
            onClick={() => void revealInFolder(item)}
          >
            打开文件夹
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
    showTotal: (count) => `共 ${count} 份`,
    onChange: (next) => setPage(next),
  };

  return (
    <div className="user-files-panel">
      <div style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          placeholder="搜索文件名"
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
        <Empty description="暂无文件副本" />
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
        title={pdfPreview?.original_name || "PDF 预览"}
        open={pdfPreview !== null}
        width={720}
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
