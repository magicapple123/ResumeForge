/**
 * 「页面要求但这一轮不会自动填」的清单。
 *
 * 三块**必须分开显示**，因为用户该做的事完全不同：
 * - 资料里没有 → 去「我的资料」补上，下次就读得到了；
 * - 永不自动填 → 验证码、附件、他人信息、同意条款，只能自己动手（这不是缺陷，是刻意的）；
 * - 没认出来 → 这一步帮不上，**默认收起**。
 *
 * 「没认出来」单独收起是有实测依据的：腾讯校招简历页 69 个控件里有 36 个落在这一类，
 * 而其中一半以上是「可添加多条」的区块（实习经历 / 项目经历 / 获奖信息）里的字段——
 * 那类区块本版不处理。一股脑铺开会让用户以为这个功能什么都没干成，其实能填的都已经
 * 列在上面了。
 */
import { Alert, Card, Collapse, Empty, List, Space, Tag, Typography } from "antd";
import { Link } from "react-router-dom";
import type { WebFormPendingItem } from "../../types";

interface Props {
  missingData: WebFormPendingItem[];
  unrecognized: WebFormPendingItem[];
  blocked: WebFormPendingItem[];
}

function Lines({ items }: { items: WebFormPendingItem[] }) {
  return (
    <List
      size="small"
      dataSource={items}
      renderItem={(item) => (
        <List.Item>
          <Space size={8} wrap>
            <Typography.Text>{item.label || `第 ${item.index + 1} 个控件`}</Typography.Text>
            {item.required ? <Tag color="red">必填</Tag> : null}
            {item.field_label ? (
              <Typography.Text type="secondary">{item.field_label}</Typography.Text>
            ) : null}
          </Space>
        </List.Item>
      )}
    />
  );
}

export default function WebFormPendingPanel({ missingData, unrecognized, blocked }: Props) {
  if (!missingData.length && !unrecognized.length && !blocked.length) {
    return (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这一页没有需要你手动处理的项" />
    );
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {missingData.length ? (
        <Card
          size="small"
          title={`资料里还没有（${missingData.length} 项）`}
          extra={<Link to="/profile">去我的资料补上</Link>}
        >
          <Lines items={missingData} />
        </Card>
      ) : null}

      {blocked.length ? (
        <Card size="small" title={`需要你自己动手（${blocked.length} 项）`}>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 8 }}
            message="这些不会自动填：密码与验证码是刻意的安全边界；简历附件、他人信息与「我已阅读并同意」这类确认项也不该由程序代填。"
          />
          <Lines items={blocked} />
        </Card>
      ) : null}

      {unrecognized.length ? (
        <Collapse
          size="small"
          items={[
            {
              key: "unrecognized",
              label: `没认出来（${unrecognized.length} 项，点开查看）`,
              children: (
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  <Typography.Text type="secondary">
                    多半是「可添加多条」的区块（实习经历 / 项目经历 / 获奖信息）里的字段，
                    以及这张表特有的问题（导师、实验室、研究方向等）——这一类目前没有对应的资料可填，
                    不会硬猜一个值写进去。上面「将填入」列出的才是这次真正会填的。
                  </Typography.Text>
                  <Lines items={unrecognized} />
                </Space>
              ),
            },
          ]}
        />
      ) : null}
    </Space>
  );
}
