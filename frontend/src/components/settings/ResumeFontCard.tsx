/**
 * 简历字体（R10）：上传字体文件，导出 PDF 时使用。
 *
 * 边界要说清楚：这里**只影响 PDF 导出**。界面字体跟系统走，网页预览用的是模板
 * 自带的字体栈——把"上传了字体但界面没变"说成 bug 是最容易发生的误会，所以卡片上
 * 直接写明。内置字体需要随包分发字体文件（约 13MB），当前版本只支持自定义上传。
 */
import { DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import { App, Button, Card, Empty, Listy, Space, Tag, Typography, Upload } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  activateResumeFont,
  deleteResumeFont,
  listResumeFonts,
  uploadResumeFont,
  type ResumeFonts,
} from "../../api/settings";
import { ListyItem } from "../common/ListyItem";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ResumeFontCard() {
  const { message, modal } = App.useApp();
  const [data, setData] = useState<ResumeFonts | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await listResumeFonts());
    } catch {
      // 读不到（老后端）就当作没有自定义字体，不影响其它设置。
      setData({ items: [], builtin: [], active: null, max_bytes: 20 * 1024 * 1024 });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const item = await uploadResumeFont(file);
      message.success(`已上传「${item.name}」，点「设为当前」后导出即生效`);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "上传字体失败");
    } finally {
      setBusy(false);
    }
  };

  const activate = async (name: string | null, builtin = false) => {
    try {
      await activateResumeFont(name, builtin);
      message.success(name ? `已切换到「${name}」` : "已回到系统字体");
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "切换字体失败");
    }
  };

  const remove = (name: string) => {
    modal.confirm({
      title: `删除字体「${name}」？`,
      content: "删除后如果它正在使用，导出会回到系统字体。",
      okText: "删除",
      cancelText: "取消",
      onOk: async () => {
        await deleteResumeFont(name);
        message.success("已删除");
        await load();
      },
    });
  };

  const items = data?.items ?? [];
  const builtin = data?.builtin ?? [];
  const activeName = data?.active?.name ?? null;
  const activeBuiltin = Boolean(data?.active?.builtin);

  return (
    <Card className="settings-card" title="简历字体">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        导出 PDF 时使用的字体。**只影响 PDF 导出**：界面与网页预览仍用系统字体。
        系统字体缺少你需要的字形（生僻字、繁体）时，上传一个字体文件即可。
      </Typography.Paragraph>
      <Space wrap style={{ marginBottom: 12 }}>
        <Upload
          accept=".ttf,.otf,.ttc"
          showUploadList={false}
          beforeUpload={(file) => {
            void upload(file as File);
            return false;
          }}
        >
          <Button icon={<UploadOutlined />} loading={busy}>
            上传字体（ttf / otf / ttc，≤20MB）
          </Button>
        </Upload>
        <Button disabled={!activeName} onClick={() => void activate(null)}>
          回到系统字体
        </Button>
      </Space>
      {builtin.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <Typography.Text strong>内置字体</Typography.Text>
          <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
            随应用分发，开箱可用
          </Typography.Text>
          <Listy
            items={builtin}
            rowKey={(item) => item.name}
            itemRender={(item) => {
              const isActive = activeBuiltin && item.name === activeName;
              return (
                <ListyItem>
                  <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
                    <Space>
                      <Typography.Text>{item.label || item.name}</Typography.Text>
                      {isActive ? <Tag color="blue">当前使用</Tag> : null}
                    </Space>
                    <Button
                      size="small"
                      disabled={isActive}
                      onClick={() => void activate(item.name, true)}
                    >
                      设为当前
                    </Button>
                  </Space>
                </ListyItem>
              );
            }}
          />
        </div>
      ) : null}
      {items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有上传字体，导出使用系统自带的中文字体"
        />
      ) : (
        <Listy
          items={items}
          rowKey={(item) => item.name}
          itemRender={(item) => (
            <ListyItem>
              <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
                <Space>
                  <Typography.Text>{item.name}</Typography.Text>
                  <Typography.Text type="secondary">{formatSize(item.size)}</Typography.Text>
                  {!activeBuiltin && item.name === activeName ? (
                    <Tag color="blue">当前使用</Tag>
                  ) : null}
                </Space>
                <Space size={4}>
                  <Button
                    size="small"
                    disabled={item.active}
                    onClick={() => void activate(item.name)}
                  >
                    设为当前
                  </Button>
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={`删除字体 ${item.name}`}
                    onClick={() => remove(item.name)}
                  />
                </Space>
              </Space>
            </ListyItem>
          )}
        />
      )}
    </Card>
  );
}
