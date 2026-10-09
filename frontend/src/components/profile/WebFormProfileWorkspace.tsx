/**
 * 「网申资料」草稿的持有者：自己拿草稿，页面只在提交那一刻来取。
 *
 * ## 为什么草稿在这里，而不是在 ProfilePage 里
 *
 * 「保存全部资料」要一次提交两份数据（简历资料 + 网申资料），所以草稿原先由 ProfilePage 持有。
 * 代价是**每敲一个字符都重渲整页**：页面 state 一变，包住两个 tab 的 antd `Form` 跟着重渲，它的
 * context 随之换新引用，于是「简历资料」那 67 个 `Form.Item`（含 12 个日期三连选）全部重渲。
 * 实测一次击键的「输入 → 两帧」延迟：开发构建 76～178ms、生产构建 35～48ms，打字明显卡顿。
 *
 * 现在草稿由本组件自持：击键只重渲这一棵子树（Section + 被改的那一组、那一个字段），页面完全
 * 不参与。页面通过 `ref` 在提交那一刻取草稿，保存成功或取消编辑时把快照推回来——交互与数据流
 * 和原先完全一致。
 *
 * ## 为什么「取消编辑的基线」也由本组件抓
 *
 * antd `Tabs` 的未激活面板是**懒挂载**的：没点开过「网申资料」时这个面板根本不在 DOM 里。所以
 * 「先在简历资料 tab 点『编辑资料』、之后才切到网申资料改、再取消」这条路径上，页面在进入编辑时
 * 拿到的草稿是空的——把回滚交给页面会静默失效。
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { WebFormExtraEntry, WebFormExtraProfile, WebFormRepeatedGroup } from "../../types";
import WebFormProfileSection from "./WebFormProfileSection";

/** 尚未保存的那一份网申资料。 */
export interface WebFormProfileDraft {
  values: Record<string, string>;
  details: Record<string, WebFormExtraEntry>;
  repeatedGroups: WebFormRepeatedGroup[];
}

export interface WebFormProfileWorkspaceHandle {
  /** 当前草稿；`null` 表示目录还没加载完（用户还没打开过「网申资料」）。 */
  getDraft: () => WebFormProfileDraft | null;
  /** 保存成功后把服务端返回的那一份接成当前草稿。 */
  adoptSaved: (profile: WebFormExtraProfile) => void;
  /** 取消编辑：回到进入编辑时的基线。 */
  cancel: () => void;
}

interface Props {
  editing: boolean;
  saving: boolean;
  /** 草稿有改动（置脏）。页面据此挂未保存防护与悬浮球保存桥。 */
  onDirty: () => void;
  /** 目录（字段清单）交给页面：提交时按它收窄字段，不把界面上的临时键发出去。 */
  onCatalogLoaded: (profile: WebFormExtraProfile) => void;
  onCatalogFieldLabelChange: (key: string, label: string) => void;
  onCatalogFieldDelete: (key: string) => void;
}

/** 服务端返回的整份资料 → 草稿形状。 */
function draftFromProfile(profile: WebFormExtraProfile): WebFormProfileDraft {
  return {
    values: profile.values,
    details: profile.details ?? {},
    repeatedGroups: profile.repeated_groups ?? [],
  };
}

/** 深拷贝：草稿与基线各留一份，之后各自的改动互不影响。 */
function cloneDraft(draft: WebFormProfileDraft): WebFormProfileDraft {
  return {
    values: { ...draft.values },
    details: { ...draft.details },
    repeatedGroups: draft.repeatedGroups.map((group) => ({
      ...group,
      fields: [...group.fields],
      records: group.records.map((record) => ({ ...record, values: { ...record.values } })),
    })),
  };
}

const WebFormProfileWorkspace = forwardRef<WebFormProfileWorkspaceHandle, Props>(
  function WebFormProfileWorkspace(
    { editing, saving, onDirty, onCatalogLoaded, onCatalogFieldLabelChange, onCatalogFieldDelete },
    ref,
  ) {
    const [values, setValues] = useState<Record<string, string>>({});
    const [details, setDetails] = useState<Record<string, WebFormExtraEntry>>({});
    const [repeatedGroups, setRepeatedGroups] = useState<WebFormRepeatedGroup[]>([]);
    const [loaded, setLoaded] = useState(false);

    // 编辑态里草稿每击键都在变，而基线快照发生在渲染提交之后——用 ref 读最新值。
    // 与页面里的 submitAllRef 同一写法：ref 只在 effect 里写（渲染期写 ref 会被
    // react-hooks 的 Compiler 规则拦下）。
    const draftRef = useRef<WebFormProfileDraft>({ values, details, repeatedGroups });
    useEffect(() => {
      draftRef.current = { values, details, repeatedGroups };
    });

    // `WebFormProfileSection` 的 onLoaded 会调用两次：首次取到目录，以及用户新增自定义字段。
    // 只有**首次**那一份是权威的服务端数据；后一次带的 repeated_groups 是 GET 时的旧值，照它
    // 覆盖会把用户尚未保存的多条记录改回原样（那段代码自己的注释也说要保留未保存的值）。
    const initializedRef = useRef(false);

    /** 取消编辑要回到的那一份。离开编辑态即作废。 */
    const baselineRef = useRef<WebFormProfileDraft | null>(null);
    useEffect(() => {
      if (!editing) {
        baselineRef.current = null;
        return;
      }
      // 「编辑中且目录已加载」的第一次提交时抓取。懒挂载下这是唯一可靠的时机：
      // 用户可能先点「编辑资料」、之后才切到「网申资料」，此时页面侧根本没有草稿。
      if (loaded && !baselineRef.current) baselineRef.current = cloneDraft(draftRef.current);
    }, [editing, loaded]);

    const handleLoaded = useCallback(
      (profile: WebFormExtraProfile) => {
        if (!initializedRef.current) {
          initializedRef.current = true;
          const draft = draftFromProfile(profile);
          setValues(draft.values);
          setDetails(draft.details);
          setRepeatedGroups(draft.repeatedGroups);
        }
        setLoaded(true);
        onCatalogLoaded(profile);
      },
      [onCatalogLoaded],
    );

    const handleChange = useCallback(
      (key: string, value: string) => {
        setValues((current) => ({ ...current, [key]: value }));
        onDirty();
      },
      [onDirty],
    );

    /** 改名只改显示标签，key 保持不变，已记住的值不会失去关联。 */
    const handleFieldLabelChange = useCallback(
      (key: string, label: string) => {
        setDetails((current) => ({
          ...current,
          [key]: {
            value: current[key]?.value ?? "",
            source: current[key]?.source ?? "manual",
            reuse: current[key]?.reuse ?? "general",
            label,
          },
        }));
        onCatalogFieldLabelChange(key, label);
        onDirty();
      },
      [onCatalogFieldLabelChange, onDirty],
    );

    /** 删除交给「保存全部资料」统一提交；草稿里同步移除，提交白名单不会把它带回去。 */
    const handleFieldDelete = useCallback(
      (key: string) => {
        setValues((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
        setDetails((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
        onCatalogFieldDelete(key);
        onDirty();
      },
      [onCatalogFieldDelete, onDirty],
    );

    const handleRepeatedGroupsChange = useCallback(
      (groups: WebFormRepeatedGroup[]) => {
        setRepeatedGroups(groups);
        onDirty();
      },
      [onDirty],
    );

    const applyDraft = useCallback((draft: WebFormProfileDraft) => {
      const next = cloneDraft(draft);
      setValues(next.values);
      setDetails(next.details);
      setRepeatedGroups(next.repeatedGroups);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        getDraft: () => (loaded ? draftRef.current : null),
        adoptSaved: (profile: WebFormExtraProfile) => {
          const draft = draftFromProfile(profile);
          applyDraft(draft);
          // 存成功之后，「取消编辑」要回到的是**刚存下的这一份**，而不是进入编辑时的那一份：
          // 否则「改 → 保存 → 再改 → 取消」会把界面退回保存之前的旧内容，与库里对不上。
          baselineRef.current = cloneDraft(draft);
        },
        cancel: () => {
          if (baselineRef.current) applyDraft(baselineRef.current);
        },
      }),
      [applyDraft, loaded],
    );

    return (
      <WebFormProfileSection
        editing={editing}
        saving={saving}
        values={values}
        details={details}
        onChange={handleChange}
        onFieldLabelChange={handleFieldLabelChange}
        onFieldDelete={handleFieldDelete}
        repeatedGroups={repeatedGroups}
        onRepeatedGroupsChange={handleRepeatedGroupsChange}
        onLoaded={handleLoaded}
      />
    );
  },
);

export default WebFormProfileWorkspace;
