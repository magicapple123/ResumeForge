// SPDX-License-Identifier: Apache-2.0
/** 内推管理（R-13）：内推列表、增删改 + 顶部转化率小卡 + 内推码/图片备注/状态分色。
 *
 * ``converted`` 由后端按关联漏斗后置位派生，前端只展示、不自己算口径。顶部转化率卡展示
 * 有效内推总数、已转化数与转化率。备注图片先上传拿相对路径，再随表单写入 ``note_images``。
 *
 * 视图层拆在 `./referral/` 下，本文件只负责状态与请求：
 * - `ReferralToolbar`：关键词搜索 / 状态筛选 / 新建入口
 * - `ReferralListItem`：列表一行的渲染与行菜单
 * - `ReferralFormModal` + `ReferralFormFields`：新建 / 编辑弹窗
 */
import { App, Empty, Form, Listy, Pagination, Space, Upload } from "antd";
import LoadingBlock from "./common/LoadingBlock";
import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import {
  batchDeleteReferrals,
  createReferral,
  deleteReferral,
  getReferralStats,
  listReferralsPage,
  updateReferral,
  uploadReferralImage,
} from "../api/referrals";
import type { Referral, ReferralPayload, ReferralStats, ReferralStatus } from "../types";
import { classifyAttachment, MAX_ATTACHMENT_BYTES } from "../utils/attachments";
import ReferralStatsCard from "./referral/ReferralStatsCard";
import ReferralToolbar from "./referral/ReferralToolbar";
import ReferralListItem from "./referral/ReferralListItem";
import ReferralFormModal from "./referral/ReferralFormModal";
import ReferralDetailDrawer from "./referral/ReferralDetailDrawer";
import { MAX_NOTE_IMAGES } from "./referral/ReferralFormFields";
import { useRowActionMenu } from "./common/rowActionMenu";
import BatchActionBar from "./common/BatchActionBar";
import BatchDeleteButton from "./common/BatchDeleteButton";
import { useBatchSelection } from "../hooks/useBatchSelection";

/** 每页条数：与后端 /referrals/page 端点默认值一致。 */
const REFERRAL_PAGE_SIZE = 10;

export default function ReferralPanel() {
  // 本面板用模块级 t() 取文案：必须订阅语言变化。
  useLocale();
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
      message.error(
        error instanceof Error ? error.message : t("componentsMisc2.referral.loadFailed"),
      );
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
      message.error(t("componentsMisc2.referral.imageTypeError"));
      return Upload.LIST_IGNORE;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      message.error(t("componentsMisc2.referral.imageSizeError"));
      return Upload.LIST_IGNORE;
    }
    if (noteImages.length >= MAX_NOTE_IMAGES) {
      message.error(t("componentsMisc2.referral.imageCountLimit", { count: MAX_NOTE_IMAGES }));
      return Upload.LIST_IGNORE;
    }
    setUploadingImages(true);
    setImageUploadPercent(0);
    try {
      const { path } = await uploadReferralImage(file, (percent) => setImageUploadPercent(percent));
      setNoteImages((prev) => [...prev, path]);
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("componentsMisc2.referral.uploadFailed"),
      );
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
      message.success(
        editing ? t("componentsMisc2.referral.updated") : t("componentsMisc2.referral.created"),
      );
      setModalOpen(false);
      await loadList();
      await loadStats();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("componentsMisc2.referral.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: Referral) => {
    try {
      await deleteReferral(item.id);
      message.success(t("componentsMisc2.referral.deleted"));
      await loadList();
      await loadStats();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("componentsMisc2.referral.deleteFailed"),
      );
    }
  };

  /** 批量删除：一次请求删完（软删），成功后清空选择并刷新列表与统计。 */
  const removeSelected = async () => {
    const ids = [...batch.selectedIds];
    if (ids.length === 0) return;
    try {
      const { deleted } = await batchDeleteReferrals(ids);
      message.success(t("componentsMisc2.referral.batchDeleted", { count: deleted }));
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("componentsMisc2.referral.batchDeleteFailed"),
      );
    }
    batch.exitSelecting();
    await loadList();
    await loadStats();
  };

  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
      <ReferralStatsCard stats={stats} />

      <ReferralToolbar
        status={status}
        onStatusChange={setStatus}
        onSearch={(value) => setKeyword(value)}
        onCreate={openCreate}
      />

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
          <BatchDeleteButton
            count={batch.selectedCount}
            noun={t("componentsMisc2.referral.batchNoun")}
            onDelete={removeSelected}
          />
        </BatchActionBar>
      )}

      {loading ? (
        <LoadingBlock />
      ) : items.length === 0 ? (
        <Empty description={t("componentsMisc2.referral.empty")} />
      ) : (
        <>
          <Listy
            items={items}
            rowKey={(item) => item.id}
            itemRender={(item) => (
              <ReferralListItem
                item={item}
                selecting={batch.selecting}
                selected={batch.isSelected(item.id)}
                buildMenu={buildMenu}
                onToggleSelected={() => batch.toggle(item.id)}
                onOpenDetail={() => setDetail(item)}
                onEdit={() => openEdit(item)}
                onDelete={() => void remove(item)}
                onEnterSelecting={batch.enterSelecting}
              />
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
              showTotal={(count) => t("componentsMisc2.referral.paginationTotal", { count })}
            />
          </div>
        </>
      )}

      <ReferralFormModal
        open={modalOpen}
        editing={editing}
        saving={saving}
        form={form}
        initialJobId={initialJobId}
        initialTrackId={initialTrackId}
        noteImages={noteImages}
        uploadingImages={uploadingImages}
        imageUploadPercent={imageUploadPercent}
        beforeImageUpload={beforeImageUpload}
        removeImage={removeImage}
        onCancel={() => setModalOpen(false)}
        onOk={() => void save()}
      />
      <ReferralDetailDrawer detail={detail} onEdit={openEdit} onClose={() => setDetail(null)} />
    </Space>
  );
}
