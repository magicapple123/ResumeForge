import { FolderOpenOutlined, LinkOutlined } from "@ant-design/icons";
import { App, Button, Descriptions, Divider, Image, Modal, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { lookupUserFiles, openUserFile } from "../../api/userFiles";
import type { CandidateJobDetail } from "../../types";

interface Props {
  candidate: CandidateJobDetail | null;
  loading: boolean;
  onClose: () => void;
  onImport: (candidate: CandidateJobDetail) => void;
  onEdit: (candidate: CandidateJobDetail) => void;
}

/** 备选岗位的详情：卡片只放摘要，正文在这里按需读取，避免列表随着 JD 变大。 */
export default function CandidateJobDetailModal({
  candidate,
  loading,
  onClose,
  onImport,
  onEdit,
}: Props) {
  const { message } = App.useApp();
  const [openingIndex, setOpeningIndex] = useState<number | null>(null);

  // 截图在保存时已按数组顺序落了磁盘副本（source_ref=candidate_job:<id>）；反查
  // 结果按 id 升序，与保存顺序一致，因此按 index 对应到原图的副本。
  const openCopy = async (index: number) => {
    if (!candidate) return;
    setOpeningIndex(index);
    try {
      const result = await lookupUserFiles({
        source_type: "candidate_image",
        source_ref: `candidate_job:${candidate.id}`,
      });
      const target = result.items[index];
      if (!target) {
        message.warning("未找到对应的文件副本");
        return;
      }
      await openUserFile(target.id);
      message.success("已调用系统程序打开");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "打开失败");
    } finally {
      setOpeningIndex(null);
    }
  };

  return (
    <Modal
      title={candidate?.title || "备选岗位详情"}
      open={candidate !== null || loading}
      confirmLoading={loading}
      onCancel={onClose}
      footer={
        candidate ? (
          <Space>
            <Button onClick={() => onEdit(candidate)}>编辑</Button>
            {candidate.status === "pending" && (
              <Button type="primary" onClick={() => onImport(candidate)}>
                导入到岗位
              </Button>
            )}
          </Space>
        ) : null
      }
      width={760}
      // 岗位原文可能很长：限高让超长内容只滚弹窗内部，卡片整体不出视口。
      styles={{
        body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto", overflowX: "hidden" },
      }}
    >
      {candidate && (
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="公司">{candidate.company || "未识别公司"}</Descriptions.Item>
            <Descriptions.Item label="地点">{candidate.location || "-"}</Descriptions.Item>
            <Descriptions.Item label="薪资">{candidate.salary || "-"}</Descriptions.Item>
            <Descriptions.Item label="来源">
              <Space>
                <Tag>{candidate.source || "未知来源"}</Tag>
                {candidate.status === "imported" ? (
                  <Tag color="green">已导入 #{candidate.imported_job_id ?? ""}</Tag>
                ) : (
                  <Tag color="orange">待处理</Tag>
                )}
              </Space>
            </Descriptions.Item>
            {candidate.source_url && (
              <Descriptions.Item label="原岗位链接">
                <Typography.Link
                  href={candidate.source_url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <LinkOutlined /> 开原站岗位页面
                </Typography.Link>
              </Descriptions.Item>
            )}
          </Descriptions>

          {candidate.description && (
            <section>
              <Typography.Title level={5}>职位描述</Typography.Title>
              <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
                {candidate.description}
              </Typography.Paragraph>
            </section>
          )}
          {candidate.requirements && (
            <section>
              <Typography.Title level={5}>任职要求</Typography.Title>
              <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
                {candidate.requirements}
              </Typography.Paragraph>
            </section>
          )}
          {candidate.additional_info && (
            <section>
              <Typography.Title level={5}>其他招聘信息</Typography.Title>
              <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
                {candidate.additional_info}
              </Typography.Paragraph>
            </section>
          )}
          {candidate.raw_text && (
            <section>
              <Typography.Title level={5}>招聘原文</Typography.Title>
              <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
                {candidate.raw_text}
              </Typography.Paragraph>
            </section>
          )}
          {candidate.images.length > 0 && (
            <section>
              <Typography.Title level={5}>招聘截图</Typography.Title>
              <Space wrap>
                {candidate.images.map((source, index) => (
                  <div key={`${index}-${source.slice(-16)}`} style={{ textAlign: "center" }}>
                    <Image src={source} width={160} />
                    <div>
                      <Button
                        type="link"
                        size="small"
                        icon={<FolderOpenOutlined />}
                        loading={openingIndex === index}
                        onClick={() => void openCopy(index)}
                      >
                        打开
                      </Button>
                    </div>
                  </div>
                ))}
              </Space>
            </section>
          )}
          {candidate.note && (
            <>
              <Divider style={{ margin: "4px 0" }} />
              <Typography.Text type="secondary">备注：{candidate.note}</Typography.Text>
            </>
          )}
        </Space>
      )}
    </Modal>
  );
}
