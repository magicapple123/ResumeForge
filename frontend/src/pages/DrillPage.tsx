/**
 * 面试深挖：针对台账里每一条主张做压力测试，结束时给一份"该去补什么"的清单。
 *
 * 与「模拟面试」的分工写在页面上：那边按轮数推进、给四维度评分；这边**不评总分**，
 * 用证据状态回答"这条主张我到底讲不讲得清"。所以界面上也不该出现任何分数。
 *
 * 两个刻意的呈现选择：
 * - **反馈策略默认「真实模拟」**：每题后不念判定，因为念了会让人按判分标准答题，
 *   而不像真面试。判定仍如实回传（界面不撒谎），只是不主动展示。
 * - **评分契约在整个会话期间可见**：它是"判定标准"，用户有权看到自己在被怎么衡量——
 *   藏起来才会让人怀疑"是不是看人下菜碟"。
 */
import {
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  Listy,
  Modal,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import BatchActionBar from "../components/common/BatchActionBar";
import { RowActions } from "../components/common/RowActions";
import { useBatchSelection } from "../hooks/useBatchSelection";
import { ListyItem } from "../components/common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../components/common/listyPadding";
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  PlusOutlined,
  CheckSquareOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteDrillSession, getDrillSession, listDrillSessions } from "../api/drill";
import type { DrillSession, DrillSessionBrief } from "../types";
import { FEEDBACK_LABELS } from "../types";
import { ActiveSession } from "./drill/ActiveSession";
import { ReviewPanel } from "./drill/ReviewPanel";
import { StartPanel } from "./drill/StartPanel";

export default function DrillPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [current, setCurrent] = useState<DrillSession | null>(null);
  const [history, setHistory] = useState<DrillSessionBrief[]>([]);
  const batch = useBatchSelection<number>();
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);

  // 用 ref 读"当前是否已打开某一场"：把它写进 refreshHistory 的依赖会让回调
  // 每次都重建，而 refreshHistory 又是 useEffect 的依赖 → 无限重取。
  const currentRef = useRef<DrillSession | null>(null);
  currentRef.current = current;

  const refreshHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const records = await listDrillSessions();
      setHistory(records);
      // 自动打开最近一场**进行中**的：用户回到这一页最可能是想接着答，
      // 让他再点一次「继续」是多余的一步。没有进行中的就不自动打开，
      // 免得把一份旧复盘糊在屏幕上。
      const active = records.find((item) => item.status === "active");
      if (active && !currentRef.current) {
        setCurrent(await getDrillSession(active.id));
        setOpenId(active.id);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取记录失败");
    } finally {
      setLoadingHistory(false);
    }
  }, [message]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const openHistory = async (id: number) => {
    try {
      setOpenId(id);
      setCurrent(await getDrillSession(id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取失败");
    }
  };

  const remove = async (id: number) => {
    try {
      await deleteDrillSession(id);
      message.success("已删除");
      if (current?.id === id) setCurrent(null);
      await refreshHistory();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  /** 批量删除：确认后逐条走同一个删除接口，全部完成再刷新一次。 */
  const removeSelected = () => {
    const ids = [...batch.selectedIds];
    if (ids.length === 0) return;
    Modal.confirm({
      title: `删除选中的 ${ids.length} 场深挖？`,
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        const results = await Promise.allSettled(
          history
            .filter((item) => batch.isSelected(item.id))
            .map((item) => deleteDrillSession(item.id)),
        );
        const failed = results.filter((item) => item.status === "rejected").length;
        if (failed === 0) message.success(`已删除 ${ids.length} 场深挖`);
        else message.warning(`已删除 ${ids.length - failed} 场，${failed} 场失败，请重试`);
        batch.exitSelecting();
        await refreshHistory();
      },
    });
  };

  const stats = useMemo(() => {
    if (!current) return null;
    return current.summary;
  }, [current]);

  const finished = current?.status === "finished";

  return (
    <div className="drill-page">
      <div className="drill-page-head">
        <Space orientation="vertical" size={0}>
          {/* 深挖是从台账「拿去深挖」进来的子页面，但它是独立路由——浏览器后退之外
              界面上没有别的出口，用户会以为"进去就出不来了"。 */}
          <Button
            type="link"
            size="small"
            className="drill-back"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate("/claims")}
          >
            返回事实台账
          </Button>
          <Typography.Title level={4} style={{ margin: 0 }}>
            面试深挖
          </Typography.Title>
          <Typography.Text type="secondary">
            把事实台账里「已确认」的主张逐条拿出来压力测试：讲不讲得清、哪里还站不住。
            每道题的标准在你看到问题之前就定下来，不评总分。
          </Typography.Text>
        </Space>
        <StartPanel
          onStarted={(session) => {
            setCurrent(session);
            setOpenId(session.id);
            void refreshHistory();
          }}
        />
      </div>

      {current && stats && (
        <div className="drill-summary">
          <Statistic title="已问" value={stats.questions} />
          <Statistic
            title="讲得清"
            value={stats.verified_count}
            styles={{ content: { color: "#389e0d" } }}
            prefix={<CheckCircleOutlined />}
          />
          <Statistic
            title="部分验证"
            value={stats.partial_count}
            styles={{ content: { color: "#d48806" } }}
          />
          <Statistic title="未验证" value={stats.unverified_count} />
          {stats.contradictory_count > 0 && (
            <Statistic
              title="存在矛盾"
              value={stats.contradictory_count}
              styles={{ content: { color: "#cf1322" } }}
              prefix={<ExclamationCircleOutlined />}
            />
          )}
        </div>
      )}

      {current && (
        <Card
          size="small"
          title={current.title}
          extra={
            <Space>
              <Tag color={finished ? "default" : "processing"}>
                {finished ? "已结束" : "进行中"}
              </Tag>
              <Tooltip title={FEEDBACK_LABELS[current.feedback_policy]}>
                <Tag>{current.feedback_policy === "deferred" ? "真实模拟" : "训练模式"}</Tag>
              </Tooltip>
            </Space>
          }
        >
          {finished ? (
            <ReviewPanel session={current} />
          ) : (
            <ActiveSession session={current} onUpdate={setCurrent} />
          )}
        </Card>
      )}

      <Card
        size="small"
        title="历史记录"
        extra={
          <Space size={8}>
            <Button size="small" onClick={() => void refreshHistory()} loading={loadingHistory}>
              刷新
            </Button>
            {!batch.selecting && history.length > 0 && (
              <Button size="small" icon={<CheckSquareOutlined />} onClick={batch.enterSelecting}>
                批量选择
              </Button>
            )}
          </Space>
        }
      >
        {batch.selecting && (
          <BatchActionBar count={batch.selectedCount} onExit={batch.exitSelecting}>
            <Button danger disabled={batch.selectedCount === 0} onClick={removeSelected}>
              删除所选
            </Button>
          </BatchActionBar>
        )}
        {loadingHistory ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : history.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有深挖记录。先在「事实台账」确认几条主张，再回来开一场。"
          />
        ) : (
          <Listy
            items={history}
            rowKey={(item) => item.id}
            styles={{ item: { ...LISTY_ITEM_PADDING_SMALL } }}
            itemRender={(item) => (
              <ListyItem
                actions={
                  batch.selecting
                    ? [
                        <Checkbox
                          key="pick"
                          aria-label={`选择深挖 ${item.title}`}
                          checked={batch.isSelected(item.id)}
                          onChange={() => batch.toggle(item.id)}
                        />,
                      ]
                    : [
                        <Button
                          key="open"
                          size="small"
                          type="link"
                          onClick={() => void openHistory(item.id)}
                        >
                          {item.status === "active" ? "继续" : "看复盘"}
                        </Button>,
                        // 删除收进「···」菜单：除回收站外，删除不再以红图标裸露（全局约定）。
                        <RowActions
                          key="more"
                          more={[
                            {
                              key: "delete",
                              label: "删除",
                              danger: true,
                              confirm: "删除这场深挖？",
                              onClick: () => void remove(item.id),
                            },
                          ]}
                        />,
                      ]
                }
              >
                <Space size={8} wrap>
                  <Typography.Text strong={openId === item.id}>{item.title}</Typography.Text>
                  <Tag color={item.status === "active" ? "processing" : "default"}>
                    {item.status === "active" ? "进行中" : "已结束"}
                  </Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {item.current_index}/{item.max_questions} 题 ·{" "}
                    {item.created_at.replace("T", " ").slice(0, 16)}
                  </Typography.Text>
                </Space>
              </ListyItem>
            )}
          />
        )}
      </Card>

      {!current && history.length > 0 && (
        <Typography.Text type="secondary">
          点上方「继续」或「看复盘」打开某一场；也可以
          <PlusOutlined /> 直接开始新的一场。
        </Typography.Text>
      )}
    </div>
  );
}
