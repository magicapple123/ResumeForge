import { Alert, App, Button, Input, Modal, Select, Space, Table, Tag } from "antd";
import { useState } from "react";
import { downloadDelivery, listDeliveryArchive } from "../../api/resumes";
import { useApi } from "../../hooks/useApi";
import type { DeliverySummary } from "../../types";
import { downloadBlob } from "../../utils/download";

export default function DeliveryArchiveModal({ onClose }: { onClose: () => void }) {
  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [source, setSource] = useState("");
  const [downloading, setDownloading] = useState<number | null>(null);
  const { data, loading, error, reload } = useApi(
    () => listDeliveryArchive({ page, page_size: 10, keyword, source }),
    [page, keyword, source],
  );
  const download = async (item: DeliverySummary) => {
    if (downloading !== null) return;
    setDownloading(item.id);
    try {
      const result = await downloadDelivery(item.id);
      downloadBlob(result.blob, result.filename);
      message.success(
        result.replayed
          ? "已按存档内容重新生成文件；并非保证字节相同的原件"
          : "已下载冻结的交付内容",
      );
    } catch (err) {
      message.error(err instanceof Error ? err.message : "下载失败");
    } finally {
      setDownloading(null);
    }
  };
  return (
    <Modal open title="交付存档" onCancel={onClose} footer={null} width={850}>
      <Alert
        type="info"
        showIcon
        title="原简历删除后仍可查找历史存档"
        description="回收站的彻底删除不清除交付快照、附件副本或已有备份。存档用于核对历史内容；重新生成不等同于取回原始文件字节。"
        style={{ marginBottom: 16 }}
      />
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          aria-label="搜索交付存档"
          placeholder="简历标题、公司或岗位"
          allowClear
          onSearch={(value) => {
            setKeyword(value);
            setPage(1);
          }}
        />
        <Select
          aria-label="交付来源"
          value={source}
          style={{ width: 150 }}
          onChange={(value) => {
            setSource(value);
            setPage(1);
          }}
          options={[
            { value: "", label: "全部来源" },
            { value: "apply", label: "投递台" },
            { value: "track", label: "进度关联" },
            { value: "export", label: "导出存档" },
          ]}
        />
        <Button onClick={() => void reload()}>刷新</Button>
      </Space>
      {error && (
        <Alert
          type="error"
          title="交付存档加载失败"
          description={error}
          style={{ marginBottom: 12 }}
        />
      )}
      <Table<DeliverySummary>
        rowKey="id"
        loading={loading}
        dataSource={data?.items ?? []}
        scroll={{ x: 600 }}
        pagination={{
          current: page,
          pageSize: 10,
          total: data?.total ?? 0,
          showSizeChanger: false,
          onChange: setPage,
        }}
        columns={[
          { title: "简历", dataIndex: "resume_title", ellipsis: true },
          {
            title: "目的地",
            render: (_, item) =>
              `${item.company || "公司未记录"} · ${item.job_title || "岗位未记录"}`,
          },
          {
            title: "来源",
            render: (_, item) => (
              <Tag>
                {(
                  { apply: "投递台", track: "进度关联", export: "导出存档" } as Record<
                    string,
                    string
                  >
                )[item.source] ?? "历史记录"}
              </Tag>
            ),
          },
          { title: "日期", render: (_, item) => new Date(item.created_at).toLocaleDateString() },
          {
            title: "操作",
            render: (_, item) => (
              <Button
                size="small"
                loading={downloading === item.id}
                onClick={() => void download(item)}
              >
                下载存档
              </Button>
            ),
          },
        ]}
      />
    </Modal>
  );
}
