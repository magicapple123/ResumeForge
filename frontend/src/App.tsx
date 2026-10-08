import { GithubOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import { Button, Layout, Menu, Modal, Skeleton, Tooltip, Typography } from "antd";
import {
  lazy,
  Suspense,
  type ComponentType,
  type LazyExoticComponent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import AppHeaderContext from "./components/AppHeaderContext";
import BackgroundTasksIndicator from "./components/BackgroundTasksIndicator";
import ExitAppButton from "./components/common/ExitAppButton";
import MySpaceMenu from "./components/navigation/MySpaceMenu";
import {
  MENU_ITEMS,
  NAVIGATION_ITEMS,
  PRIMARY_NAVIGATION_ITEMS,
  filterNavigationItems,
  pathMatchesNavigationItem,
} from "./components/navigation/navigationConfig";
import TaskCompletionNotifier from "./components/TaskCompletionNotifier";
import UpdateCheckButton from "./components/UpdateCheckButton";
import { APP_NAME, APP_VERSION, GITHUB_REPO } from "./config";
import TouTouAssistantCard from "./features/tou-tou/TouTouAssistantCard";
import TouTouClipboardCard from "./features/tou-tou/TouTouClipboardCard";
import TouTouOrb from "./features/tou-tou/TouTouOrb";
import { TouTouProvider } from "./features/tou-tou/TouTouProvider";
import { useNavigationVisibility } from "./hooks/useNavigationVisibility";
import { consumeFirstVisitGuide, setUserGuideVisible } from "./utils/userGuide";
// 侧栏品牌图标。走 import 而不是写死 "/resumeforge-icon.png"——Vite 会按 `base`
// 重写成正确前缀（在线体验产物部署在 Pages 子路径下，写死绝对路径会 404）。
// 特意用 src/assets/ 的副本而不是 public/ 下的同名文件：引用 public/ 里的资源不会
// 经过 Vite 的 base 重写，等于没修。
import brandIcon from "./assets/resumeforge-icon.png";
// 投投宣传图（透明底抠图）：GitHub Star 提示弹窗用。
import promoPlane from "./assets/toutou/promo-plane.png";

type LazyPage<Props = Record<string, never>> = LazyExoticComponent<ComponentType<Props>> & {
  preload: () => Promise<{ default: ComponentType<Props> }>;
};

function lazyPage<Props = Record<string, never>>(
  factory: () => Promise<{ default: ComponentType<Props> }>,
): LazyPage<Props> {
  let promise: Promise<{ default: ComponentType<Props> }> | null = null;
  const load = () => {
    promise ??= factory();
    return promise;
  };
  return Object.assign(lazy(load), { preload: load });
}

/** 首屏预热：起始延迟、每批 chunk 数与空闲调度参数。 */
const PRELOAD_START_DELAY_MS = 800;
const PRELOAD_BATCH_SIZE = 3;
const PRELOAD_IDLE_TIMEOUT_MS = 3_000;
const PRELOAD_IDLE_FALLBACK_MS = 200;

const HomePage = lazyPage(() => import("./pages/HomePage"));
const JobsPage = lazyPage(() => import("./pages/JobsPage"));
const ProfilePage = lazyPage(() => import("./pages/ProfilePage"));
const ClaimsPage = lazyPage(() => import("./pages/ClaimsPage"));
const DrillPage = lazyPage(() => import("./pages/DrillPage"));
const ResumesPage = lazyPage(() => import("./pages/ResumesPage"));
const ApplyPage = lazyPage(() => import("./pages/ApplyPage"));
const WebFormPage = lazyPage(() => import("./pages/WebFormPage"));
const TrackerPage = lazyPage(() => import("./pages/TrackerPage"));
const FavoritesPage = lazyPage(() => import("./pages/FavoritesPage"));
const AssistantPage = lazyPage(() => import("./pages/AssistantPage"));
const MaterialsPage = lazyPage(() => import("./pages/MaterialsPage"));
const KnowledgePage = lazyPage(() => import("./pages/KnowledgePage"));
const SkillsPage = lazyPage(() => import("./pages/SkillsPage"));
const InterviewPage = lazyPage(() => import("./pages/InterviewPage"));
const AnalyticsPage = lazyPage(() => import("./pages/AnalyticsPage"));
const SettingsPage = lazyPage(() => import("./pages/SettingsPage"));
const TrashPage = lazyPage(() => import("./pages/TrashPage"));
const UserGuideModal = lazy(() => import("./components/UserGuideModal"));

const { Sider, Header, Content } = Layout;

/**
 * 侧栏导航按「找岗位 → 做简历 → 投递跟进 → 面试准备 → 我的数据 → 系统」的顺序分组。
 *
 * 分组依据是用户真实的使用顺序，而不是功能上线时间：收藏夹紧跟岗位广场（同属"找岗位"），
 * 「我的资料」排在资料箱/工作台之前（它是后面几项的数据来源），「事实台账」靠近设置
 * （属于数据核对一类的低频入口）。**顺序即分组，不额外加分隔标题**——侧栏只有 200px，
 * 加分组标题会把 13 项挤成两屏。
 */
// 保留原来的导出位置，首页快捷入口和在线演示测试仍可从 App 取完整导航清单。
export { MENU_ITEMS };

function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [guideOpen, setGuideOpen] = useState(false);
  // GitHub Star 提示：点页头 GitHub 图标时随直跳弹一次轻提示（不做持久化，用户要求每次都提醒）。
  const [starModalOpen, setStarModalOpen] = useState(false);
  const [floatingAssistantOpen, setFloatingAssistantOpen] = useState(false);
  const [clipboardOpen, setClipboardOpen] = useState(false);
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
  const preloadPage = useCallback((path: string) => preloaders[path]?.(), [preloaders]);
  const menuItems = useMemo(
    () =>
      visiblePrimaryItems.map((item) => ({
        ...item,
        label: (
          <span
            onMouseEnter={() => void preloadPage(item.key)}
            onFocus={() => void preloadPage(item.key)}
          >
            {item.label}
          </span>
        ),
      })),
    [preloadPage, visiblePrimaryItems],
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
        if (typeof preload === "function") void preload();
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
    if (consumeFirstVisitGuide()) setGuideOpen(true);
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
    void import("./demo/demoBridge").then(({ installDemoBridge }) => {
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
        {/* 批次完成全局通知：挂在布局层，投递/采集跑完时无论用户在哪个页面都能收到。 */}
        <TaskCompletionNotifier />
        <TouTouOrb
          isWebform={location.pathname === "/webform"}
          onOpen={() => {
            void AssistantPage.preload();
            setFloatingAssistantOpen(true);
          }}
          onOpenClipboard={() => setClipboardOpen(true)}
        />
        <TouTouAssistantCard
          open={floatingAssistantOpen}
          onClose={() => setFloatingAssistantOpen(false)}
        >
          <Suspense fallback={<Skeleton active paragraph={{ rows: 8 }} />}>
            <AssistantPage compact surface="floating" />
          </Suspense>
        </TouTouAssistantCard>
        <TouTouClipboardCard open={clipboardOpen} onClose={() => setClipboardOpen(false)} />
        <Layout className="app-shell">
          <Sider
            className="app-sider"
            theme="light"
            width={200}
            breakpoint="lg"
            collapsedWidth={64}
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
                aria-label="回到当前页面顶部"
              >
                {/* 用 import 拿到带 base 前缀的 URL，不要写死 "/resumeforge-icon.png"：
                  在线体验构建把产物部署在 GitHub Pages 的**子路径**（base: "./"）下，
                  写死的绝对路径会指到域名根目录、图标 404。import 由 Vite 按 base 重写。 */}
                <img className="app-brand-image" src={brandIcon} alt="" />
              </button>
              <span className="app-brand-copy">
                <span className="app-brand-name">
                  {APP_NAME}
                  {/* 版本号低调跟在应用名旁：次要文字色 + 小字号，不抢视觉；
                    hover 有 title 说明。值来自 package.json（版本单源）。 */}
                  <span className="app-brand-version" title="当前版本">
                    v{APP_VERSION}
                  </span>
                </span>
                <span className="app-brand-caption">AI 简历工作台</span>
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
                <Tooltip title="使用指南" placement="right">
                  <Button
                    className="app-guide-button"
                    type="text"
                    icon={<QuestionCircleOutlined />}
                    onClick={() => setGuideOpen(true)}
                    aria-label="使用指南"
                  >
                    <span className="app-guide-label">使用指南</span>
                  </Button>
                </Tooltip>
                {/* 开源仓库入口在页头右上角（见下面的 Header）。页脚这一行是
                  「使用指南 + 检查更新」：都是"偶尔想确认一下"的低频动作，凑在左下角。 */}
                <UpdateCheckButton />
              </div>
            </div>
          </Sider>
          <Layout className="app-main">
            <Header className="app-header">
              <Typography.Text strong className="app-header-title">
                AI 定制化简历生成平台
              </Typography.Text>
              <div className="app-header-actions">
                {/* 左侧是"我当前在哪个数据集、用的哪张照片"，右侧是全局动作（源码 / 退出）。
                  两者之间用一根细分隔线隔开，避免四个元素挤成一条。 */}
                <MySpaceMenu hiddenKeys={hiddenKeys} />
                <AppHeaderContext />
                {/* 有任务在跑时才出现：平时页头不该多一个空按钮。 */}
                <BackgroundTasksIndicator />
                <span className="app-header-divider" aria-hidden="true" />
                {/* GitHub 入口在页头右上角：与「退出」并排。
                  它是"关于本项目"这类低频、跨页面的入口，放右上角既符合习惯，
                  也不必让用户先找到侧栏底部。 */}
                {GITHUB_REPO && (
                  <Tooltip title="在 GitHub 上查看源码 / 反馈问题">
                    <Button
                      className="app-repo-button"
                      type="text"
                      icon={<GithubOutlined />}
                      href={GITHUB_REPO}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`在 GitHub 上查看 ${APP_NAME} 源码`}
                      onClick={() => setStarModalOpen(true)}
                    />
                  </Tooltip>
                )}
                <ExitAppButton />
              </div>
            </Header>
            <Content className="app-content">
              <Suspense fallback={<Skeleton active paragraph={{ rows: 8 }} />}>
                <Outlet />
              </Suspense>
            </Content>
          </Layout>
        </Layout>
        {guideOpen && (
          <Suspense fallback={null}>
            <UserGuideModal
              open
              onClose={() => setGuideOpen(false)}
              onNavigate={navigateFromGuide}
            />
          </Suspense>
        )}
        {starModalOpen && (
          <Modal open onCancel={() => setStarModalOpen(false)} footer={null} width={380} centered>
            <div style={{ textAlign: "center", paddingBlock: 8 }}>
              <img
                src={promoPlane}
                alt=""
                style={{ height: 72, width: "auto", objectFit: "contain" }}
              />
              <Typography.Title level={5} style={{ marginTop: 12, marginBottom: 4 }}>
                如果 {APP_NAME} 对你有帮助
              </Typography.Title>
              <Typography.Text type="secondary">
                欢迎去 GitHub 给项目点一个 Star ⭐——这是对独立开发最实在的支持。
              </Typography.Text>
              <div style={{ marginTop: 16 }}>
                <Button
                  type="primary"
                  href={GITHUB_REPO}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setStarModalOpen(false)}
                >
                  去点 Star
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </>
    </TouTouProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/resumes" element={<ResumesPage />} />
        <Route path="/apply" element={<ApplyPage />} />
        <Route path="/webform" element={<WebFormPage />} />
        <Route path="/tracker" element={<TrackerPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/assistant" element={<AssistantPage />} />
        <Route path="/materials" element={<MaterialsPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/skills" element={<SkillsPage />} />
        <Route path="/interview" element={<InterviewPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/claims" element={<ClaimsPage />} />
        <Route path="/trash" element={<TrashPage />} />
        <Route path="/claims/drill" element={<DrillPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
