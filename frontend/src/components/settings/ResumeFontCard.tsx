/**
 * 简历字体（R10）：上传字体文件，预览、导出 HTML 与导出 PDF 统一使用。
 *
 * 同源性要说清楚：选中的字体会被渲染层按用到的字形子集化，内嵌进预览 HTML，
 * 导出的 HTML 里也带着同一份子集，PDF 直接读同一个字体文件。**界面本身**（设置页、
 * 列表页）仍跟系统字体走——把"设置页没变"说成 bug 是最容易发生的误会。
 * 字体不随应用分发：一款中文字体动辄十几 MB，体积与授权都该由用户自己决定，
 * 所以这里只做"上传 → 选用"这一条路。
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
      setData({ items: [], active: null, max_bytes: 20 * 1024 * 1024 });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const item = await uploadResumeFont(file);
      message.success(`已上传「${item.name}」，点「设为当前」后预览与导出即生效`);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "上传字体失败");
    } finally {
      setBusy(false);
    }
  };

  const activate = async (name: string | null) => {
    try {
      await activateResumeFont(name);
      message.success(name ? `已切换到「${name}」` : "已回到系统字体");
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "切换字体失败");
    }
  };

  const remove = (name: string) => {
    modal.confirm({
      title: `删除字体「${name}」？`,
      content: "删除后如果它正在使用，预览与导出会回到系统字体。",
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
  const activeName = data?.active ?? null;

  return (
    <Card className="settings-card" title="简历字体">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        用于预览、HTML 与 PDF：选中的字体在预览里立刻生效，导出的 HTML / PDF 也是同一款字。
        界面本身（设置页、列表页）仍使用系统字体。
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
      {items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有上传字体，预览与导出使用系统自带的中文字体"
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
                  {item.name === activeName ? <Tag color="blue">当前使用</Tag> : null}
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
