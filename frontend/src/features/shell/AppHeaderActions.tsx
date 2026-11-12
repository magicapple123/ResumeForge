// SPDX-License-Identifier: Apache-2.0
/**
 * 页头右侧动作区（R21 抽出，A3 起承载主题切换）：主题、模型切换、我的空间、
 * 数据集/头像、后台任务、源码与退出。
 *
 * 单独成文件是为了让 App.tsx 留在单文件行数预算内；这里只做组合，不持有状态。
 * 全站搜索的放大镜已从这里移除（D）：⌘/Ctrl+K 与弹层由 GlobalOverlays 统一挂载。
 *
 * 桌面壳里**不渲染页内「退出」**（问题清单 §18）：系统 × / 托盘 / 标题栏「文件→退出」
 * 已经覆盖退出，页内再放一个只会和窗口控件重复。浏览器发行版必须保留它——那里没有
 * 系统窗口控件，这个按钮是停掉后端与 Vite 进程树的唯一入口。
 */
import { GithubOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import AppHeaderContext from "./AppHeaderContext";
import BackgroundTasksIndicator from "./BackgroundTasksIndicator";
import ExitAppButton from "../../components/common/ExitAppButton";
import ModelProfileSelect from "../settings/ModelProfileSelect";
import MySpaceMenu from "./MySpaceMenu";
import ScenarioSelector from "../career-scenarios/ScenarioSelector";
import ThemeSwitch from "../theme/ThemeSwitch";
import { GITHUB_REPO } from "../../config";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  hiddenKeys: readonly string[];
  /** 点击 GitHub 图标时顺便弹「点个 Star」提示。 */
  onStarClick: () => void;
}

export default function AppHeaderActions({ hiddenKeys, onStarClick }: Props) {
  useLocale();
  // 桌面壳注入的静态桥：页面生命周期内不会变，读一次即可。
  const isDesktop = Boolean(window.splash?.isDesktop);
  return (
    <div className="app-header-actions">
      {/* 主题三档（A3）：放在最前，与语言/空间等"显示偏好"类动作归在一组。 */}
      <ThemeSwitch />
      {/* 模型切换放在数据集与头像的**左侧**：先说明"用哪套模型"，再说"在哪份数据里"。
          「我的空间」不在这里，而是走 AppHeaderContext 的 beforeAvatar 插槽——视觉顺序
          要的是 `[数据集][我的空间][头像]`，而它们是两个 flex 容器，`order` 跨不过去。 */}
      <ModelProfileSelect />
      {/* A2：职业场景是"本窗口的引导建议"，与数据集（在哪份数据里）语义分开、并排但成组。 */}
      <ScenarioSelector />
      <AppHeaderContext beforeAvatar={<MySpaceMenu hiddenKeys={hiddenKeys} />} />
      {/* 有任务在跑时才出现：平时页头不该多一个空按钮。 */}
      <BackgroundTasksIndicator />
      <span className="app-header-divider" aria-hidden="true" />
      {/* GitHub 入口在页头右上角：与「退出」并排，符合"关于本项目"这类低频入口的习惯。 */}
      {GITHUB_REPO && (
        <Tooltip title={t("appConfig.header.repoTooltip")}>
          <Button
            className="app-repo-button"
            type="text"
            icon={<GithubOutlined />}
            href={GITHUB_REPO}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("appConfig.header.repoAria", { name: t("appConfig.brand.name") })}
            onClick={onStarClick}
          />
        </Tooltip>
      )}
      {/* 桌面版隐藏页内退出（§18.5：组件本身不能删——浏览器发行版靠它停服务）。 */}
      {!isDesktop && <ExitAppButton />}
    </div>
  );
}
