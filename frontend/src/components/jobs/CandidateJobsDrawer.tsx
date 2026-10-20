// SPDX-License-Identifier: Apache-2.0
/**
 * 备选岗位抽屉：先收下还没核对的招聘信息，确认后再导入正式岗位。
 *
 * 放在岗位广场页的抽屉里而不是独立页面：它是"导入前的中转站"，用的时候就该在
 * 岗位列表旁边。
 */
import { ImportOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { App, Button, Drawer, Empty, Input, Pagination, Space, Typography } from "antd";
import LoadingBlock from "../common/LoadingBlock";
import { useCallback, useEffect, useState } from "react";
import CandidateBatchToolbar from "./CandidateBatchToolbar";
import {
  createCandidateJob,
  deleteCandidateJob,
  getCandidateJob,
  listCandidateJobsPage,
  updateCandidateJob,
} from "../../api/candidateJob";
import { readAsDataUrl } from "../../utils/attachments";
import CandidateJobDetailModal from "./CandidateJobDetailModal";
import { CandidateCardGrid } from "./candidate/CandidateCardGrid";
import { CandidateImportModal } from "./candidate/CandidateImportModal";
import { CandidateJobFormModal } from "./candidate/CandidateJobFormModal";
import { useCandidateBatchTools } from "./candidate/useCandidateBatchTools";
import type { FormState } from "./candidate/candidateShared";
import { EMPTY_FORM, MAX_CANDIDATE_IMAGES, MAX_IMAGE_BYTES } from "./candidate/candidateShared";
import type { CandidateJob, CandidateJobDetail, CandidateJobPayload } from "../../types";

/** 卡片网格 12 个一页，与迁移前的页内分页口径一致。 */
const CANDIDATE_PAGE_SIZE = 12;

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * 交给父组件打开正式的岗位表单（预填这条候选的字段），保存后回报新岗位 id。
   *
   * **传的是取过详情的那一份**（``CandidateJobDetail``）：列表响应不带 JD，拿列表对象去预填
   * 会得到一个没有岗位描述的表单——那正是"导入进来什么都没有"的来源。
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
  // CSV 导入弹窗（预览 → 确认两步）；批量动作的 loading 态收在 useCandidateBatchTools。
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  // 多选模式：勾选框常驻，但「批量导入/批量删除」只在多选时出现（入口在卡片右键菜单）。
  const [selecting, setSelecting] = useState(false);
  // 搜索词与"已提交的搜索词"分开：输入时不打接口，静置 300ms 才带上关键词重新拉取。
  // 备选岗位可能几百条，每敲一个字就请求一次既慢又没意义。
  const [keyword, setKeyword] = useState("");
  const [committedKeyword, setCommittedKeyword] = useState("");

  // 备选岗位走服务端分页（RF-08）：页码/总数来自分页端点，历史候选超过旧端点 300 条
  // 兜底后仍然全部可达。items 就是当前页；「全选本页」只勾本页，而「全选全部」是
  // 跨页选中当前筛选下的全部候选——**翻页保留跨页选择**（产品决策，工具条计数跨页
  // 保留）；换搜索/筛选（可见集合本身变了）与退出多选仍清空。
  const [page, setPage] = useState(1);
  const [serverTotal, setServerTotal] = useState(0);

  const taskFilterKey = collectTaskIds.join(",");

  // 纯取数（不含 setState）：effect 内联调用时 Compiler 才能验证非同步更新；
  // 返回 null 表示失败（错误提示在这里统一给出）。
  const fetchCandidates = useCallback(async (): Promise<{
    items: CandidateJob[];
    total: number;
  } | null> => {
    try {
      const pageData = await listCandidateJobsPage(
        {
          ...(taskFilterKey
            ? { collectTaskIds: taskFilterKey.split(",").map((value) => Number(value)) }
            : {}),
          ...(committedKeyword ? { keyword: committedKeyword } : {}),
        },
        page,
        CANDIDATE_PAGE_SIZE,
      );
      return { items: pageData.items, total: pageData.total };
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载备选岗位失败");
      return null;
    }
  }, [committedKeyword, message, taskFilterKey, page]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setCommittedKeyword(keyword.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [keyword, open]);

  // Compiler 规范：随 open 变化的重置用渲染期守卫；取数在 effect 内联 .then 应用。
  const [prevOpenSync, setPrevOpenSync] = useState(open);
  if (prevOpenSync !== open) {
    setPrevOpenSync(open);
    if (open) {
      setSelectedIds([]);
      setSelecting(false);
      // 每次打开都从"未筛选"开始：带着上次的关键词进来会让用户以为候选项丢了。
      setKeyword("");
      setCommittedKeyword("");
      setPage(1);
      setLoading(true);
    }
  }

  useEffect(() => {
    if (!open) return;
    void fetchCandidates().then((result) => {
      if (result !== null) {
        setItems(result.items);
        setServerTotal(result.total);
      }
      setLoading(false);
    });
  }, [fetchCandidates, open]);

  // 事件路径（导入/删除/编辑后的整页重拉，含 loading 翻动）。
  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchCandidates();
    if (result !== null) {
      setItems(result.items);
      setServerTotal(result.total);
    }
    setLoading(false);
  }, [fetchCandidates]);

  // 搜索改变的是"看得见的那一批"，选中集必须跟着清空——否则批量导入/删除会作用到
  // 已经不在屏幕上的条目，用户看到的和实际发生的事对不上。同时回第 1 页。
  // Compiler 规范：镜像清空用渲染期守卫式调整。
  const [prevCommittedKeyword, setPrevCommittedKeyword] = useState(committedKeyword);
  if (prevCommittedKeyword !== committedKeyword) {
    setPrevCommittedKeyword(committedKeyword);
    setSelectedIds([]);
    setPage(1);
  }

  // 父组件完成导入后（拿到正式岗位 id）刷新列表，状态标记随之更新。
  // Compiler 规范：随 importedCandidateId 变化的拉取用渲染期守卫置 loading，
  // 取数在 effect 内联 .then 应用。
  const [prevImportedId, setPrevImportedId] = useState<number | null>(null);
  if (prevImportedId !== importedCandidateId) {
    setPrevImportedId(importedCandidateId);
    if (open && importedCandidateId !== null) setLoading(true);
  }

  useEffect(() => {
    if (!open || importedCandidateId === null) return;
    const cancelled = false;
    void fetchCandidates().then((result) => {
      if (cancelled) return;
      if (result !== null) {
        setItems(result.items);
        setServerTotal(result.total);
      }
      setLoading(false);
    });
  }, [fetchCandidates, importedCandidateId, open]);

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
      sourceUrl: candidate.source_url,
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
      source_url: formState.sourceUrl.trim(),
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
          source_url: payload.source_url,
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
   * 拿列表对象去预填表单会得到一个没有岗位描述的空表单。
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

  const allSelected = items.length > 0 && items.every((item) => selectedIds.includes(item.id));
  // 勾选框三态的口径是「本页」：checked=本页全选中、indeterminate=本页部分选中、
  // 再点一次=清空本页选择。「全选全部」跨页选中后本页自然全选中（checked 亮起），
  // 不会出现"本页已全选却仍显示半选"的错位。
  const someSelected = items.some((item) => selectedIds.includes(item.id));

  // 批量动作（跨页全选 / 导出 CSV / 批量删除）收在 hook 里（文件行数预算）：
  // 状态所有权仍在抽屉，hook 只收"发请求 + 给提示"这段流程。
  const { selectAllPages, selectAllPagesLoading, exportSelected, exporting, deleteSelected } =
    useCandidateBatchTools({
      selectedIds,
      setSelectedIds,
      keyword: committedKeyword,
      collectTaskIdsKey: taskFilterKey,
      onMutated: load,
      onBatchActionChange: setBatchAction,
    });

  // 翻页只换页码，不动选择集：「全选全部」跨页选中 N 条后翻页，已选计数必须保留，
  // 本页勾选框三态按「本页」口径自然收敛（见上方 allSelected/someSelected 的注释）。
  // 幽灵选中由删除路径兜底：单删就地剔除 id（remove），批删/批量导入后整体清空
  // （useCandidateBatchTools），被删条目不会留在 selectedIds 里。
  const changePage = (next: number) => {
    setPage(next);
  };

  return (
    <Drawer
      title="备选岗位"
      size="min(880px, 100vw)"
      open={open}
      onClose={onClose}
      extra={
        <Space>
          <Button icon={<UploadOutlined />} onClick={() => setCsvImportOpen(true)}>
            导入 CSV
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            添加备选
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">
        {collectTaskIds.length > 0
          ? `这里只显示选中采集记录的岗位（${collectTaskIds.length} 条记录）。`
          : "这里放还没核对的招聘信息（粘贴的文本或截图）。"}
        点卡片查看详情；选中后可以批量删除或导出。
      </Typography.Paragraph>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search
          allowClear
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜岗位、公司、原文或备注"
          style={{ width: 260 }}
          aria-label="搜索备选岗位"
        />
        {committedKeyword ? (
          <Typography.Text type="secondary">
            「{committedKeyword}」匹配 {serverTotal} 条
          </Typography.Text>
        ) : null}
      </Space>
      {/* 批量工具栏只在多选模式出现（用户反馈：右键「批量选择」后才显示整套选择/操作，
          平时界面就是普通浏览）；卡片勾选框同样只在多选模式渲染（CandidateCardGrid）。 */}
      {selecting && items.length > 0 && (
        <CandidateBatchToolbar
          selectedCount={selectedIds.length}
          pageCount={items.length}
          allSelected={allSelected}
          someSelected={someSelected}
          selecting={selecting}
          batchAction={batchAction}
          totalCount={serverTotal}
          selectAllPagesLoading={selectAllPagesLoading}
          onSelectAllPages={() => void selectAllPages()}
          exporting={exporting}
          onExportCsv={() => void exportSelected()}
          // 勾选框只动「本页」的条目：勾上=并入本页 id（不破坏跨页选中），取消=只
          // 移除本页 id。直接整体置成 items.map 会把「全选全部」的跨页选择静默删掉。
          onToggleAll={(checked) =>
            setSelectedIds((current) =>
              checked
                ? [...new Set([...current, ...items.map((item) => item.id)])]
                : current.filter((id) => !items.some((item) => item.id === id)),
            )
          }
          onDelete={deleteSelected}
          onClear={() => setSelectedIds([])}
          onExit={() => {
            setSelecting(false);
            setSelectedIds([]);
          }}
        />
      )}
      {loading ? (
        <LoadingBlock />
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
        <>
          <CandidateCardGrid
            items={items}
            selectedIds={selectedIds}
            batchAction={batchAction}
            selecting={selecting}
            onEnterSelecting={() => setSelecting(true)}
            onToggleSelected={toggleSelected}
            onOpenDetails={openDetails}
            onStartImport={startImport}
            onOpenEdit={openEdit}
            onRemove={remove}
          />
          <div style={{ textAlign: "right", marginTop: 12 }}>
            <Pagination
              current={page}
              pageSize={CANDIDATE_PAGE_SIZE}
              total={serverTotal}
              onChange={changePage}
              hideOnSinglePage
              showSizeChanger={false}
              showTotal={(count) => `共 ${count} 条`}
            />
          </div>
        </>
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
      <CandidateImportModal
        open={csvImportOpen}
        onClose={() => setCsvImportOpen(false)}
        onImported={(imported) => {
          message.success(`已从 CSV 导入 ${imported} 条备选岗位`);
          void load();
        }}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        <ImportOutlined /> 已导入的备选会保留在列表里，方便回看它变成了哪个岗位。
      </Typography.Text>
    </Drawer>
  );
}
