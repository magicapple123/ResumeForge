import {
  FileTextOutlined,
  HomeOutlined,
  ProfileOutlined,
  SearchOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Layout, Menu, Skeleton, Typography } from "antd";
import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { APP_NAME, APP_NAME_EN, GITHUB_REPO } from "./config";

const HomePage = lazy(() => import("./pages/HomePage"));
const JobsPage = lazy(() => import("./pages/JobsPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const ResumesPage = lazy(() => import("./pages/ResumesPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

const { Sider, Header, Content } = Layout;

const MENU_ITEMS = [
  { key: "/", icon: <HomeOutlined />, label: "首页" },
  { key: "/jobs", icon: <SearchOutlined />, label: "岗位广场" },
  { key: "/resumes", icon: <FileTextOutlined />, label: "简历中心" },
  { key: "/profile", icon: <ProfileOutlined />, label: "我的资料" },
  { key: "/settings", icon: <SettingOutlined />, label: "设置" },
];

function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const selectedKey =
    MENU_ITEMS.find((item) => item.key !== "/" && location.pathname.startsWith(item.key))?.key ??
    "/";

  return (
    <Layout className="app-shell">
      <Sider className="app-sider" theme="light" width={200} breakpoint="lg" collapsedWidth={64}>
        <div className="app-brand">
          <span className="app-brand-mark">
            <img className="app-brand-image" src="/resumeforge-icon.png" alt="" />
          </span>
          <span className="app-brand-copy">
            <span className="app-brand-name">{APP_NAME}</span>
            <span className="app-brand-caption">AI 简历工作台</span>
          </span>
        </div>
        <Menu
          className="app-nav-menu"
          theme="light"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={MENU_ITEMS}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout className="app-main">
        <Header className="app-header">
          <Typography.Text strong className="app-header-title">
            AI 定制化简历生成平台
          </Typography.Text>
          {GITHUB_REPO && (
            <Typography.Link
              className="app-header-repo"
              href={GITHUB_REPO}
              target="_blank"
              rel="noopener noreferrer"
            >
              {APP_NAME_EN} · 开源项目
            </Typography.Link>
          )}
        </Header>
        <Content className="app-content">
          <Suspense fallback={<Skeleton active paragraph={{ rows: 8 }} />}>
            <Outlet />
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/resumes" element={<ResumesPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
