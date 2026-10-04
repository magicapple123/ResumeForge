/**
 * 采集条件的表单区块：关键词/城市/岗位类型/站点筛选/我的条件/间隔与抖动/保存站点原文。
 *
 * 受控组件：form 实例由 CollectPanel 持有（保存/开始都要 validateFields），这里只负责
 * 渲染 Form.Item；`Form.Item` 经 Form context 注册到同一个 form，零独立状态。
 */
import { PlayCircleOutlined, SaveOutlined } from "@ant-design/icons";
import {
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import type { FormInstance } from "antd";
import type { CollectConfig } from "../../../types";
import CollectSiteFilters from "../CollectSiteFilters";

/** 采集结果的岗位类型（C7）。
 *
 * 实习/社招：BOSS 有官方「求职类型」参数（真实实测 jobType=1902/1901，站点侧严格过滤），
 * 另外采集后按接口返回的岗位类型编码做第二道本地筛选；校招：BOSS 无官方参数（校招是
 * 独立专区），只走采集后本地筛选（接口编码 5，实测校准）。BOSS 以外的站点将来接入时，
 * 由适配器声明各自的能力。
 */
const JOB_TYPE_OPTIONS = [
  { value: "校招", label: "校招" },
  { value: "实习", label: "实习" },
  { value: "社招", label: "社招" },
];

/** 岗位类型的筛选方式随所选值变化：能映射到站点参数的标「站点筛选」，否则标「采集后筛选」。 */
const JOB_TYPE_TAG: Record<string, { color: string; text: string }> = {
  实习: { color: "green", text: "站点筛选" },
  社招: { color: "green", text: "站点筛选" },
  校招: { color: "blue", text: "采集后筛选" },
};

const JOB_TYPE_EXTRA =
  "实习/社招由招聘网站在搜索时就筛掉（更准更快）；校招由网站无此筛选，采回后按岗位的类型标记筛。岗位没给类型标记时会保留并如实计数";

interface Props {
  form: FormInstance<CollectConfig>;
  /** 当前选中的岗位类型（Form.useWatch 随面板状态变化）。 */
  jobTypeValue: string | undefined;
  saveSamples: boolean;
  onSaveSamplesChange: (checked: boolean) => void;
  disabled: boolean;
  saving: boolean;
  starting: boolean;
  onSave: () => void;
  onStart: () => void;
}

export default function CollectConfigForm({
  form,
  jobTypeValue,
  saveSamples,
  onSaveSamplesChange,
  disabled,
  saving,
  starting,
  onSave,
  onStart,
}: Props) {
  return (
    <Form form={form} layout="vertical">
      <Form.Item name="keywords" label="关键词" extra="最多 10 个；与城市至少要填一个。">
        <Select mode="tags" placeholder="例如：市场营销、财务会计" open={false} />
      </Form.Item>
      <Space size={16} wrap>
        <Form.Item name="city" label="城市">
          <Input placeholder="例如：北京" style={{ width: 180 }} />
        </Form.Item>
        <Form.Item name="per_task_limit" label="单批上限">
          <InputNumber min={1} max={200} style={{ width: 140 }} />
        </Form.Item>
        <Form.Item
          name="job_type"
          label={
            <Space size={4}>
              岗位类型
              <Tag color={JOB_TYPE_TAG[jobTypeValue ?? ""]?.color ?? "default"}>
                {JOB_TYPE_TAG[jobTypeValue ?? ""]?.text ?? "选择后生效"}
              </Tag>
            </Space>
          }
          extra={JOB_TYPE_EXTRA}
        >
          <Select
            allowClear
            placeholder="不限"
            style={{ width: 160 }}
            options={JOB_TYPE_OPTIONS}
          />
        </Form.Item>
      </Space>

      {/* 站点侧筛选：招聘网站自己的筛选栏。放在"我的条件"之前——它是粗筛，先筛掉大部分
          不符合的岗位，后面的本地筛选才只对少量结果做判断。 */}
      <CollectSiteFilters disabled={disabled} />

      {/* 「我的条件」：与上面的站点筛选语义不同——这里填的是**你自己**的情况，
          用来筛掉你投不了的岗位（岗位要求高于你）。两条一起用时先站点筛、再本地筛。 */}
      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
        按你的条件筛（采集后）——填你自己的情况，要求高于它的岗位会被筛掉
      </Typography.Text>
      <Space size={16} wrap>
        <Form.Item
          name="salary_min"
          label={
            <Space size={4}>
              我的期望薪资（K）
              <Tag color="blue">采集后筛选</Tag>
            </Space>
          }
          extra="按岗位薪资上限判断；岗位没给可判断的薪资时会保留，并标记为未能判断"
        >
          <InputNumber min={0} max={1000} style={{ width: 140 }} />
        </Form.Item>
        <Form.Item
          name="experience"
          label={
            <Space size={4}>
              我的经验
              <Tag color="blue">采集后筛选</Tag>
            </Space>
          }
          extra="与它没有重叠的岗位会被筛掉"
        >
          <Input placeholder="例如：3-5 年" style={{ width: 180 }} />
        </Form.Item>
        <Form.Item
          name="education"
          label={
            <Space size={4}>
              我的学历
              <Tag color="blue">采集后筛选</Tag>
            </Space>
          }
          extra="要求高于它的岗位会被筛掉"
        >
          <Input placeholder="例如：本科" style={{ width: 180 }} />
        </Form.Item>
      </Space>

      <Space size={16} wrap>
        <Form.Item name="interval_seconds" label="岗位间隔（秒）">
          <InputNumber min={1} max={600} style={{ width: 140 }} />
        </Form.Item>
        <Form.Item name="interval_jitter_seconds" label="随机抖动（秒）">
          <InputNumber min={0} max={300} style={{ width: 140 }} />
        </Form.Item>
      </Space>

      {/* 保存站点原文：这是排查解析问题 / 做真实样例回归的通道，属于支持路径而非日常流程，
          所以放在「开始采集」旁边、默认不勾，并把"存什么、存哪、会不会外传"一次说清——
          用户不知道它会往磁盘写东西就会用错。 */}
      <Form.Item style={{ marginBottom: 12 }}>
        <Checkbox
          checked={saveSamples}
          onChange={(event) => onSaveSamplesChange(event.target.checked)}
          aria-label="保存本次抓到的站点原文（用于排查解析问题）"
        >
          保存本次抓到的站点原文（用于排查解析问题）
        </Checkbox>
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>
          会保存搜索与详情两个接口的响应原文；只存到本机
          backend/data/captures/，不进仓库、不进备份。
        </Typography.Text>
      </Form.Item>

      <Space>
        <Button icon={<SaveOutlined />} loading={saving} onClick={onSave}>
          保存条件
        </Button>
        <Button
          type="primary"
          icon={<PlayCircleOutlined />}
          loading={starting}
          disabled={disabled}
          onClick={onStart}
        >
          开始采集
        </Button>
      </Space>
    </Form>
  );
}
