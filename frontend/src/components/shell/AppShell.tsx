// SPDX-License-Identifier: Apache-2.0
import { MenuOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import { Button, Layout, Menu, Tooltip, Typography } from "antd";
import AppHeaderActions from "../../components/AppHeaderActions";
import AnnouncementBar from "../../components/common/AnnouncementBar";
import BackgroundTaskBar from "../../components/BackgroundTaskBar";
import { useUpdateAnnouncement } from "../../features/announcements/useUpdateAnnouncement";
import StarPromptModal from "../../components/StarPromptModal";
import PageSkeleton from "../../components/common/PageSkeleton";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { registerTaskNavigate } from "../../utils/taskNotify";
import RiskScanWatcher from "../../components/RiskScanWatcher";
import SuggestionScanWatcher from "../../components/SuggestionScanWatcher";
import MobileNavigation from "../../components/navigation/MobileNavigation";
import RouteAccessibility from "../../components/navigation/RouteAccessibility";
import {
  NAVIGATION_ITEMS,
  PRIMARY_NAVIGATION_ITEMS,
  filterNavigationItems,
  navigationPageLabelKey,
  pathMatchesNavigationItem,
} from "../../components/navigation/navigationConfig";
import TaskCompletionNotifier from "../../components/TaskCompletionNotifier";
import { APP_NAME_KEY, APP_VERSION } from "../../config";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import GlobalOverlays from "../../components/GlobalOverlays";
import AiPolishLayer from "../../features/ai-polish/AiPolishLayer";
import ShortcutProvider from "../../features/shortcuts/ShortcutProvider";
import { useShortcut } from "../../features/shortcuts/useShortcutKeymap";
import { triggerJobCreate } from "../../features/shortcuts/runtimeTargets";
import { useAppShortcuts } from "../../features/shortcuts/useAppShortcuts";
import TouTouAssistantCard from "../../features/tou-tou/TouTouAssistantCard";
import TouTouClipboardCard from "../../features/tou-tou/TouTouClipboardCard";
import TouTouOrb from "../../features/tou-tou/TouTouOrb";
import { TouTouProvider } from "../../features/tou-tou/TouTouProvider";
import { useNavigationVisibility } from "../../hooks/useNavigationVisibility";
import { useResponsiveShell } from "../../hooks/useResponsiveShell";
import {
  AnalyticsPage,
  ApplyPage,
  AssistantPage,
  ClaimsPage,
  DrillPage,
  FavoritesPage,
  HomePage,
  InterviewPage,
  JobsPage,
  KnowledgePage,
  MaterialsPage,
  ProfilePage,
  ResumesPage,
  SettingsPage,
  SkillsPage,
  TrackerPage,
  TrashPage,
  WebFormPage,
} from "../../pages/registry";
import { UserGuideModal } from "../../pages/modals";
import { consumeFirstVisitGuide, setUserGuideVisible } from "../../utils/userGuide";
// 侧栏品牌图标。走 import 而不是写死 "/resumeforge-icon.png"——Vite 会按 `base`
// 重写成正确前缀（在线体验产物部署在 Pages 子路径下，写死绝对路径会 404）。
// 特意用 src/assets/ 的副本而不是 public/ 下的同名文件：引用 public/ 里的资源不会
// 经过 Vite 的 base 重写，等于没修。
import brandIcon from "../../assets/resumeforge-icon.png";
// 投投宣传图（透明底抠图）：GitHub Star 提示弹窗用。

/** 首屏预热：起始延迟、每批 chunk 数与空闲调度参数。 */
const PRELOAD_START_DELAY_MS = 800;
const PRELOAD_BATCH_SIZE = 3;
const PRELOAD_IDLE_TIMEOUT_MS = 3_000;
const PRELOAD_IDLE_FALLBACK_MS = 200;

const { Sider, Header, Content } = Layout;

/**
 * 侧栏导航按「找岗位 → 做简历 → 投递跟进 → 面试准备 → 我的数据 → 系统」的顺序分组。
 *
 * 分组依据是用户真实的使用顺序，而不是功能上线时间：收藏夹紧跟岗位广场（同属"找岗位"），
 * 「我的资料」排在资料箱/工作台之前（它是后面几项的数据来源），「事实台账」靠近设置
 * （属于数据核对一类的低频入口）。**顺序即分组，不额外加分隔标题**——侧栏只有 200px，
 * 加分组标题会把 13 项挤成两屏。
 */
export default function AppShell() {
  const locale = useLocale();
  const shell = useResponsiveShell();
  const navigate = useNavigate();
  const location = useLocation();
  // 全局完成通知的动作按钮（如"查看结果"）跳页面用：Router 内注册，Router 外静默。
  useEffect(() => {
    registerTaskNavigate(navigate);
    return () => registerTaskNavigate(null);
  }, [navigate]);
  const [guideOpen, setGuideOpen] = useState(false);
  // 本次会话是否由「首次访问」自动弹出的：只有这一种打开先给「快速开始」首屏；
  // 关闭后归位，侧栏「使用指南」重开一律直接进完整 8 步视图。
  const [guideOpenedAutomatically, setGuideOpenedAutomatically] = useState(false);
  // GitHub Star 提示：点页头 GitHub 图标时随直跳弹一次轻提示（不做持久化，用户要求每次都提醒）。
  const [starModalOpen, setStarModalOpen] = useState(false);
  const [floatingAssistantOpen, setFloatingAssistantOpen] = useState(false);
  const [clipboardOpen, setClipboardOpen] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const closeMobileNavigation = useCallback(() => setMobileNavigationOpen(false), []);
  // R5 快捷键的三个全局落点，全部接在既有实现上（不新造入口）：
  // 搜索 = 跳首页 + 聚焦首页那个全站搜索框；助手 = 复用悬浮助手卡的开关；
  // 新建岗位 = 岗位页自己登记的"打开新建弹窗"（不在岗位页就什么都不做）。
  useShortcut("assistant", () => setFloatingAssistantOpen((open) => !open));
  useShortcut("newJob", () => location.pathname === "/jobs" && triggerJobCreate());
  useAppShortcuts(() => setFloatingAssistantOpen(true));
  // 公告条唯一的真实来源（更新可用 / 安装包已下载）；失败静默，不留痕。
  useUpdateAnnouncement();
  const { hiddenKeys } = useNavigationVisibility();
  const visiblePrimaryItems = useMemo(
    () => filterNavigationItems(PRIMARY_NAVIGATION_ITEMS, hiddenKeys, location.pathname),
    [hiddenKeys, location.pathname],
  );
  const preloaders = useMemo<Record<string, () => Promise<unknown>>>(
    () => ({
      "/": HomePage.preload,
      "/jobs": JobsPage.preload,
      "/profile": ProfilePage.preload,
      "/claims": ClaimsPage.preload,
      "/claims/drill": DrillPage.preload,
      "/resumes": ResumesPage.preload,
      "/apply": ApplyPage.preload,
      "/webform": WebFormPage.preload,
      "/tracker": TrackerPage.preload,
      "/favorites": FavoritesPage.preload,
      "/assistant": AssistantPage.preload,
      "/materials": MaterialsPage.preload,
      "/knowledge": KnowledgePage.preload,
      "/skills": SkillsPage.preload,
      "/interview": InterviewPage.preload,
      "/analytics": AnalyticsPage.preload,
      "/settings": SettingsPage.preload,
      "/trash": TrashPage.preload,
    }),
    [],
  );
  /**
   * 预热只影响"快不快"，不影响"能不能"：真导航时 `lazy()` 会自己再取一次（失败缓存已在
   * `pages/registry.ts` 里清掉），错误由 `AppErrorBoundary` 按"页面代码没能加载完整"报。
   * 这里必须吞掉——空闲分批预热失败时没人 await，不吞就是一条没人处理的 rejection。
   */
  const preloadPage = useCallback(
    (path: string) => {
      void preloaders[path]?.().catch(() => {});
    },
    [preloaders],
  );
  const menuItems = useMemo(
    () =>
      visiblePrimaryItems.map((item) => ({
        key: item.key,
        icon: item.icon,
        "aria-label": t(item.labelKey),
        label: (
          <span
            onMouseEnter={() => void preloadPage(item.key)}
            onFocus={() => void preloadPage(item.key)}
          >
            {t(item.labelKey)}
          </span>
        ),
      })),
    [locale, preloadPage, visiblePrimaryItems],
  );
  const selectedKey =
    NAVIGATION_ITEMS.find((item) => pathMatchesNavigationItem(location.pathname, item))?.key ?? "/";

  useEffect(() => {
    // 首屏稳定后预热页面代码块，但不触发页面数据请求；首次点击侧栏时只需挂载组件。
    // 18 个 chunk 一次性发起会挤占带宽并触发一串编译，改为空闲时分批（每批 3 个）。
    // jsdom / 旧环境没有 requestIdleCallback：特性检测后回退 setTimeout。
    const requestIdle =
      typeof window.requestIdleCallback === "function"
        ? (task: () => void) =>
            window.requestIdleCallback(() => task(), { timeout: PRELOAD_IDLE_TIMEOUT_MS })
        : (task: () => void) => window.setTimeout(task, PRELOAD_IDLE_FALLBACK_MS);
    const cancelIdle =
      typeof window.cancelIdleCallback === "function"
        ? (handle: number) => window.cancelIdleCallback(handle)
        : (handle: number) => window.clearTimeout(handle);

    let cancelled = false;
    let idleHandle: number | null = null;
    const paths = Object.keys(preloaders);
    let index = 0;
    const runNextBatch = () => {
      if (cancelled) return;
      const end = Math.min(index + PRELOAD_BATCH_SIZE, paths.length);
      for (; index < end; index += 1) {
        const preload = preloaders[paths[index]];
        // 预热失败不得产生未处理的 rejection：这条路径没有任何人 await。
        if (typeof preload === "function") void preload().catch(() => {});
      }
      if (index < paths.length) {
        idleHandle = requestIdle(runNextBatch);
      }
    };

    const timer = window.setTimeout(() => {
      idleHandle = requestIdle(runNextBatch);
    }, PRELOAD_START_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (idleHandle !== null) cancelIdle(idleHandle);
    };
  }, [preloaders]);

  // StrictMode 下 consume 会写两次 localStorage 标记，因此必须在 effect 中原子
  // 消费而不是渲染期求值（渲染期求值会被双调用打断原子性）。按书面理由豁免。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (consumeFirstVisitGuide()) {
      setGuideOpenedAutomatically(true);
      setGuideOpen(true);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 引导开关状态同步给首页的「近期提醒」启动弹窗：欢迎在前、提醒在后，两个不叠。
  useEffect(() => {
    setUserGuideVisible(guideOpen);
  }, [guideOpen]);

  /**
   * 在线体验模式：接收官网 iframe 发来的切页指令。
   *
   * 动态 import 是刻意的——静态引入会让 `src/demo/*` 进入主发行包的依赖图。
   * 演示构建里这一段会真正跑起来；普通构建里 `import.meta.env.VITE_DEMO_MODE`
   * 恒为 undefined，条件永假，打包器把整块摇掉。
   */
  useEffect(() => {
    if (import.meta.env.VITE_DEMO_MODE !== "1") return;
    let uninstall: (() => void) | undefined;
    void import("../../demo/demoBridge").then(({ installDemoBridge }) => {
      uninstall = installDemoBridge(navigate);
    });
    return () => uninstall?.();
  }, [navigate]);

  const navigateFromGuide = (path: string) => {
    navigate(path);
  };

  return (
    <TouTouProvider>
      <>
        <RouteAccessibility />
        {/* 批次完成全局通知：挂在布局层，投递/采集跑完时无论用户在哪个页面都能收到。 */}
        <TaskCompletionNotifier />
        {/* 风险扫描的后台提醒：用户关掉「质量检测」弹窗后，进度与结果由它接住。 */}
        <RiskScanWatcher />
        {/* 岗位优化建议的后台提醒：关掉建议弹窗后，生成进度与结果由它接住。 */}
        <SuggestionScanWatcher />
        {/* 全局 AI 润色：文档级监听，任何输入框里选中一段文字都能就地改写。 */}
        <AiPolishLayer />

        {/* 快捷键：唯一的 keydown 监听挂载点；动作由各页面用 useShortcut 自己认领。 */}
        <ShortcutProvider />
        <GlobalOverlays />
        <TouTouOrb
          isWebform={location.pathname === "/webform"}
          onOpen={() => {
            // 同上：悬浮助手卡自己在 Suspense 里取模块，这里只是提前热一下，失败不该冒泡。
            void AssistantPage.preload().catch(() => {});
            setFloatingAssistantOpen(true);
          }}
          onOpenClipboard={() => setClipboardOpen(true)}
        />
        <TouTouAssistantCard
          open={floatingAssistantOpen}
          onClose={() => setFloatingAssistantOpen(false)}
        >
          <Suspense fallback={<PageSkeleton rows={8} />}>
            <AssistantPage compact surface="floating" />
          </Suspense>
        </TouTouAssistantCard>
        <TouTouClipboardCard open={clipboardOpen} onClose={() => setClipboardOpen(false)} />
        <Layout className="app-shell">
          {/* 宽度完全交给 CSS 变量；antd 6 的 SiderProps.width 是 number|string，
              非数字会原样写进 inline style（Sider.js 的 isNumeric 分支），所以这里传
              var() 是受支持的用法。折叠与否由 useResponsiveShell 给，判据与
              `@media (max-width:1092px)` 同一个断点常量。 */}
          <Sider
            className="app-sider"
            theme="light"
            width="var(--rf-sider-width)"
            collapsedWidth="var(--rf-sider-width)"
            collapsed={shell.collapsed}
          >
            <div className="app-brand-button">
              <button
                type="button"
                className="app-brand-mark app-brand-mark-button"
                onClick={() => {
                  const scroller = document.querySelector<HTMLElement>(".app-main");
                  const content = document.querySelector<HTMLElement>(
                    ".app-main .ant-layout-content",
                  );
                  const position = { top: 0, behavior: "smooth" as const };
                  if (typeof scroller?.scrollTo === "function") scroller.scrollTo(position);
                  if (typeof content?.scrollTo === "function") content.scrollTo(position);
                  if (typeof window.scrollTo === "function") window.scrollTo(position);
                }}
                aria-label={t("navigation.shell.scrollTop")}
              >
                {/* 用 import 拿到带 base 前缀的 URL，不要写死 "/resumeforge-icon.png"：
                  在线体验构建把产物部署在 GitHub Pages 的**子路径**（base: "./"）下，
                  写死的绝对路径会指到域名根目录、图标 404。import 由 Vite 按 base 重写。 */}
                <img className="app-brand-image" src={brandIcon} alt="" />
              </button>
              <span className="app-brand-copy">
                <span className="app-brand-name">
                  {t(APP_NAME_KEY)}
                  {/* 版本号低调跟在应用名旁：次要文字色 + 小字号，不抢视觉；
                    说明走 Tooltip 而不是原生 title —— 后者只对鼠标可见，键盘用户与读屏
                    都拿不到"这是什么"。Tooltip 不产生 DOM，`className` 仍留在 span 上，
                    页头品牌区的布局不受影响。值来自 package.json（版本单源）。 */}
                  <Tooltip title={t("navigation.shell.versionTooltip")}>
                    <span className="app-brand-version">v{APP_VERSION}</span>
                  </Tooltip>
                </span>
                <span className="app-brand-caption">{t("navigation.shell.brandCaption")}</span>
              </span>
            </div>
            <Menu
              className="app-nav-menu"
              theme="light"
              mode="inline"
              selectedKeys={[selectedKey]}
              items={menuItems}
              onClick={({ key }) => {
                void preloadPage(String(key));
                navigate(key);
              }}
            />
            <div className="app-sider-footer">
              <div className="app-sider-footer-row">
                <Button
                  className="app-guide-button"
                  type="text"
                  icon={<QuestionCircleOutlined />}
                  onClick={() => setGuideOpen(true)}
                  aria-label={t("navigation.guide.open")}
                >
                  <span className="app-guide-label">{t("navigation.guide.open")}</span>
                </Button>
                {/* 开源仓库入口在页头右上角（见下面的 Header）。检查更新入口已按用户
                  要求从左下角移除：统一走「设置」页的更新卡片。 */}
              </div>
            </div>
          </Sider>
          <Layout className="app-main">
            <Header className="app-header">
              <Button
                type="text"
                className="app-mobile-menu-button"
                id="mobile-navigation-trigger"
                icon={<MenuOutlined />}
                aria-label={t("navigation.shell.openMenu")}
                aria-expanded={mobileNavigationOpen}
                aria-controls={mobileNavigationOpen ? "mobile-navigation" : undefined}
                onClick={() => setMobileNavigationOpen(true)}
              />
              <Typography.Text strong className="app-header-title">
                {t("navigation.shell.title")}
                <span className="app-header-page-label">
                  {t(navigationPageLabelKey(location.pathname))}
                </span>
              </Typography.Text>
              <AppHeaderActions
                hiddenKeys={hiddenKeys}
                onStarClick={() => setStarModalOpen(true)}
              />
            </Header>
            {/* 顶部公告条：常驻、手关、不自动消失。无公告时自身 return null。 */}
            <AnnouncementBar />
            {/* 常驻任务条：无任务时组件自身 return null，不占位。 */}
            <BackgroundTaskBar />
            <Content className="app-content" id="main-content" role="main" tabIndex={-1}>
              <Suspense fallback={<PageSkeleton rows={8} />}>
                <Outlet />
              </Suspense>
            </Content>
          </Layout>
        </Layout>
        <MobileNavigation
          open={mobileNavigationOpen}
          items={menuItems}
          selectedKey={selectedKey}
          onClose={closeMobileNavigation}
          onOpenGuide={() => setGuideOpen(true)}
          onNavigate={(path) => {
            void preloadPage(path);
            navigate(path);
          }}
        />
        {guideOpen && (
          <Suspense fallback={null}>
            <UserGuideModal
              open
              // 首次自动弹出先给「快速开始」首屏；侧栏「使用指南」重开时不带该 prop，
              // 直接进完整 8 步视图。
              initialQuickStart={guideOpenedAutomatically}
              onClose={() => {
                setGuideOpen(false);
                setGuideOpenedAutomatically(false);
              }}
              onNavigate={navigateFromGuide}
            />
          </Suspense>
        )}
        <StarPromptModal open={starModalOpen} onClose={() => setStarModalOpen(false)} />
      </>
    </TouTouProvider>
  );
}
