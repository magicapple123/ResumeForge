/** 简历中心：生成历史列表、预览与导出。 */
import { App, Button, Input, Popconfirm, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { deleteResume, listResumes } from "../api/resumes";
import ResumeDetailModal from "../components/ResumeDetailModal";
import { RESUME_TONES } from "../config";
import { useApi } from "../hooks/useApi";
import type { ResumeBrief } from "../types";
import { formatDateTime } from "../utils/format";

export default function ResumesPage() {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [previewId, setPreviewId] = useState<number | null>(null);

  const { data, loading, reload, error } = useApi(
    () => listResumes({ keyword, page, page_size: pageSize }),
    [keyword, page, pageSize],
  );

  useEffect(() => {
    if (error) message.error(error);
  }, [error, message]);

  const remove = useCallback(
    async (id: number) => {
      try {
        await deleteResume(id);
        message.success("已删除");
        void reload();
      } catch (err) {
        message.error(err instanceof Error ? err.message : "删除失败");
      }
    },
    [message, reload],
  );

  const columns: ColumnsType<ResumeBrief> = [
    {
      title: "简历标题",
      dataIndex: "title",
      render: (_, record) => (
        <Typography.Link onClick={() => setPreviewId(record.id)}>{record.title}</Typography.Link>
      ),
    },
    {
      title: "目标岗位",
      key: "job",
      render: (_, record) => (
        <Space>
          <Tag color="blue">{record.job_title || "-"}</Tag>
          {record.company && <Tag>{record.company}</Tag>}
        </Space>
      ),
    },
    { title: "模型", dataIndex: "model", width: 150, render: (value) => value || "-" },
    {
      title: "风格",
      dataIndex: "tone",
      width: 110,
      render: (value) => RESUME_TONES.find((tone) => tone.value === value)?.label ?? value,
    },
    {
      title: "生成时间",
      dataIndex: "created_at",
      width: 160,
      render: (value) => formatDateTime(value),
    },
    {
      title: "操作",
      key: "actions",
      width: 140,
      render: (_, record) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => setPreviewId(record.id)}>
            预览 / 导出
          </Button>
          <Popconfirm title="确定删除这条记录？" onConfirm={() => void remove(record.id)}>
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Input.Search
        placeholder="搜索简历记录"
        allowClear
        style={{ width: 300, marginBottom: 16 }}
        onSearch={(value) => {
          setKeyword(value);
          setPage(1);
        }}
      />
      <Table
        rowKey="id"
        columns={columns}
        dataSource={data?.items ?? []}
        loading={loading}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条记录`,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          },
        }}
      />
      <ResumeDetailModal recordId={previewId} onClose={() => setPreviewId(null)} />
    </div>
  );
}
