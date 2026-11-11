// SPDX-License-Identifier: Apache-2.0
/** 视角切换的取数与保存（18C）；切换后回调刷新技能芯片，保持界面与系统提示一致。 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PERSONA_IDS,
  readConversationPersona,
  saveConversationPersona,
  type PersonaSelection,
} from "./personaApi";

export interface AssistantPersonaController {
  personaId: PersonaSelection;
  loading: boolean;
  saving: boolean;
  failed: boolean;
  setPersona: (next: PersonaSelection) => Promise<void>;
}

function isPersonaSelection(value: unknown): value is PersonaSelection {
  return value === "" || (PERSONA_IDS as readonly unknown[]).includes(value);
}

export function useAssistantPersona(
  conversationId: number | null,
  onChanged?: () => void,
): AssistantPersonaController {
  const [personaId, setPersonaId] = useState<PersonaSelection>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    seqRef.current += 1;
    setFailed(false);
    if (conversationId === null) {
      setPersonaId("");
      setLoading(false);
      return;
    }
    const seq = seqRef.current;
    setLoading(true);
    void readConversationPersona(conversationId)
      .then((payload) => {
        if (seq !== seqRef.current) return;
        setPersonaId(isPersonaSelection(payload.persona_id) ? payload.persona_id : "");
      })
      .catch(() => {
        if (seq === seqRef.current) setFailed(true);
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false);
      });
  }, [conversationId]);

  const setPersona = useCallback(
    async (next: PersonaSelection) => {
      if (conversationId === null) return;
      const seq = ++seqRef.current;
      setSaving(true);
      setFailed(false);
      try {
        const payload = await saveConversationPersona(conversationId, next);
        if (seq !== seqRef.current) return;
        setPersonaId(isPersonaSelection(payload.persona_id) ? payload.persona_id : next);
        // 视角是"内置技能"，切换后技能芯片要跟着刷新，否则输入区显示的还是旧的。
        onChanged?.();
      } catch {
        if (seq === seqRef.current) setFailed(true);
      } finally {
        if (seq === seqRef.current) setSaving(false);
      }
    },
    [conversationId, onChanged],
  );

  return { personaId, loading, saving, failed, setPersona };
}
