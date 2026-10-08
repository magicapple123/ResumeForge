/**
 * 页头右侧的「当前数据集 + 用户头像」。
 *
 * 两件事放在一起，因为它们回答的是同一个问题：**我现在是在什么上下文里操作**。
 * - 数据集：简历通支持多套互相独立的数据集（工作一份、私人一份），而界面其余部分长得
 *   一模一样，切错数据集会产生"我的简历怎么不见了"这类误会。
 * - 头像：用「我的资料」里**当前启用的那张照片**，一眼就能认出这是谁的那份数据。
 *
 * 两个刻意的做法：
 * 1. 数据集在这里可以直接切换，但切换成功后会整页重载，保证岗位、资料和缓存都来自新数据集。
 * 2. **头像不出本机**。照片存在本地数据库里，这里只是把它显示出来，不发给任何模型。
 */
import { DatabaseOutlined, DownOutlined, UserOutlined } from "@ant-design/icons";
import { Avatar, Dropdown, Skeleton, Tooltip } from "antd";
import type { MenuProps } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getProfile } from "../api/profile";
import { activateDataset, listDatasets } from "../api/settings";
import type { Profile } from "../types";
import type { DatasetInfo } from "../types/settings";
import { reloadPage } from "../utils/navigation";

export default function AppHeaderContext() {
  const navigate = useNavigate();
  const location = useLocation();
  const [dataset, setDataset] = useState<DatasetInfo | null>(null);
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [datasetCount, setDatasetCount] = useState(0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState("");

  // 纯取数（不含 setState）：effect 内联调用时 Compiler 才能验证非同步更新；
  // 返回 null 表示失败（页头是全局装饰：读不到就少显示一块，绝不报错或白屏）。
  const fetchHeaderData = useCallback(async () => {
    try {
      const [datasets, current] = await Promise.all([listDatasets(), getProfile()]);
      return { datasets, current };
    } catch {
      return null;
    }
  }, []);

  // Compiler 规范：应用状态放在 .then 回调（外部数据到达时应用）。
  useEffect(() => {
    let cancelled = false;
    void fetchHeaderData().then((result) => {
      if (cancelled) return;
      if (result) {
        setDatasets(result.datasets);
        setDataset(result.datasets.find((item) => item.is_active) ?? result.datasets[0] ?? null);
        setDatasetCount(result.datasets.length);
        setProfile(result.current);
      } else {
        setDataset(null);
        setProfile(null);
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchHeaderData, location.pathname]);

  const handleDatasetSwitch = useCallback(
    async (id: string) => {
      if (!id || id === dataset?.id || switchingId !== null) return;
      const next = datasets.find((item) => item.id === id);
      if (!next) return;
      setSwitchingId(id);
      setSwitchError("");
      try {
        await activateDataset(id);
        // 先更新页头，用户能立即知道操作已生效；整页重载负责清理各页面的数据缓存。
        setDataset(next);
        window.setTimeout(reloadPage, 250);
      } catch (error) {
        setSwitchError(error instanceof Error ? error.message : "切换数据集失败");
        setSwitchingId(null);
      }
    },
    [dataset?.id, datasets, switchingId],
  );

  const datasetMenuItems = useMemo<MenuProps["items"]>(
    () =>
      datasets.map((item) => ({
        key: item.id,
        label: item.is_active ? `${item.name}（当前）` : item.name,
        disabled: item.is_active || switchingId !== null,
      })),
    [datasets, switchingId],
  );

  const displayName = (profile?.name || "").trim();
  const photo = (profile?.photo || "").trim();
  const initial = displayName ? Array.from(displayName)[0] : "";
  // 数据集切换是点击触发的下拉：点开后 Tooltip 不该继续挂在按钮上，受控开关
  // 让"点开下拉"的同时把提示收掉，鼠标移开也不再滞留。
  const [datasetTipOpen, setDatasetTipOpen] = useState(false);

  return (
    <div className="app-header-context">
      {!ready ? (
        <Skeleton.Avatar active size={36} shape="circle" />
      ) : (
        <>
          {dataset ? (
            <Tooltip
              open={datasetTipOpen}
              onOpenChange={setDatasetTipOpen}
              title={
                datasetCount > 1
                  ? `当前数据集：${dataset.name}（共 ${datasetCount} 套），点击可直接切换`
                  : "当前数据集。点击可查看数据集操作"
              }
            >
              <span onClick={() => setDatasetTipOpen(false)}>
                <Dropdown
                  trigger={["click"]}
                  menu={{
                    items: datasetMenuItems,
                    onClick: ({ key }) => void handleDatasetSwitch(String(key)),
                  }}
                >
                  <button
                    type="button"
                    className="app-dataset-chip"
                    aria-label={`当前数据集：${dataset.name}`}
                    aria-haspopup="menu"
                  >
                    <DatabaseOutlined />
                    <span className="app-dataset-name">{dataset.name}</span>
                    <DownOutlined className="app-dataset-arrow" />
                  </button>
                </Dropdown>
              </span>
            </Tooltip>
          ) : null}
          <Tooltip title={displayName ? `${displayName}（点击进入我的资料）` : "点击进入我的资料"}>
            <button
              type="button"
              className="app-user-avatar-button"
              onClick={() => navigate("/profile")}
              aria-label="进入我的资料"
            >
              <Avatar
                size={36}
                src={photo || undefined}
                // AntD 的 Avatar 在有 icon 时会**忽略** children，所以"姓名首字"和"兜底图标"
                // 只能二选一：有名字就用首字（更像头像），没名字才用图标。
                icon={!photo && !initial ? <UserOutlined /> : undefined}
                className="app-user-avatar"
                alt={displayName ? `${displayName}的头像` : "用户头像"}
              >
                {!photo && initial ? initial : undefined}
              </Avatar>
            </button>
          </Tooltip>
          {switchError ? <span className="app-header-context-error">{switchError}</span> : null}
        </>
      )}
    </div>
  );
}
