// SPDX-License-Identifier: Apache-2.0
/**
 * 「我的资料」页里的通用简历区块。
 *
 * 通用简历**不关联任何岗位**（`job_id` 为空），用于跨行业投递。它必须放在资料表单
 * 之外：写简历不是改资料，这个区块在非编辑状态下也要能用。
 */

import { FileSearchOutlined, PlusOutlined } from "@ant-design/icons";
import { App, Button, Card, Input, Listy, Space, Tag, Typography } from "antd";
import EmptyState from "../common/EmptyState";
import LoadingBlock from "../common/LoadingBlock";
import { useEffect, useState } from "react";
import { RowActions } from "../common/RowActions";
import { deleteResume, listResumes, renameResume } from "../../api/resumes";
import type { ResumeBrief } from "../../types";
import { formatDateTime } from "../../utils/format";
import ResumeDetailModal from "../ResumeDetailModal";
import { useResumeListVersion } from "../../features/resume/resumeListEvents";
import { ListyItem, ListyMeta } from "../common/ListyItem";

const PAGE_SIZE = 50;

interface Props {
  /** 点「AI 生成」直接打开生成弹窗（名称在弹窗里填，页面不再放常驻输入框）。 */
  onGenerate: () => void;
  /** 点「从头手写」直接打开编辑器（名称在编辑器顶部填）。 */
  onWrite: () => void;
}

export default function GeneralResumeSection({ onGenerate, onWrite }: Props) {
  const { message } = App.useApp();
  const [items, setItems] = useState<ResumeBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewId, setPreviewId] = useState<number | null>(null);
  /** 正在就地编辑名称的那一行（不是"正在保存"——两者混用会让保存被守卫挡掉）。 */
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const page = await listResumes({ has_job: false, page: 1, page_size: PAGE_SIZE });
      setItems(page.items);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载通用简历失败");
    } finally {
      setLoading(false);
    }
  };

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）。
  // 进入页面时加载一次；之后的增删改由 `resumeListEvents` 广播（见下），本区块不再
  // 依赖"各操作记得回来 reload"。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const page = await listResumes({ has_job: false, page: 1, page_size: PAGE_SIZE });
        if (!cancelled) setItems(page.items);
      } catch (err) {
        if (!cancelled) message.error(err instanceof Error ? err.message : "加载通用简历失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在进入页面时加载一次
  }, []);

  // T12：别处保存/删除手写简历后广播版本号，这里跟着重取。
  // 版本为 0 表示"本次会话还没有过广播"——跳过，避免与上面那次挂载加载撞成双请求。
  const resumeListVersion = useResumeListVersion();
  useEffect(() => {
    if (resumeListVersion === 0) return;
    // 这里刻意继续走 `load()`：它第一句就是同步的 `setLoading(true)`，于是刷新期间
    // 列表会显示加载态。改写成"内联 IIFE + await 之后 setState"虽然能消掉这条告警，
    // 但会把加载态一起消掉——那是用户可见的行为变化。所以在这一行做单点豁免。
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() 首句的 setLoading(true) 是"刷新中"的唯一来源
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load 每次渲染都是新函数，只跟版本走
  }, [resumeListVersion]);

  const confirmRename = async (record: ResumeBrief) => {
    if (savingRename) return;
    const nextTitle = renameValue.trim();
    if (!nextTitle) {
      message.warning("名称不能为空");
      return;
    }
    setSavingRename(true);
    try {
      await renameResume(record.id, nextTitle);
      setItems((current) =>
        current.map((item) => (item.id === record.id ? { ...item, title: nextTitle } : item)),
      );
      message.success("已重命名");
      setRenameValue("");
      setRenamingId(null);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "重命名失败");
    } finally {
      setSavingRename(false);
    }
  };

  const remove = async (record: ResumeBrief) => {
    if (deletingId !== null) return;
    setDeletingId(record.id);
    try {
      await deleteResume(record.id);
      setItems((current) => current.filter((item) => item.id !== record.id));
      message.success(`已移入回收站：「${record.title}」`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <Card id="general-resume-section" title="通用简历" className="profile-general-resume">
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          通用简历<strong>不针对任何岗位</strong>
          ，用来投给方向还不确定的机会。生成时会完整使用你的资料（各方向的经历、校园经历、项目、
          技能和奖项都保留，只受单份简历的篇幅限制），也可以从空白开始自己写。它们同时会出现在简历中心。
        </Typography.Paragraph>

        {/* 项 11：不再放常驻的「新简历名称」输入框——名字在弹窗/编辑器里填，
            留空由后端自动命名。页面上只留两个入口，视觉上也少一个无主的空框。 */}
        <Space wrap style={{ marginBottom: 8 }}>
          <Button type="primary" icon={<FileSearchOutlined />} onClick={() => onGenerate()}>
            AI 生成
          </Button>
          <Button icon={<PlusOutlined />} onClick={() => onWrite()}>
            从头手写
          </Button>
        </Space>

        {/* List 的 loading 是内容外层的 Spin；空态单独渲染（与原 locale.emptyText 等价）。 */}
        <LoadingBlock spinning={loading}>
          {items.length === 0 ? (
            <EmptyState inline description="还没有通用简历" />
          ) : (
            <Listy
              items={items}
              rowKey={(record) => record.id}
              itemRender={(record) => (
                <ListyItem
                  actions={[
                    // 编辑/删除收进「···」菜单：删除不再以红图标裸露在行内（全局约定）。
                    <RowActions
                      key="more"
                      disabled={renamingId !== null || deletingId !== null}
                      more={[
                        {
                          key: "rename",
                          label: "重命名",
                          onClick: () => {
                            setRenameValue(record.title);
                            setRenamingId(record.id);
                          },
                        },
                        {
                          key: "delete",
                          label: "删除",
                          danger: true,
                          // 实际行为是移入回收站（remove 内部会提示"已移入回收站"），
                          // 确认文案必须与行为一致，不能吓唬"无法恢复"。
                          confirm: `删除「${record.title}」？简历正文会一起删除，之后可在回收站找回。`,
                          onClick: () => void remove(record),
                        },
                      ]}
                    />,
                  ]}
                >
                  {renamingId === record.id ? (
                    <Space.Compact style={{ width: "100%" }}>
                      <Input
                        aria-label="重命名输入框"
                        value={renameValue}
                        maxLength={64}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onPressEnter={() => void confirmRename(record)}
                      />
                      <Button
                        type="primary"
                        loading={savingRename}
                        onClick={() => void confirmRename(record)}
                      >
                        保存
                      </Button>
                      <Button
                        onClick={() => {
                          setRenamingId(null);
                          setRenameValue("");
                        }}
                      >
                        取消
                      </Button>
                    </Space.Compact>
                  ) : (
                    <ListyMeta
                      title={
                        <Button
                          type="link"
                          style={{ padding: 0 }}
                          onClick={() => setPreviewId(record.id)}
                        >
                          {record.title}
                        </Button>
                      }
                      description={
                        <>
                          <Tag color="purple">通用简历</Tag>
                          {record.job_title ? `求职意向：${record.job_title}` : "未填写求职意向"}
                          {record.created_at ? ` · ${formatDateTime(record.created_at)}` : ""}
                        </>
                      }
                    />
                  )}
                </ListyItem>
              )}
            />
          )}
        </LoadingBlock>
      </Card>

      <ResumeDetailModal
        recordId={previewId}
        onClose={() => {
          setPreviewId(null);
          void load();
        }}
      />
    </>
  );
}
