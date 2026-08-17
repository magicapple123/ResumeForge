/** 岗位广场：搜索筛选、手动添加、详情与生成简历入口。 */
import { PlusOutlined } from "@ant-design/icons";
import { App, Button, Input, Popconfirm, Select, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { deleteJob, listJobs } from "../api/jobs";
import GenerateResumeModal from "../components/GenerateResumeModal";
import JobDetailDrawer from "../components/JobDetailDrawer";
import JobFormModal from "../components/JobFormModal";
import SkillTags from "../components/SkillTags";
import { useApi } from "../hooks/useApi";
import type { Job } from "../types";
import { formatDateTime } from "../utils/format";

const JOB_TYPE_OPTIONS = ["校招", "实习", "社招", "其他"].map((value) => ({ value, label: value }));
const STATUS_OPTIONS = ["开放中", "已截止", "已投递"].map((value) => ({ value, label: value }));

export default function JobsPage() {
  const [searchParams] = useSearchParams();
  const { message } = App.useApp();

  const [keyword, setKeyword] = useState(searchParams.get("keyword") ?? "");
  const [jobType, setJobType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [detailJob, setDetailJob] = useState<Job | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [generateJob, setGenerateJob] = useState<Job | null>(null);

  const { data: jobs, loading, reload, error } = useApi(
    () => listJobs({ keyword, job_type: jobType, status, page, page_size: pageSize }),
    [keyword, jobType, status, page, pageSize],
  );

  useEffect(() => {
    if (error) message.error(error);
  }, [error, message]);

  const removeJob = useCallback(
    async (id: number) => {
      try {
        await deleteJob(id);
        message.success("岗位已删除");
        void reload();
      } catch (err) {
        message.error(err instanceof Error ? err.message : "删除失败");
      }
    },
    [message, reload],
  );

  const columns: ColumnsType<Job> = [
    {
      title: "职位",
      dataIndex: "title",
      width: 260,
      render: (_, job) => (
        <div>
          <Typography.Link onClick={() => setDetailJob(job)}>{job.title}</Typography.Link>
          <div style={{ marginTop: 4 }}>
            <SkillTags tags={job.keywords} max={4} />
          </div>
        </div>
      ),
    },
    { title: "公司", dataIndex: "company", width: 130, render: (value) => value || "-" },
    { title: "城市", dataIndex: "location", width: 90, render: (value) => value || "-" },
    { title: "薪资", dataIndex: "salary", width: 130, render: (value) => value || "-" },
    { title: "类型", dataIndex: "job_type", width: 80 },
    {
      title: "更新时间",
      dataIndex: "created_at",
      width: 150,
      render: (value) => formatDateTime(value),
    },
    {
      title: "操作",
      key: "actions",
      width: 220,
      render: (_, job) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => setDetailJob(job)}>
            详情
          </Button>
          <Button type="link" size="small" onClick={() => setGenerateJob(job)}>
            生成简历
          </Button>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setEditingJob(job);
              setFormOpen(true);
            }}
          >
            编辑
          </Button>
          <Popconfirm title="确定删除该岗位？" onConfirm={() => void removeJob(job.id)}>
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
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder="搜索职位 / 公司 / 城市"
          allowClear
          style={{ width: 260 }}
          defaultValue={keyword}
          onSearch={(value) => {
            setKeyword(value);
            setPage(1);
          }}
        />
        <Select
          placeholder="类型"
          allowClear
          style={{ width: 110 }}
          value={jobType || undefined}
          onChange={(value) => {
            setJobType(value ?? "");
            setPage(1);
          }}
          options={JOB_TYPE_OPTIONS}
        />
        <Select
          placeholder="状态"
          allowClear
          style={{ width: 110 }}
          value={status || undefined}
          onChange={(value) => {
            setStatus(value ?? "");
            setPage(1);
          }}
          options={STATUS_OPTIONS}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setFormOpen(true)}>
          手动添加
        </Button>
      </Space>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={jobs?.items ?? []}
        loading={loading}
        pagination={{
          current: page,
          pageSize,
          total: jobs?.total ?? 0,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 个岗位`,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          },
        }}
      />

      <JobDetailDrawer
        job={detailJob}
        onClose={() => setDetailJob(null)}
        onGenerate={(job) => setGenerateJob(job)}
      />
      <JobFormModal
        open={formOpen}
        initial={editingJob}
        onClose={() => {
          setFormOpen(false);
          setEditingJob(null);
        }}
        onSaved={() => void reload()}
      />
      <GenerateResumeModal job={generateJob} onClose={() => setGenerateJob(null)} />
    </div>
  );
}
