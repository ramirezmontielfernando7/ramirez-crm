"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { OVERSIGHT_NOTICE, TEAM_GROUP_NAME_MAX, type TeamChatSettingsDto, type TeamPersonDto } from "@/lib/team-chat";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useViewer } from "@/components/viewer-context";

type Group = { id: string; name: string; members: TeamPersonDto[] };

/**
 * 025 — Ajustes → Chat de equipo. La supervisión y la delegación son del
 * Propietario (`team_chat.oversee`); los grupos, de quien puede crearlos
 * (el Propietario, o el Coordinador si se le delegó). La API lo valida igual.
 */
export function TeamChatSettingsClient() {
  const viewer = useViewer();
  const owner = viewer.can("team_chat.oversee");
  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground">
        El chat de equipo es para hablar entre ustedes: directos, grupos y el canal de Avisos, que llega
        a todos. Los clientes no lo ven y nada de aquí sale por WhatsApp.
      </p>
      {owner && <OversightCard />}
      <GroupsCard />
    </div>
  );
}

function OversightCard() {
  const [settings, setSettings] = useState<TeamChatSettingsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<keyof TeamChatSettingsDto | null>(null);

  useEffect(() => {
    void fetchJson<{ settings: TeamChatSettingsDto }>("/api/team-chat/settings").then((res) => {
      if (res.ok) setSettings(res.data.settings);
      else setError(`No se pudieron cargar los ajustes: ${res.error}`);
    });
  }, []);

  async function save(key: keyof TeamChatSettingsDto, value: boolean) {
    if (!settings) return;
    setSaving(key);
    setError(null);
    const res = await fetchJson<{ settings: TeamChatSettingsDto }>(
      "/api/team-chat/settings",
      jsonInit("PUT", { [key]: value })
    );
    setSaving(null);
    if (!res.ok) {
      setError(`No se guardó: ${res.error}`);
      return;
    }
    setSettings(res.data.settings);
  }

  // Función de pintado (no componente): así el interruptor no se vuelve a
  // montar en cada render y conserva el foco del teclado al cambiarlo.
  const row = ({
    k,
    title,
    description,
    disabled = false,
  }: {
    k: keyof TeamChatSettingsDto;
    title: string;
    description: React.ReactNode;
    disabled?: boolean;
  }) => (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</p>
      </div>
      <Switch
        label={title}
        checked={!!settings?.[k]}
        disabled={!settings || saving !== null || disabled}
        onCheckedChange={(v) => void save(k, v)}
      />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Supervisión y permisos</CardTitle>
        <CardDescription>Solo el Propietario ve y cambia estos ajustes.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {error && (
          <p role="alert" className="pb-3 text-sm text-danger-text">
            {error}
          </p>
        )}
        {row({
          k: "ownerOversight",
          title: "Supervisar las conversaciones del equipo",
          description:
            "Ves también los directos y grupos donde no participas, en solo lectura (no escribes, no reaccionas y no cuentan en tus no leídos). Encendido, lo verás marcado en el chat.",
        })}
        {row({
          k: "showOversightNotice",
          title: "Avisar al equipo que hay supervisión",
          disabled: !settings?.ownerOversight,
          description: `Todos verán fijo en el chat: «${OVERSIGHT_NOTICE}». Solo se muestra con la supervisión encendida.`,
        })}
        {row({
          k: "coordinatorsCanCreateGroups",
          title: "Los Coordinadores pueden crear grupos",
          description:
            "Les da acceso a esta pestaña para crear, editar y borrar grupos. La supervisión sigue siendo solo tuya.",
        })}
      </CardContent>
    </Card>
  );
}

function GroupsCard() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [people, setPeople] = useState<TeamPersonDto[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; members: Set<string> } | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const viewer = useViewer();

  const refetch = useCallback(async () => {
    const [g, p] = await Promise.all([
      fetchJson<{ groups: Group[] }>("/api/team-chat/groups"),
      fetchJson<{ people: TeamPersonDto[] }>("/api/team-chat/people"),
    ]);
    if (!g.ok || !p.ok) {
      setLoadError(`No se pudieron cargar los grupos: ${!g.ok ? g.error : !p.ok ? p.error : ""}`);
      return;
    }
    setLoadError(null);
    setGroups(g.data.groups);
    setPeople(p.data.people);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function create() {
    setCreating(true);
    setCreateError(null);
    const res = await fetchJson("/api/team-chat/groups", jsonInit("POST", { name, memberIds: [...picked] }));
    setCreating(false);
    if (!res.ok) {
      setCreateError(`No se creó: ${res.error}`);
      return;
    }
    setName("");
    setPicked(new Set());
    void refetch();
  }

  async function saveEdit() {
    if (!editing) return;
    const res = await fetchJson(
      `/api/team-chat/groups/${editing.id}`,
      jsonInit("PATCH", { name: editing.name, memberIds: [...editing.members] })
    );
    if (!res.ok) {
      setRowError({ id: editing.id, message: `No se guardó: ${res.error}` });
      return;
    }
    setEditing(null);
    setRowError(null);
    void refetch();
  }

  async function remove(group: Group) {
    if (!window.confirm(`¿Borrar el grupo «${group.name}» con todos sus mensajes y archivos?`)) return;
    const res = await fetchJson(`/api/team-chat/groups/${group.id}`, { method: "DELETE" });
    if (!res.ok) {
      setRowError({ id: group.id, message: `No se borró: ${res.error}` });
      return;
    }
    setRowError(null);
    void refetch();
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Nuevo grupo</CardTitle>
          <CardDescription>Por equipo, sucursal o proyecto. Tú quedas dentro.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="group-name">Nombre</Label>
            <Input
              id="group-name"
              value={name}
              maxLength={TEAM_GROUP_NAME_MAX}
              placeholder="Ventas Norte"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Participantes</Label>
            <PeoplePicker
              people={people.filter((p) => p.id !== viewer.userId)}
              selected={picked}
              onToggle={(id) =>
                setPicked((s) => {
                  const n = new Set(s);
                  if (n.has(id)) n.delete(id);
                  else n.add(id);
                  return n;
                })
              }
            />
          </div>
          {createError && (
            <p role="alert" className="text-sm text-danger-text">
              {createError}
            </p>
          )}
          <Button disabled={!name.trim() || creating} onClick={() => void create()}>
            {creating ? "Creando…" : "Crear grupo"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Grupos</CardTitle>
          <CardDescription>Borrar un grupo borra sus mensajes y archivos.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p role="alert" className="text-sm text-danger-text">
              {loadError}
            </p>
          ) : groups === null ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay grupos.</p>
          ) : (
            <ul className="divide-y">
              {groups.map((g) => (
                <li key={g.id} className="py-3">
                  {editing?.id === g.id ? (
                    <div className="space-y-2">
                      <Input
                        value={editing.name}
                        maxLength={TEAM_GROUP_NAME_MAX}
                        aria-label="Nombre del grupo"
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      />
                      <PeoplePicker
                        people={people}
                        selected={editing.members}
                        onToggle={(id) => {
                          const n = new Set(editing.members);
                          if (n.has(id)) n.delete(id);
                          else n.add(id);
                          setEditing({ ...editing, members: n });
                        }}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => void saveEdit()}>
                          Guardar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{g.name}</p>
                        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                          {g.members.map((m) => m.name).join(", ") || "Sin participantes"}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          aria-label={`Editar ${g.name}`}
                          onClick={() => setEditing({ id: g.id, name: g.name, members: new Set(g.members.map((m) => m.id)) })}
                          className="rounded p-1.5 text-text-3 hover:bg-secondary hover:text-foreground"
                        >
                          <Pencil className="h-4 w-4" strokeWidth={1.7} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Borrar ${g.name}`}
                          onClick={() => void remove(g)}
                          className="rounded p-1.5 text-text-3 hover:bg-danger-tint hover:text-danger-text"
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                        </button>
                      </div>
                    </div>
                  )}
                  {rowError?.id === g.id && (
                    <p role="alert" className="mt-1.5 text-sm text-danger-text">
                      {rowError.message}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function PeoplePicker({
  people,
  selected,
  onToggle,
}: {
  people: TeamPersonDto[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (people.length === 0) {
    return <p className="text-[12.5px] text-muted-foreground">Todavía no hay nadie más en el equipo.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {people.map((p) => {
        const on = selected.has(p.id);
        return (
          <button
            key={p.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => onToggle(p.id)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[12.5px] font-medium transition-colors",
              on ? "border-brand bg-brand-tint text-brand-text" : "border-border-strong text-text-2 hover:border-text-3"
            )}
          >
            {p.name} <span className="text-text-3">· {p.role}</span>
          </button>
        );
      })}
    </div>
  );
}
