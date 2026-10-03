/**
 * 备选岗位抽屉：先收下还没核对的招聘信息，确认后再导入正式岗位。
 *
 * 放在岗位广场页的抽屉里而不是独立页面：它是"导入前的中转站"，用的时候就该在
 * 岗位列表旁边。
 */
import { ImportOutlined, PlusOutlined } from "@ant-design/icons";
import { App, Button, Checkbox, Drawer, Empty, Input, Space, Spin, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createCandidateJob,
  deleteCandidateJob,
  getCandidateJob,
  importCandidateJobs,
  listCandidateJobs,
  updateCandidateJob,
} from "../../api/candidateJob";
import { readAsDataUrl } from "../../utils/attachments";
import CandidateJobDetailModal from "./CandidateJobDetailModal";
import { CandidateCardGrid } from "./candidate/CandidateCardGrid";
import { CandidateJobFormModal } from "./candidate/CandidateJobFormModal";
import type { FormState } from "./candidate/candidateShared";
import { EMPTY_FORM, MAX_CANDIDATE_IMAGES, MAX_IMAGE_BYTES } from "./candidate/candidateShared";
import type { CandidateJob, CandidateJobDetail, CandidateJobPayload } from "../../types";

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * 交给父组件打开正式的岗位表单（预填这条候选的字段），保存后回报新岗位 id。
   *
   * **传的是取过详情的那一份**（``CandidateJobDetail``）：列表响应不带 JD，拿列表对象去预填
   * 会得到一个没有职位描述的表单——那正是"导入进来什么都没有"的来源。
   */
  onImport: (candidate: CandidateJobDetail) => void;
  /** 导入成功的标记：父组件拿到新岗位 id 后传进来，抽屉据此刷新并标记。 */
  importedCandidateId?: number | null;
  /** 从采集记录进入时，只显示选中的一条或多条采集批次。 */
  collectTaskIds?: number[];
}

export default function CandidateJobsDrawer({
  open,
  onClose,
  onImport,
  importedCandidateId = null,
  collectTaskIds = [],
}: Props) {
  const { message } = App.useApp();
  const [items, setItems] = useState<CandidateJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CandidateJob | null>(null);
  const [formState, setFormState] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [detailCandidate, setDetailCandidate] = useState<CandidateJobDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [batchAction, setBatchAction] = useState<"import" | "delete" | null>(null);
  // 搜索词与"已提交的搜索词"分开：输入时不打接口，静置 300ms 才带上关键词重新拉取。
  // 备选岗位可能几百条，每敲一个字就请求一次既慢又没意义。
  const [keyword, setKeyword] = useState("");
  const [committedKeyword, setCommittedKeyword] = useState("");

  const taskFilterKey = collectTaskIds.join(",");
  const selectedPendingIds = useMemo(
    () =>
      items
        .filter((item) => selectedIds.includes(item.id) && item.status === "pending")
        .map((item) => item.id),
    [items, selectedIds],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(
        await listCandidateJobs({
          ...(taskFilterKey
            ? { collectTaskIds: taskFilterKey.split(",").map((value) => Number(value)) }
            : {}),
          ...(committedKeyword ? { keyword: committedKeyword } : {}),
        }),
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载备选岗位失败");
    } finally {
      setLoading(false);
    }
  }, [committedKeyword, message, taskFilterKey]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setCommittedKeyword(keyword.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [keyword, open]);

  useEffect(() => {
    if (open) {
      setSelectedIds([]);
      // 每次打开都从"未筛选"开始：带着上次的关键词进来会让用户以为候选项丢了。
      setKeyword("");
      setCommittedKeyword("");
      void load();
    }
  }, [load, open, taskFilterKey]);

  // 搜索改变的是"看得见的那一批"，选中集必须跟着清空——否则批量导入/删除会作用到
  // 已经不在屏幕上的条目，用户看到的和实际发生的事对不上。
  useEffect(() => {
    setSelectedIds([]);
  }, [committedKeyword]);

  // 父组件完成导入后（拿到正式岗位 id）刷新列表，状态标记随之更新。
  useEffect(() => {
    if (open && importedCandidateId !== null) void load();
  }, [importedCandidateId, load, open]);

  const openCreate = () => {
    setEditing(null);
    setFormState(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (candidate: CandidateJob) => {
    setEditing(candidate);
    setFormState({
      title: candidate.title,
      company: candidate.company,
      rawText: candidate.raw_text,
      note: candidate.note,
      images: candidate.images ?? [],
    });
    setFormOpen(true);
  };

  const addImages = async (file: File) => {
    if (file.size > MAX_IMAGE_BYTES) {
      message.error("单张截图不能超过 2 MB");
      return;
    }
    if (formState.images.length >= MAX_CANDIDATE_IMAGES) {
      message.warning(`最多添加 ${MAX_CANDIDATE_IMAGES} 张截图`);
      return;
    }
    try {
      const dataUrl = await readAsDataUrl(file);
      setFormState((current) => ({ ...current, images: [...current.images, dataUrl] }));
    } catch {
      message.error("读取截图失败，请重试");
    }
  };

  const submit = async () => {
    if (submitting) return;
    const payload: CandidateJobPayload = {
      title: formState.title.trim(),
      company: formState.company.trim(),
      raw_text: formState.rawText,
      note: formState.note,
      images: formState.images,
      source: editing ? undefined : formState.images.length > 0 ? "招聘截图" : "粘贴文本",
    };
    if (!payload.title && !payload.raw_text?.trim() && formState.images.length === 0) {
      message.warning("请粘贴招聘信息、上传截图，或至少填写岗位名称");
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        // 更新接口不接受 source：来源在创建时定下，编辑不改写它。
        await updateCandidateJob(editing.id, {
          title: payload.title,
          company: payload.company,
          raw_text: payload.raw_text,
          note: payload.note,
          images: payload.images,
        });
        message.success("备选岗位已更新");
      } else {
        await createCandidateJob(payload);
        message.success("已放进备选岗位");
      }
      setFormOpen(false);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * 导入前先取这一条的**详情**：列表响应不带 JD（见 ``CandidateJobDetail`` 的说明），
   * 拿列表对象去预填表单会得到一个没有职位描述的空表单。
   *
   * 只在这一个动作上多一次请求：用户点一次「导入到岗位」换一次，而不是每次打开抽屉
   * 都把所有候选的正文一起拉下来。
   */
  const startImport = async (candidate: CandidateJob) => {
    try {
      const detail = await getCandidateJob(candidate.id);
      setDetailCandidate(null);
      onImport(detail);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取这条备选岗位失败");
    }
  };

  const openDetails = async (candidate: CandidateJob) => {
    setDetailLoading(true);
    try {
      setDetailCandidate(await getCandidateJob(candidate.id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取这条备选岗位失败");
    } finally {
      setDetailLoading(false);
    }
  };

  const remove = async (candidate: CandidateJob) => {
    try {
      await deleteCandidateJob(candidate.id);
      setSelectedIds((current) => current.filter((id) => id !== candidate.id));
      message.success("已删除");
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  const toggleSelected = (candidateId: number, checked: boolean) => {
    setSelectedIds((current) =>
      checked
        ? [...new Set([...current, candidateId])]
        : current.filter((id) => id !== candidateId),
    );
  };

  const importSelected = async () => {
    if (selectedPendingIds.length === 0) {
      message.warning("请先选择待处理的备选岗位");
      return;
    }
    setBatchAction("import");
    try {
      const result = await importCandidateJobs(selectedPendingIds);
      setSelectedIds([]);
      await load();
      const details = [
        result.imported > 0 ? `新建 ${result.imported} 个` : "",
        result.duplicate > 0 ? `重复 ${result.duplicate} 个` : "",
        result.trashed > 0 ? `回收站已有 ${result.trashed} 个` : "",
        result.invalid > 0 ? `无效 ${result.invalid} 个` : "",
        result.missing > 0 ? `已不存在 ${result.missing} 个` : "",
      ].filter(Boolean);
      message.success(`批量导入完成：${details.join("，") || "没有可导入的岗位"}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "批量导入失败");
    } finally {
      setBatchAction(null);
    }
  };

  const deleteSelected = async () => {
    if (selectedIds.length === 0) {
      message.warning("请先选择备选岗位");
      return;
    }
    setBatchAction("delete");
    try {
      const results = await Promise.allSettled(selectedIds.map((id) => deleteCandidateJob(id)));
      const deleted = results.filter((result) => result.status === "fulfilled").length;
      const failed = results.length - deleted;
      setSelectedIds([]);
      await load();
      if (failed > 0) {
        message.warning(`已删除 ${deleted} 个备选岗位，${failed} 个删除失败`);
      } else {
        message.success(`已删除 ${deleted} 个备选岗位`);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "批量删除失败");
    } finally {
      setBatchAction(null);
    }
  };

  const allSelected = items.length > 0 && selectedIds.length === items.length;

  return (
    <Drawer
      title="备选岗位"
      size="min(880px, 100vw)"
      open={open}
      onClose={onClose}
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          添加备选
        </Button>
      }
    >
      <Typography.Paragraph type="secondary">
        {collectTaskIds.length > 0
          ? `这里只显示选中采集记录的岗位（${collectTaskIds.length} 条记录）。`
          : "这里放还没核对的招聘信息（粘贴的文本或截图）。"}
        点卡片查看详情；选中后可以批量导入或删除。
      </Typography.Paragraph>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search
          allowClear
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜职位、公司、原文或备注"
          style={{ width: 260 }}
          aria-label="搜索备选岗位"
        />
        {committedKeyword ? (
          <Typography.Text type="secondary">
            「{committedKeyword}」匹配 {items.length} 条
          </Typography.Text>
        ) : null}
      </Space>
      {items.length > 0 && (
        <Space wrap style={{ marginBottom: 12 }}>
          <Checkbox
            checked={allSelected}
            indeterminate={selectedIds.length > 0 && !allSelected}
            disabled={batchAction !== null}
            onChange={(event) =>
              setSelectedIds(event.target.checked ? items.map((item) => item.id) : [])
            }
          >
            全选
          </Checkbox>
          <Typography.Text type="secondary">已选 {selectedIds.length} 条</Typography.Text>
          <Button
            size="small"
            disabled={selectedPendingIds.length === 0 || batchAction !== null}
            loading={batchAction === "import"}
            onClick={() => void importSelected()}
          >
            批量导入
          </Button>
          <Button
            size="small"
            danger
            disabled={selectedIds.length === 0 || batchAction !== null}
            loading={batchAction === "delete"}
            onClick={() => void deleteSelected()}
          >
            批量删除
          </Button>
          <Button
            size="small"
            disabled={selectedIds.length === 0 || batchAction !== null}
            onClick={() => setSelectedIds([])}
          >
            清空选择
          </Button>
        </Space>
      )}
      {loading ? (
        <Spin />
      ) : items.length === 0 ? (
        committedKeyword ? (
          <Empty
            description={`没有匹配「${committedKeyword}」的备选岗位`}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            <Button size="small" onClick={() => setKeyword("")}>
              清空搜索
            </Button>
          </Empty>
        ) : (
          <Empty description="还没有备选岗位。看到感兴趣但来不及整理的招聘信息，先放到这里。" />
        )
      ) : (
        <CandidateCardGrid
          items={items}
          selectedIds={selectedIds}
          batchAction={batchAction}
          onToggleSelected={toggleSelected}
          onOpenDetails={openDetails}
          onStartImport={startImport}
          onOpenEdit={openEdit}
          onRemove={remove}
        />
      )}

      <CandidateJobDetailModal
        candidate={detailCandidate}
        loading={detailLoading}
        onClose={() => setDetailCandidate(null)}
        onImport={(candidate) => void startImport(candidate)}
        onEdit={(candidate) => {
          setDetailCandidate(null);
          openEdit(candidate);
        }}
      />

      <CandidateJobFormModal
        open={formOpen}
        editing={editing}
        submitting={submitting}
        formState={formState}
        onChange={setFormState}
        onAddImages={addImages}
        onSubmit={submit}
        onCancel={() => setFormOpen(false)}
        onRejected={() => message.error("招聘截图只支持 JPG、PNG 或 WebP")}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        <ImportOutlined /> 已导入的备选会保留在列表里，方便回看它变成了哪个岗位。
      </Typography.Text>
    </Drawer>
  );
}
