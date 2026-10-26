// SPDX-License-Identifier: Apache-2.0
/**
 * 备选岗位抽屉：先收下还没核对的招聘信息，确认后再导入正式岗位。
 *
 * **一个容器、四个视图**（方案 §3.7 / §4.7）：详情 / 表单 / CSV 导入都是这张抽屉里的一屏。
 * 以前它们各是一个 Modal——抽屉(1) + 弹窗(2) 就是叠层，Esc 与焦点的归属都说不清。
 *
 * 关闭语义**一次退一层**：视图里 × / Esc 先回列表，在列表里才真的收掉抽屉；表单有脏值时
 * 走 L2 内联确认条（`useDiscardGuard`，与 `FormModal` 同一份判据）。抽屉里会装表单，
 * 所以蒙层不可关（`mask.closable: false`，与 `AGENTS.md` 的弹层规则一致）。
 */
import { ArrowLeftOutlined, ImportOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { App, Button, Drawer, Empty, Input, Pagination, Space, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { deleteCandidateJob, getCandidateJob, listCandidateJobsPage } from "../../api/candidateJob";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { CandidateJob, CandidateJobDetail } from "../../types";
import FormModalFooter from "../common/FormModalFooter";
import LoadingBlock from "../common/LoadingBlock";
import { useDiscardGuard } from "../common/useDiscardGuard";
import CandidateBatchToolbar from "./CandidateBatchToolbar";
import { CandidateCardGrid } from "./candidate/CandidateCardGrid";
import { CandidateImportView } from "./candidate/CandidateImportView";
import CandidateJobDetailView from "./candidate/CandidateJobDetailView";
import { CandidateJobFormView } from "./candidate/CandidateJobFormView";
import { useCandidateBatchTools } from "./candidate/useCandidateBatchTools";
import { useCandidateForm } from "./candidate/useCandidateForm";

/** 卡片网格 12 个一页，与迁移前的页内分页口径一致。 */
const CANDIDATE_PAGE_SIZE = 12;

/** 抽屉里的四屏（同一时刻只渲染一屏，也只有一个容器）。 */
type CandidateDrawerView = "list" | "detail" | "form" | "import";

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
  useLocale();
  const { message } = App.useApp();
  const [items, setItems] = useState<CandidateJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<CandidateDrawerView>("list");
  const [detailCandidate, setDetailCandidate] = useState<CandidateJobDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [batchAction, setBatchAction] = useState<"import" | "delete" | null>(null);
  // 多选模式：勾选框常驻，但「批量导入/批量删除」只在多选时出现（入口在卡片右键菜单）。
  const [selecting, setSelecting] = useState(false);
  // 搜索词与"已提交的搜索词"分开：输入时不打接口，静置 300ms 才带上关键词重新拉取。
  // 备选岗位可能几百条，每敲一个字就请求一次既慢又没意义。
  const [keyword, setKeyword] = useState("");
  const [committedKeyword, setCommittedKeyword] = useState("");
  // 备选岗位走服务端分页（RF-08）：页码/总数来自分页端点。items 就是当前页；
  // 「全选本页」只勾本页，「全选全部」是跨页选中当前筛选下的全部候选——翻页保留跨页选择，
  // 换搜索/筛选（可见集合本身变了）与退出多选仍清空。
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
      message.error(error instanceof Error ? error.message : t("jobs.candidate.load-failed"));
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
      setView("list");
      setDetailCandidate(null);
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
  // 已经不在屏幕上的条目。同时回第 1 页。Compiler 规范：镜像清空用渲染期守卫式调整。
  const [prevCommittedKeyword, setPrevCommittedKeyword] = useState(committedKeyword);
  if (prevCommittedKeyword !== committedKeyword) {
    setPrevCommittedKeyword(committedKeyword);
    setSelectedIds([]);
    setPage(1);
  }

  // 父组件完成导入后（拿到正式岗位 id）刷新列表，状态标记随之更新。
  const [prevImportedId, setPrevImportedId] = useState<number | null>(null);
  if (prevImportedId !== importedCandidateId) {
    setPrevImportedId(importedCandidateId);
    if (open && importedCandidateId !== null) setLoading(true);
  }

  useEffect(() => {
    if (!open || importedCandidateId === null) return;
    void fetchCandidates().then((result) => {
      if (result !== null) {
        setItems(result.items);
        setServerTotal(result.total);
      }
      setLoading(false);
    });
  }, [fetchCandidates, importedCandidateId, open]);

  /** 表单状态与提交（文件行数预算：与 `useCandidateBatchTools` 同一个口径）。 */
  const form = useCandidateForm(async () => {
    setView("list");
    await load();
  });

  const backToList = useCallback(() => {
    form.reset();
    setDetailCandidate(null);
    setView("list");
  }, [form]);

  // × / Esc 一次退一层；表单有脏值时先出内联确认条（`useDiscardGuard` 的 L2）。
  const guard = useDiscardGuard({
    open,
    submitting: form.submitting,
    dirty: view === "form" && form.dirty,
    hasDraft: false,
    onCancel: view === "list" ? onClose : backToList,
  });
  const keepRef = useRef<HTMLButtonElement>(null);

  /**
   * 导入前先取这一条的**详情**：列表响应不带 JD（见 ``CandidateJobDetail`` 的说明），
   * 拿列表对象去预填表单会得到一个没有岗位描述的空表单。只在这一个动作上多一次请求。
   */
  const startImport = async (candidate: CandidateJob) => {
    try {
      const detail = await getCandidateJob(candidate.id);
      setDetailCandidate(null);
      setView("list");
      onImport(detail);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("jobs.candidate.load-one-failed"));
    }
  };

  const openDetails = async (candidate: CandidateJob) => {
    setView("detail");
    setDetailCandidate(null);
    setDetailLoading(true);
    try {
      setDetailCandidate(await getCandidateJob(candidate.id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("jobs.candidate.load-one-failed"));
      setView("list");
    } finally {
      setDetailLoading(false);
    }
  };

  const openEdit = (candidate: CandidateJob) => {
    setDetailCandidate(null);
    form.openEdit(candidate);
    setView("form");
  };

  const remove = async (candidate: CandidateJob) => {
    try {
      await deleteCandidateJob(candidate.id);
      setSelectedIds((current) => current.filter((id) => id !== candidate.id));
      message.success(t("jobs.candidate.deleted"));
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("jobs.candidate.delete-failed"));
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
  // 再点一次=清空本页选择。「全选全部」跨页选中后本页自然全选中，不会出现错位。
  const someSelected = items.some((item) => selectedIds.includes(item.id));

  const { selectAllPages, selectAllPagesLoading, exportSelected, exporting, deleteSelected } =
    useCandidateBatchTools({
      selectedIds,
      setSelectedIds,
      keyword: committedKeyword,
      collectTaskIdsKey: taskFilterKey,
      onMutated: load,
      onBatchActionChange: setBatchAction,
    });

  const titleOf = (): string => {
    if (view === "detail") return t("jobs.candidate.detail.title");
    if (view === "import") return t("jobs.candidate.import.title");
    if (view === "form") {
      return form.editing
        ? t("jobs.candidate.form.title-edit")
        : t("jobs.candidate.form.title-create");
    }
    return t("jobs.candidate.title");
  };

  return (
    <Drawer
      title={titleOf()}
      size="min(880px, 100vw)"
      open={open}
      // 抽屉里有表单视图 → 蒙层不可关；Esc 由 useDiscardGuard 统一分级（见文件头）。
      mask={{ closable: false }}
      keyboard={false}
      onClose={guard.requestClose}
      extra={
        view === "list" ? (
          <Space>
            <Button icon={<UploadOutlined />} onClick={() => setView("import")}>
              {t("jobs.candidate.action.import-csv")}
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.openCreate();
                setView("form");
              }}
            >
              {t("jobs.candidate.action.add")}
            </Button>
          </Space>
        ) : (
          // × 与 Esc 都是"先回一层"：视图里关闭不该把整张抽屉收掉。
          <Button
            icon={<ArrowLeftOutlined />}
            aria-label={t("jobs.candidate.back")}
            onClick={backToList}
          >
            {t("jobs.candidate.back")}
          </Button>
        )
      }
      footer={
        view === "form" ? (
          <FormModalFooter
            confirming={guard.confirming}
            busy={form.submitting}
            danger={false}
            okText={t("jobs.candidate.action.save")}
            keepRef={keepRef}
            onRequestClose={guard.requestClose}
            onConfirmDiscard={guard.confirmDiscard}
            onKeepEditing={guard.keepEditing}
            onSubmit={() => void form.submit()}
          />
        ) : undefined
      }
    >
      {view === "list" ? (
        <>
          <Typography.Paragraph type="secondary">
            {collectTaskIds.length > 0
              ? t("jobs.candidate.hint-filtered", { count: collectTaskIds.length })
              : t("jobs.candidate.hint")}
          </Typography.Paragraph>
          <Space wrap style={{ marginBottom: 12 }}>
            <Input.Search
              allowClear
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t("jobs.candidate.search.placeholder")}
              style={{ width: 260 }}
              aria-label={t("jobs.candidate.search.label")}
            />
            {committedKeyword ? (
              <Typography.Text type="secondary">
                {t("jobs.candidate.search.matched", {
                  keyword: committedKeyword,
                  count: serverTotal,
                })}
              </Typography.Text>
            ) : null}
          </Space>
          {/* 批量工具栏只在多选模式出现（入口是卡片右键「批量选择」）；
              卡片勾选框同样只在多选模式渲染（CandidateCardGrid）。 */}
          {selecting && items.length > 0 ? (
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
              // 勾选框只动「本页」的条目：直接整体置成 items.map 会把「全选全部」静默删掉。
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
          ) : null}
          {loading ? (
            <LoadingBlock />
          ) : items.length === 0 ? (
            committedKeyword ? (
              <Empty
                description={t("jobs.candidate.empty-search", { keyword: committedKeyword })}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              >
                <Button size="small" onClick={() => setKeyword("")}>
                  {t("jobs.candidate.empty-search-clear")}
                </Button>
              </Empty>
            ) : (
              <Empty description={t("jobs.candidate.empty-list")} />
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
                  onChange={setPage}
                  hideOnSinglePage
                  showSizeChanger={false}
                  showTotal={(count) => t("jobs.candidate.total", { count })}
                />
              </div>
            </>
          )}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <ImportOutlined /> {t("jobs.candidate.footnote")}
          </Typography.Text>
        </>
      ) : view === "detail" ? (
        detailLoading || !detailCandidate ? (
          <LoadingBlock />
        ) : (
          <CandidateJobDetailView
            candidate={detailCandidate}
            onImport={(candidate) => void startImport(candidate)}
            onEdit={openEdit}
          />
        )
      ) : view === "form" ? (
        <CandidateJobFormView
          submitting={form.submitting}
          formState={form.formState}
          onChange={form.change}
          onAddImages={form.addImages}
          onRejected={form.rejectHint}
        />
      ) : (
        <CandidateImportView
          onClose={backToList}
          onImported={(imported) => {
            message.success(t("jobs.candidate.imported-from-csv", { count: imported }));
            void load();
          }}
        />
      )}
    </Drawer>
  );
}
