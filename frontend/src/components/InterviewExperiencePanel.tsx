/** 面经知识库（R-15）：真实面经的增删改查，可绑定岗位、沉淀真实问题清单。 */
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
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import LoadingBlock from "./common/LoadingBlock";
import { useCallback, useEffect, useState } from "react";
import {
  batchDeleteInterviewExperiences,
  createInterviewExperience,
  deleteInterviewExperience,
  listInterviewExperiences,
  updateInterviewExperience,
} from "../api/interviewExperiences";
import { useJobSearchSelect } from "../hooks/remoteSearchOptions";
import BatchActionBar from "./common/BatchActionBar";
import BatchDeleteButton from "./common/BatchDeleteButton";
import { useBatchSelection } from "../hooks/useBatchSelection";
import { RowContextMenu } from "./common/RowActions";
import InterviewExperienceFormModal from "./interview/InterviewExperienceFormModal";
import { EXPERIENCE_SOURCES, EXPERIENCE_SOURCE_LABELS } from "../types";
import type { ExperienceSource, InterviewExperience, InterviewExperiencePayload } from "../types";
import { formatDateTime } from "../utils/format";
import { RecordDetailDrawer } from "./common/RecordDetail";
import { isFromInnerControl } from "./common/recordDetailCore";
import { ListyItem, ListyMeta } from "./common/ListyItem";
import { useRowActionMenu } from "./common/rowActionMenu";

export default function InterviewExperiencePanel() {
  const { message } = App.useApp();
  // 批量选择：勾选若干条后一次删除（软删，全部进回收站）；列表是全量下发，
  // 选区即当前已加载的全部条目。
  const batch = useBatchSelection<number>();
  // 关联岗位下拉改为远程搜索（P0-1）：不再由页面预拉"前 100 条"当全量。
  const jobSelect = useJobSearchSelect();
  const [items, setItems] = useState<InterviewExperience[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [source, setSource] = useState<string | undefined>();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<InterviewExperience | null>(null);
  const [detail, setDetail] = useState<InterviewExperience | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<InterviewExperiencePayload>();
  const buildMenu = useRowActionMenu();

  // 纯取数（不含 setState）：effect 内联调用时 Compiler 才能验证非同步更新；
  // 返回 null 表示失败（错误提示在这里统一给出）。
  const fetchList = useCallback(async () => {
    try {
      return await listInterviewExperiences({
        keyword: keyword.trim(),
        source: source || undefined,
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取面经失败");
      return null;
    }
  }, [keyword, source, message]);

  // Compiler 规范：deps 变化的 loading 置位用渲染期守卫；应用状态放在 .then 回调。
  const [prevListKey, setPrevListKey] = useState<string | null>(null);
  const listKey = `${keyword}:${source}`;
  if (prevListKey !== listKey) {
    setPrevListKey(listKey);
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;
    void fetchList().then((items) => {
      if (cancelled) return;
      if (items !== null) setItems(items);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchList, listKey]);

  // 事件路径（保存/删除后的整表重拉，含 loading 翻动）。
  const loadList = useCallback(async () => {
    setLoading(true);
    const items = await fetchList();
    if (items !== null) setItems(items);
    setLoading(false);
  }, [fetchList]);

  // 详情抽屉要展示关联岗位的名称（P0-1）：打开时按 id 回查补进候选，
  // 否则第 101 条之后的绑定在抽屉里只能显示 "-"。
  useEffect(() => {
    if (!detail) return;
    void jobSelect.ensure(detail.job_id);
    // hook 的回调引用稳定，只跟随详情目标变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    // 每次打开都重置一次候选列表（P0-1）：远程搜索结果随上次输入残留。
    void jobSelect.reload();
    setModalOpen(true);
  };

  const openEdit = (experience: InterviewExperience) => {
    setEditing(experience);
    form.setFieldsValue({
      title: experience.title,
      company: experience.company,
      position: experience.position,
      job_id: experience.job_id ?? undefined,
      content: experience.content,
      questions: experience.questions,
      tags: experience.tags,
      source: experience.source as ExperienceSource,
      difficulty: experience.difficulty,
      round_type: experience.round_type,
      interview_date: experience.interview_date,
    });
    // 已绑定岗位的保显示（P0-1）：按 id 回查补进候选，再重置搜索列表。
    void jobSelect.ensure(experience.job_id);
    void jobSelect.reload();
    setModalOpen(true);
  };

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editing) {
        await updateInterviewExperience(editing.id, values);
      } else {
        await createInterviewExperience(values);
      }
      message.success(editing ? "已更新面经" : "已新增面经");
      setModalOpen(false);
      await loadList();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存面经失败");
    } finally {
      setSaving(false);
    }
  };

  const doRemove = async (experience: InterviewExperience) => {
    try {
      await deleteInterviewExperience(experience.id);
      message.success("已删除");
      await loadList();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  /** 批量删除：一次请求删完（软删），成功后清空选择并重拉列表。 */
  const removeSelected = async () => {
    const ids = [...batch.selectedIds];
    if (ids.length === 0) return;
    try {
      const { deleted } = await batchDeleteInterviewExperiences(ids);
      message.success(`已删除 ${deleted} 条面经，可在「回收站」里恢复`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "批量删除失败，请重试");
    }
    batch.exitSelecting();
    await loadList();
  };

  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
      <Card size="small" title="面经知识库">
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="搜索标题 / 岗位 / 正文"
            style={{ width: 240 }}
            onSearch={(value) => setKeyword(value)}
          />
          <Select
            allowClear
            placeholder="来源筛选"
            style={{ minWidth: 140 }}
            value={source}
            onChange={setSource}
            options={EXPERIENCE_SOURCES.map((value) => ({
              value,
              label: EXPERIENCE_SOURCE_LABELS[value],
            }))}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增面经
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
          <BatchDeleteButton count={batch.selectedCount} noun="条面经" onDelete={removeSelected} />
        </BatchActionBar>
      )}

      {loading ? (
        <LoadingBlock />
      ) : items.length === 0 ? (
        <Empty description="还没有面经，把面试里被问到的问题记下来吧" />
      ) : (
        <Listy
          className="rf-card-list"
          items={items}
          rowKey={(item) => item.id}
          itemRender={(item) => (
            <ListyItem
              className="detail-trigger"
              // 整条点开详情；行内的「详情 / 更多」按钮不会被这一层抢走。
              onClick={(event) => {
                if (isFromInnerControl(event)) return;
                setDetail(item);
              }}
              actions={[
                batch.selecting ? (
                  <Checkbox
                    key="select"
                    aria-label={`选择面经 ${item.title || item.company}`}
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
                              confirm: "删除这条面经？删除后可在回收站里找回。",
                              onClick: () => void doRemove(item),
                            },
                          ]),
                        }}
                      >
                        <Button
                          type="text"
                          size="small"
                          icon={<MoreOutlined />}
                          aria-label={`更多操作 ${item.title || item.company}`}
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
                        <span>{item.title || "未命名面经"}</span>
                        <Tag color="geekblue">
                          {EXPERIENCE_SOURCE_LABELS[item.source as ExperienceSource] ?? item.source}
                        </Tag>
                        {item.round_type && <Tag>{item.round_type}</Tag>}
                        {item.interview_date && <Tag>{item.interview_date}</Tag>}
                      </Space>
                    }
                    description={
                      <Space orientation="vertical" size={2} style={{ width: "100%" }}>
                        <Typography.Text type="secondary">
                          {item.company}
                          {item.position ? ` · ${item.position}` : ""}
                          {item.difficulty ? ` · ${item.difficulty}` : ""}
                        </Typography.Text>
                        {item.questions.length > 0 && (
                          <Typography.Text type="secondary">
                            真实问题 {item.questions.length} 个：
                            {item.questions.slice(0, 3).join("；")}
                          </Typography.Text>
                        )}
                        {item.tags.length > 0 && (
                          <Space size={4} wrap>
                            {item.tags.map((tag) => (
                              <Tag key={tag}>{tag}</Tag>
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
      )}

      <InterviewExperienceFormModal
        open={modalOpen}
        editing={editing}
        form={form}
        saving={saving}
        jobSelect={jobSelect}
        onCancel={() => setModalOpen(false)}
        onOk={() => void save()}
      />

      <RecordDetailDrawer
        open={detail !== null}
        title={detail?.title || "未命名面经"}
        subtitle={
          detail
            ? [detail.company, detail.position, detail.difficulty].filter(Boolean).join(" · ")
            : undefined
        }
        tags={
          detail && (
            <Space size={6} wrap>
              <Tag color="geekblue">
                {EXPERIENCE_SOURCE_LABELS[detail.source as ExperienceSource] ?? detail.source}
              </Tag>
              {detail.round_type && <Tag>{detail.round_type}</Tag>}
              {detail.interview_date && <Tag>{detail.interview_date}</Tag>}
              {detail.tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </Space>
          )
        }
        fields={
          detail
            ? [
                {
                  label: "关联岗位",
                  value:
                    jobSelect.options.find((option) => option.value === detail.job_id)?.label ??
                    "-",
                },
                { label: "创建时间", value: formatDateTime(detail.created_at) },
                { label: "更新时间", value: formatDateTime(detail.updated_at) },
              ]
            : []
        }
        sections={
          detail
            ? [
                { title: "正文", content: detail.content || "（无）" },
                {
                  title: `真实问题（${detail.questions.length}）`,
                  content:
                    detail.questions.length === 0 ? (
                      "（还没有记录问题）"
                    ) : (
                      <ol style={{ margin: 0, paddingLeft: 20 }}>
                        {detail.questions.map((question, index) => (
                          <li key={`${question}-${index}`}>{question}</li>
                        ))}
                      </ol>
                    ),
                },
              ]
            : []
        }
        actions={
          detail && (
            <Button
              type="primary"
              icon={<EditOutlined />}
              onClick={() => {
                openEdit(detail);
                setDetail(null);
              }}
            >
              编辑
            </Button>
          )
        }
        onClose={() => setDetail(null)}
      />
    </Space>
  );
}
