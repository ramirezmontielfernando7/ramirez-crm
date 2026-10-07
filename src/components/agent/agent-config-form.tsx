"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * 031 (A2) — Los campos de comportamiento de un agente, extraídos del
 * formulario de /agent para que el editor del Laboratorio use EXACTAMENTE los
 * mismos. Controlado: quien lo usa guarda (a /api/agent/profile o al borrador).
 * El nombre es opcional en el Laboratorio (`nameLabel`, `namePlaceholder`,
 * `nameHelp`); `showName={false}` lo oculta cuando el editor ya lo pide aparte.
 */
export type AgentConfigFields = {
  name: string;
  tone: string | null;
  instructions: string | null;
  escalationRules: string | null;
  greeting: string | null;
};

export function AgentConfigForm({
  value,
  onChange,
  idPrefix = "agent",
  showName = true,
  nameLabel = "Nombre del agente",
  namePlaceholder,
  nameHelp,
}: {
  value: AgentConfigFields;
  onChange: (next: AgentConfigFields) => void;
  idPrefix?: string;
  showName?: boolean;
  nameLabel?: string;
  namePlaceholder?: string;
  nameHelp?: string;
}) {
  const set = (patch: Partial<AgentConfigFields>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      {showName && (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-name`}>{nameLabel}</Label>
          <Input
            id={`${idPrefix}-name`}
            placeholder={namePlaceholder}
            value={value.name}
            onChange={(e) => set({ name: e.target.value })}
          />
          {nameHelp && <p className="text-xs text-muted-foreground">{nameHelp}</p>}
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-tone`}>Tono</Label>
        <Input
          id={`${idPrefix}-tone`}
          placeholder="p. ej. cercano y directo, con usted"
          value={value.tone ?? ""}
          onChange={(e) => set({ tone: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-instructions`}>Instrucciones</Label>
        <Textarea
          id={`${idPrefix}-instructions`}
          rows={5}
          placeholder="Qué debe y no debe hacer el agente…"
          value={value.instructions ?? ""}
          onChange={(e) => set({ instructions: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-escalation`}>Reglas de escalado</Label>
        <Textarea
          id={`${idPrefix}-escalation`}
          rows={3}
          placeholder="Cuándo pasar la conversación a un humano…"
          value={value.escalationRules ?? ""}
          onChange={(e) => set({ escalationRules: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-greeting`}>Saludo</Label>
        <Input
          id={`${idPrefix}-greeting`}
          placeholder="Saludo para conversaciones nuevas"
          value={value.greeting ?? ""}
          onChange={(e) => set({ greeting: e.target.value })}
        />
      </div>
    </div>
  );
}
