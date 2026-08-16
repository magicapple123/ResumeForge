import {
  FileTextOutlined,
  HomeOutlined,
  ProfileOutlined,
  SearchOutlined,
  SettingOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { Layout, Menu, Typography } from "antd";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { APP_NAME, APP_NAME_EN, GITHUB_REPO } from "./config";
import HomePage from "./pages/HomePage";
import JobsPage from "./pages/JobsPage";
import ProfilePage from "./pages/ProfilePage";
import ResumesPage from "./pages/ResumesPage";
import SettingsPage from "./pages/SettingsPage";

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
  const selectedKey = MENU_ITEMS.find((item) => item.key !== "/" && location.pathname.startsWith(item.key))?.key ?? "/";

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider theme="dark" width={200} breakpoint="lg" collapsedWidth={64}>
        <div style={{ padding: "18px 20px", color: "#fff", fontSize: 18, fontWeight: 700 }}>
          <UnorderedListOutlined style={{ marginRight: 8 }} />
          {APP_NAME}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={MENU_ITEMS}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: "#fff",
            padding: "0 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <Typography.Text strong style={{ fontSize: 16 }}>
            AI 定制化简历生成平台
          </Typography.Text>
          <Typography.Link href={GITHUB_REPO} target="_blank">
            {APP_NAME_EN} · 开源项目
          </Typography.Link>
        </Header>
        <Content style={{ padding: 24 }}>
          <Outlet />
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
