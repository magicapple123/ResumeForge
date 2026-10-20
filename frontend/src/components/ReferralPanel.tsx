// SPDX-License-Identifier: Apache-2.0
/** 内推管理（R-13）：内推列表、增删改 + 顶部转化率小卡 + 内推码/图片备注/状态分色。
 *
 * ``converted`` 由后端按关联漏斗后置位派生，前端只展示、不自己算口径。顶部转化率卡展示
 * 有效内推总数、已转化数与转化率。备注图片先上传拿相对路径，再随表单写入 ``note_images``。
 */
import {
  CheckSquareOutlined,
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Checkbox,
  Dropdown,
  Empty,
  Form,
  Input,
  Listy,
  Modal,
  Pagination,
  Select,
  Space,
  Tag,
  Typography,
  Upload,
} from "antd";
import LoadingBlock from "./common/LoadingBlock";
import { useCallback, useEffect, useState } from "react";
import {
  batchDeleteReferrals,
  createReferral,
  deleteReferral,
  getReferralStats,
  listReferralsPage,
  updateReferral,
  uploadReferralImage,
} from "../api/referrals";
import { REFERRAL_STATUS_COLORS, REFERRAL_STATUS_LABELS, referralImageUrl } from "../types";
import type { Referral, ReferralPayload, ReferralStats, ReferralStatus } from "../types";
import { classifyAttachment, MAX_ATTACHMENT_BYTES } from "../utils/attachments";
import ReferralStatsCard from "./referral/ReferralStatsCard";
import ReferralFormFields from "./referral/ReferralFormFields";
import ReferralDetailDrawer from "./referral/ReferralDetailDrawer";
import { REFERRAL_STATUS_LABELS_OPTIONS } from "./referral/ReferralFormFields";
import { MAX_NOTE_IMAGES } from "./referral/ReferralFormFields";
import { isFromInnerControl } from "./common/recordDetailCore";
import { ListyItem, ListyMeta } from "./common/ListyItem";
import { useRowActionMenu } from "./common/rowActionMenu";
import BatchActionBar from "./common/BatchActionBar";
import BatchDeleteButton from "./common/BatchDeleteButton";
import { useBatchSelection } from "../hooks/useBatchSelection";
import { RowContextMenu } from "./common/RowActions";

/** 每页条数：与后端 /referrals/page 端点默认值一致。 */
const REFERRAL_PAGE_SIZE = 10;

export default function ReferralPanel() {
  const { message } = App.useApp();
  // 批量选择：勾选若干条后一次删除（软删，全部进回收站）；列表是服务端分页，
  // 选区即当前页已加载的条目（pageSelectAll 只作用于当前页）。
  const batch = useBatchSelection<number>();
  const [items, setItems] = useState<Referral[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | undefined>();
  const [keyword, setKeyword] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Referral | null>(null);
  const [detail, setDetail] = useState<Referral | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  // 备注图上传进度（0-100；null 表示不在上传中），在表单上传按钮旁画进度条。
  const [imageUploadPercent, setImageUploadPercent] = useState<number | null>(null);
  const [noteImages, setNoteImages] = useState<string[]>([]);
  const [form] = Form.useForm<ReferralPayload>();
  const buildMenu = useRowActionMenu();
  // 编辑时的已绑定岗位 / 漏斗 id（P0-1）：传给 ReferralFormFields 做 ensure-on-edit。
  const [initialJobId, setInitialJobId] = useState<number | null>(null);
  const [initialTrackId, setInitialTrackId] = useState<number | null>(null);

  // 纯取数（不含 setState）：effect 内联调用时 Compiler 才能验证非同步更新；
  // 返回 null 表示失败（错误提示在这里统一给出）。
  const fetchList = useCallback(async () => {
    try {
      return await listReferralsPage(
        { status: status || undefined, keyword: keyword.trim() },
        page,
        REFERRAL_PAGE_SIZE,
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取内推失败");
      return null;
    }
  }, [status, keyword, page, message]);

  const fetchStats = useCallback(async () => {
    try {
      return await getReferralStats();
    } catch {
      // 统计卡失败不打断列表，静默即可（stats 保持原值）。
      return null;
    }
  }, []);

  // Compiler 规范：deps 变化的 loading 置位用渲染期守卫；应用状态放在 .then 回调。
  const [prevListKey, setPrevListKey] = useState<string | null>(null);
  const listKey = `${status}:${keyword}:${page}`;
  if (prevListKey !== listKey) {
    setPrevListKey(listKey);
    setLoading(true);
  }

  // 筛选条件变化时回第 1 页（渲染期守卫式调整，Compiler 规范）；翻页不改筛选键。
  const filterKey = `${status}:${keyword}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  useEffect(() => {
    let cancelled = false;
    void fetchList().then((pageData) => {
      if (cancelled) return;
      if (pageData !== null) {
        setItems(pageData.items);
        setTotal(pageData.total);
      }
      setLoading(false);
    });
    void fetchStats().then((stats) => {
      if (cancelled || stats === null) return;
      setStats(stats);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchList, fetchStats, listKey]);

  // 事件路径（保存/删除后的整表重拉，含 loading 翻动）。
  const loadList = useCallback(async () => {
    setLoading(true);
    const pageData = await fetchList();
    if (pageData !== null) {
      setItems(pageData.items);
      setTotal(pageData.total);
    }
    setLoading(false);
  }, [fetchList]);

  // 事件路径（数据变动后的统计卡刷新，静默失败）。
  const loadStats = useCallback(async () => {
    const stats = await fetchStats();
    if (stats !== null) setStats(stats);
  }, [fetchStats]);

  const openCreate = () => {
    setEditing(null);
    setInitialJobId(null);
    setInitialTrackId(null);
    setNoteImages([]);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (item: Referral) => {
    setEditing(item);
    setInitialJobId(item.job_id ?? null);
    setInitialTrackId(item.track_id ?? null);
    setNoteImages(item.note_images ?? []);
    form.setFieldsValue({
      company: item.company,
      position: item.position,
      job_title: item.job_title,
      referrer_name: item.referrer_name,
      referrer_contact: item.referrer_contact,
      relation: item.relation,
      channel: item.channel,
      status: item.status as ReferralStatus,
      job_id: item.job_id ?? undefined,
      track_id: item.track_id ?? undefined,
      submitted_at: item.submitted_at,
      note: item.note,
      referral_code: item.referral_code,
    });
    setModalOpen(true);
  };

  const removeImage = (path: string) => {
    setNoteImages((prev) => prev.filter((item) => item !== path));
  };

  const beforeImageUpload = async (file: File) => {
    const classified = classifyAttachment(file);
    if (!classified || classified.kind !== "image") {
      message.error("只能上传 png/jpg/webp/gif/bmp/tiff 图片");
      return Upload.LIST_IGNORE;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      message.error("单张图片不能超过 2 MB");
      return Upload.LIST_IGNORE;
    }
    if (noteImages.length >= MAX_NOTE_IMAGES) {
      message.error(`最多上传 ${MAX_NOTE_IMAGES} 张备注图片`);
      return Upload.LIST_IGNORE;
    }
    setUploadingImages(true);
    setImageUploadPercent(0);
    try {
      const { path } = await uploadReferralImage(file, (percent) => setImageUploadPercent(percent));
      setNoteImages((prev) => [...prev, path]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "上传图片失败");
    } finally {
      setUploadingImages(false);
      setImageUploadPercent(null);
    }
    // 阻止 antd 的默认上传：文件已由 uploadReferralImage 落盘。
    return Upload.LIST_IGNORE;
  };

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    const payload: ReferralPayload = {
      ...values,
      job_id: values.job_id ?? null,
      track_id: values.track_id ?? null,
      referral_code: values.referral_code ?? "",
      note_images: noteImages,
    };
    try {
      if (editing) await updateReferral(editing.id, payload);
      else await createReferral(payload);
      message.success(editing ? "已更新内推" : "已新增内推");
      setModalOpen(false);
      await loadList();
      await loadStats();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存内推失败");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: Referral) => {
    try {
      await deleteReferral(item.id);
      message.success("已删除");
      await loadList();
      await loadStats();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  /** 批量删除：一次请求删完（软删），成功后清空选择并刷新列表与统计。 */
  const removeSelected = async () => {
    const ids = [...batch.selectedIds];
    if (ids.length === 0) return;
    try {
      const { deleted } = await batchDeleteReferrals(ids);
      message.success(`已删除 ${deleted} 条内推，可在「回收站」里恢复`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "批量删除失败，请重试");
    }
    batch.exitSelecting();
    await loadList();
    await loadStats();
  };

  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
      <ReferralStatsCard stats={stats} />

      <Card size="small" title="内推记录">
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="搜索公司 / 岗位 / 内推人"
            style={{ width: 240 }}
            onSearch={(value) => setKeyword(value)}
          />
          <Select
            allowClear
            placeholder="状态筛选"
            style={{ minWidth: 140 }}
            value={status}
            onChange={setStatus}
            options={REFERRAL_STATUS_LABELS_OPTIONS()}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增内推
          </Button>
        </Space>
      </Card>

      {batch.selecting && (
        <BatchActionBar
          count={batch.selectedCount}
          onExit={batch.exitSelecting}
          pageSelectAll={{
            allSelected: items.length > 0 && items.every((item) => batch.isSelected(item.id)),
            someSelected: items.some((item) => batch.isSelected(item.id)),
            onToggle: (checked) =>
              batch.selectPage(
                items.map((item) => item.id),
                checked,
              ),
          }}
        >
          <BatchDeleteButton count={batch.selectedCount} noun="条内推" onDelete={removeSelected} />
        </BatchActionBar>
      )}

      {loading ? (
        <LoadingBlock />
      ) : items.length === 0 ? (
        <Empty description="还没有内推记录，把找人内推的机会记下来吧" />
      ) : (
        <>
          <Listy
            items={items}
            rowKey={(item) => item.id}
            itemRender={(item) => (
              <ListyItem
                className="detail-trigger"
                // 整条可点开详情；内层的「详情 / 更多」按钮不会被这一层抢走。
                onClick={(event) => {
                  if (isFromInnerControl(event)) return;
                  setDetail(item);
                }}
                actions={[
                  batch.selecting ? (
                    <Checkbox
                      key="select"
                      aria-label={`选择内推 ${item.referrer_name || item.position}`}
                      checked={batch.isSelected(item.id)}
                      onChange={() => batch.toggle(item.id)}
                    />
                  ) : (
                    <Button key="detail" type="link" size="small" onClick={() => setDetail(item)}>
                      详情
                    </Button>
                  ),
                  ...(batch.selecting
                    ? []
                    : [
                        <Dropdown
                          key="more"
                          trigger={["click"]}
                          menu={{
                            items: buildMenu([
                              {
                                key: "edit",
                                label: "编辑",
                                icon: <EditOutlined />,
                                onClick: () => openEdit(item),
                              },
                              {
                                key: "delete",
                                label: "删除",
                                danger: true,
                                icon: <DeleteOutlined />,
                                confirm: "删除这条内推？删除后可在回收站里找回。",
                                onClick: () => void remove(item),
                              },
                            ]),
                          }}
                        >
                          <Button
                            type="text"
                            size="small"
                            icon={<MoreOutlined />}
                            aria-label={`更多操作 ${item.referrer_name || item.position}`}
                          />
                        </Dropdown>,
                      ]),
                ]}
              >
                {/* 右键菜单挂在条目主体上：多选模式收起（入口只在正常模式的菜单里）。 */}
                <RowContextMenu
                  items={
                    batch.selecting
                      ? []
                      : [
                          {
                            key: "batch_select",
                            label: "批量选择",
                            icon: <CheckSquareOutlined />,
                            onClick: batch.enterSelecting,
                          },
                        ]
                  }
                >
                  <div>
                    <ListyMeta
                      title={
                        <Space size={6} wrap>
                          <span>
                            {item.referrer_name || "未记内推人"}
                            {item.position ? ` · ${item.position}` : ""}
                          </span>
                          <Tag
                            color={
                              REFERRAL_STATUS_COLORS[item.status as ReferralStatus] ?? "default"
                            }
                          >
                            {REFERRAL_STATUS_LABELS[item.status as ReferralStatus] ?? item.status}
                          </Tag>
                          {item.converted && <Tag color="green">已转化</Tag>}
                        </Space>
                      }
                      description={
                        <Space orientation="vertical" size={2} style={{ width: "100%" }}>
                          <Typography.Text type="secondary">
                            {item.company}
                            {item.relation ? ` · ${item.relation}` : ""}
                            {item.channel ? ` · ${item.channel}` : ""}
                          </Typography.Text>
                          {item.referral_code && (
                            <Typography.Text type="secondary">
                              内推码：{item.referral_code}
                            </Typography.Text>
                          )}
                          {item.note && (
                            <Typography.Text type="secondary">{item.note}</Typography.Text>
                          )}
                          {(item.note_images ?? []).length > 0 && (
                            <Space size={4} wrap>
                              {(item.note_images ?? []).map((path) => (
                                <img
                                  key={path}
                                  src={referralImageUrl(path)}
                                  alt="备注图"
                                  style={{
                                    width: 32,
                                    height: 32,
                                    objectFit: "cover",
                                    borderRadius: 3,
                                  }}
                                />
                              ))}
                            </Space>
                          )}
                        </Space>
                      }
                    />
                  </div>
                </RowContextMenu>
              </ListyItem>
            )}
          />

          <div style={{ textAlign: "right", marginTop: 12 }}>
            <Pagination
              current={page}
              pageSize={REFERRAL_PAGE_SIZE}
              total={total}
              onChange={setPage}
              hideOnSinglePage
              showSizeChanger={false}
              showTotal={(count) => `共 ${count} 条`}
            />
          </div>
        </>
      )}

      <Modal
        title={editing ? "编辑内推" : "新增内推"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void save()}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
      >
        <ReferralFormFields
          form={form}
          initialJobId={initialJobId}
          initialTrackId={initialTrackId}
          noteImages={noteImages}
          uploadingImages={uploadingImages}
          imageUploadPercent={imageUploadPercent}
          beforeImageUpload={beforeImageUpload}
          removeImage={removeImage}
        />
      </Modal>

      <ReferralDetailDrawer detail={detail} onEdit={openEdit} onClose={() => setDetail(null)} />
    </Space>
  );
}
