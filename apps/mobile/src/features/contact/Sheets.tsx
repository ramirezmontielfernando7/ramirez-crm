import React, { useRef, useState } from "react";
import { View } from "react-native";
import { CalendarDays, Flag, UserCheck } from "lucide-react-native";
import {
  Avatar,
  Banner,
  Button,
  Field,
  NavRow,
  Switch,
  TagCapsule,
  Text,
} from "../../components/ui";
import { useLayers } from "../../components/Layers";
import { useTheme } from "../../theme/ThemeProvider";
import { useAction } from "../chat/Sheets";
import { stages, tags } from "../inbox/model";
import {
  actionKey,
  type ContactStore,
  type ViewState,
  systemImportTag,
} from "./core";
import { useContactFlags, useContactState } from "./context";
import {
  canAssign,
  canChangeMode,
  formatAmount,
  lossReasons,
  modeLabels,
  parseAmount,
  parseDue,
  personName,
  priorities,
  team,
  type Mode,
} from "./model";
import { Dot, Option, SelectField, stageColor } from "./Controls";
const ErrorBanner = ({ error }: { error: string }) =>
  error ? <Banner type="danger">{error}</Banner> : null;
export function StageSheet({ store }: { store: ContactStore }) {
  const s = useContactState(store),
    action = useAction(),
    { close, open } = useLayers();
  return (
    <>
      <ErrorBanner error={action.error} />
      {stages.map((stage) => (
        <Option
          key={stage}
          label={stage}
          checked={s.data.stage === stage}
          disabled={action.busy}
          leading={<Dot color={stageColor(stage)} />}
          onPress={() =>
            stage === "Perdido"
              ? open({
                  kind: "dialog",
                  title: "¿Por qué se perdió?",
                  content: <LossSheet store={store} />,
                })
              : void action.run(async () => {
                  await store.stage(stage);
                  close();
                })
          }
        />
      ))}
    </>
  );
}
export function LossSheet({ store }: { store: ContactStore }) {
  const s = useContactState(store),
    [reason, setReason] = useState(s.data.lossReason || "Precio"),
    [detail, setDetail] = useState(s.data.lossDetail),
    action = useAction(),
    { close } = useLayers();
  const key = useRef(actionKey());
  return (
    <>
      <ErrorBanner error={action.error} />
      {lossReasons.map((v) => (
        <Option
          key={v}
          label={v}
          checked={reason === v}
          disabled={action.busy}
          onPress={() => setReason(v)}
        />
      ))}
      <Field
        label="Detalle (opcional)"
        multiline
        maxLength={2000}
        value={detail}
        onChangeText={setDetail}
        placeholder="Se fue con una agencia local por la mitad del precio"
      />
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" disabled={action.busy} onPress={close}>
            Cancelar
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button
            variant="danger"
            loading={action.busy}
            onPress={() =>
              void action.run(async () => {
                await store.stage("Perdido", reason, detail, key.current);
                close();
              })
            }
          >
            Marcar perdido
          </Button>
        </View>
      </View>
    </>
  );
}
export function AssignSheet({ store }: { store: ContactStore }) {
  const s = useContactState(store),
    action = useAction(),
    { close } = useLayers();
  if (!canAssign(store.actor))
    return (
      <Banner type="warning">Tu perfil no puede asignar conversaciones.</Banner>
    );
  return (
    <>
      <ErrorBanner error={action.error} />
      {[...team, { id: null, name: "Sin asignar", role: "" }].map((p) => (
        <Option
          key={p.id ?? "none"}
          label={p.name}
          sub={p.role}
          leading={
            <View
              style={{ transform: [{ scale: 0.7 }], width: 40, height: 40 }}
            >
              <Avatar name={p.name} />
            </View>
          }
          checked={s.data.assigned === p.id}
          disabled={action.busy}
          onPress={() =>
            void action.run(async () => {
              await store.assign(p.id);
              close();
            })
          }
        />
      ))}
    </>
  );
}
export function TagsSheet({ store }: { store: ContactStore }) {
  const s = useContactState(store),
    action = useAction(),
    { close } = useLayers();
  return (
    <>
      <ErrorBanner error={action.error} />
      {tags.map((v) => (
        <Option
          key={v}
          kind="checkbox"
          label={v}
          leading={<TagCapsule>{v}</TagCapsule>}
          hideLabel
          checked={s.data.tags.includes(v)}
          disabled={action.busy}
          onPress={() =>
            void action.run(() =>
              store.tags(
                s.data.tags.includes(v)
                  ? s.data.tags.filter((t) => t !== v)
                  : [...s.data.tags, v],
              ),
            )
          }
        />
      ))}
      {s.data.tags.includes(systemImportTag) && (
        <>
          <Option
            kind="checkbox"
            label={systemImportTag}
            sub="Etiqueta de sistema · No se puede quitar"
            checked
            disabled
            onPress={() => {}}
          />
          <Text kind="meta">Las etiquetas de importación se conservan.</Text>
        </>
      )}
      <Button disabled={action.busy} onPress={close}>
        Listo
      </Button>
    </>
  );
}
export function AiSheet({ store }: { store: ContactStore }) {
  const s = useContactState(store),
    flags = useContactFlags(),
    action = useAction(),
    { close } = useLayers();
  return (
    <>
      <ErrorBanner error={action.error} />
      {(
        [
          ["on", "La IA atiende", "Responde sola según su agente."],
          [
            "pause",
            "En pausa",
            "La IA deja de contestar; una persona atiende.",
          ],
          ["off", "Apagada", "Este chat nunca lo contesta la IA."],
        ] as const
      ).map(([v, label, sub]) => (
        <Option
          key={v}
          label={label}
          sub={sub}
          checked={s.data.ai === v}
          disabled={action.busy}
          onPress={() => void action.run(() => store.ai(v))}
        />
      ))}
      {s.data.ai === "pause" && (
        <Button
          loading={action.busy}
          onPress={() =>
            void action.run(async () => {
              await store.take();
              close();
            })
          }
        >
          Tomar este chat
        </Button>
      )}
      {flags.agent && flags.brain && s.data.ai === "on" && (
        <Banner type="warning">
          Doble respuesta: hay un agente y un cerebro externo conectados; los
          dos podrían contestar.
        </Banner>
      )}
      <Button variant="secondary" disabled={action.busy} onPress={close}>
        Listo
      </Button>
    </>
  );
}
function DeviceInfo({ store }: { store: ContactStore }) {
  const flags = useContactFlags(),
    { close, toast } = useLayers(),
    action = useAction();
  return (
    <>
      <Text>
        Dispositivo de demostración ·{" "}
        {flags.linked ? "Vinculado" : "Sin vincular"}
      </Text>
      <Text>Ningún teléfono ni cuenta real se conecta desde esta demo.</Text>
      {flags.emergency && (
        <Banner type="warning">La pausa de emergencia está activa.</Banner>
      )}
      {store.actor.role === "owner" ? (
        <Button
          onPress={() =>
            void action.run(() => {
              store.directory.setFlags({ linked: !flags.linked });
              toast(
                flags.linked
                  ? "Muestra desvinculada"
                  : "Dispositivo ficticio vinculado",
              );
            })
          }
        >
          {flags.linked ? "Desvincular muestra" : "Vincular muestra"}
        </Button>
      ) : (
        <Text kind="secondary">
          Pide al propietario que vincule el dispositivo de prueba.
        </Text>
      )}
      <ErrorBanner error={action.error} />
      <Button variant="secondary" onPress={close}>
        Entendido
      </Button>
    </>
  );
}
export function ConnectionSheet({ store }: { store: ContactStore }) {
  const s = useContactState(store),
    flags = useContactFlags(),
    action = useAction(),
    { open, close } = useLayers(),
    { colors: c } = useTheme();
  if (!canChangeMode(store.actor, store.authorize(), flags))
    return (
      <Banner type="warning">
        Conexión del chat no está disponible para tu perfil o complemento.
      </Banner>
    );
  return (
    <>
      <Text style={{ color: c.text3 }}>{store.authorize().name}</Text>
      <ErrorBanner error={action.error} />
      {(["meta", "direct", "hybrid"] as Mode[]).map((mode, i) => (
        <Option
          key={mode}
          label={modeLabels[mode]}
          sub={
            [
              "Recibe y responde por Meta.",
              "Recibe y responde por el dispositivo vinculado.",
              "Recibe por Meta y responde por el dispositivo vinculado.",
            ][i]
          }
          leading={<Dot color={[c.success, c.info, "#8b5cf6"][i]!} />}
          checked={s.data.mode === mode}
          disabled={action.busy}
          onPress={() => void action.run(() => store.mode(mode))}
        />
      ))}
      <Banner type="info">
        Para usar Directa o Híbrida hace falta un dispositivo vinculado. Se
        vincula en Ajustes → Conexión directa.
      </Banner>
      {flags.emergency && (
        <Banner type="warning">
          Pausa de emergencia activa. Puedes volver a Meta.
        </Banner>
      )}
      <Button
        variant="secondary"
        onPress={() =>
          open({
            kind: "sheet",
            title: "Conexión directa · demo",
            content: <DeviceInfo store={store} />,
          })
        }
      >
        Ir a Conexión directa
      </Button>
      <Button disabled={action.busy} onPress={close}>
        Listo
      </Button>
    </>
  );
}
export function SaleSheet({
  store,
  kind,
}: {
  store: ContactStore;
  kind: "amount" | "priority";
}) {
  const s = useContactState(store),
    [amount, setAmount] = useState(
      s.data.amountCents === null ? "" : String(s.data.amountCents / 100),
    ),
    action = useAction(),
    { close } = useLayers();
  return (
    <>
      <ErrorBanner error={action.error} />
      {kind === "amount" ? (
        <>
          <Field
            label="Monto de la venta"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            maxLength={15}
            hint="Monto ficticio en MXN. Vacío deja la venta sin monto."
          />
          <Button
            loading={action.busy}
            onPress={() =>
              void action.run(async () => {
                await store.sale(parseAmount(amount), s.data.priority);
                close();
              })
            }
          >
            Guardar monto
          </Button>
        </>
      ) : (
        priorities.map((v) => (
          <Option
            key={v}
            label={v}
            checked={s.data.priority === v}
            disabled={action.busy}
            onPress={() =>
              void action.run(async () => {
                await store.sale(s.data.amountCents, v);
                close();
              })
            }
          />
        ))
      )}
      <Button variant="secondary" onPress={close}>
        Cancelar
      </Button>
    </>
  );
}
export function TaskSheet({ store }: { store: ContactStore }) {
  const now = new Date();
  now.setHours(17, 0, 0, 0);
  if (now.getTime() < Date.now()) now.setDate(now.getDate() + 1);
  const [title, setTitle] = useState(""),
    [date, setDate] = useState(
      `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`,
    ),
    [time, setTime] = useState("17:00"),
    [assignee, setAssignee] = useState(store.actor.id),
    [dateOpen, setDateOpen] = useState(false),
    [personOpen, setPersonOpen] = useState(false),
    action = useAction(),
    { close } = useLayers(),
    key = useRef(actionKey());
  return (
    <>
      <ErrorBanner error={action.error} />
      <Field
        label="¿Qué hay que hacer?"
        placeholder="Mandar la cotización"
        value={title}
        onChangeText={setTitle}
        maxLength={300}
      />
      <SelectField
        label="Fecha límite"
        value={`${date} · ${time}`}
        onPress={() => setDateOpen(!dateOpen)}
      />
      {dateOpen && (
        <>
          <Field
            label="Fecha · DD/MM/AAAA"
            value={date}
            onChangeText={setDate}
            maxLength={10}
            keyboardType="numbers-and-punctuation"
          />
          <Field
            label="Hora · HH:mm"
            value={time}
            onChangeText={setTime}
            maxLength={5}
            keyboardType="numbers-and-punctuation"
          />
        </>
      )}
      <SelectField
        label="Responsable"
        value={personName(assignee)}
        onPress={
          canAssign(store.actor) ? () => setPersonOpen(!personOpen) : undefined
        }
      />
      {personOpen &&
        team.map((p) => (
          <Option
            key={p.id}
            label={p.name}
            checked={assignee === p.id}
            onPress={() => {
              setAssignee(p.id);
              setPersonOpen(false);
            }}
          />
        ))}
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" disabled={action.busy} onPress={close}>
            Cancelar
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button
            loading={action.busy}
            onPress={() =>
              void action.run(async () => {
                await store.task(
                  title,
                  parseDue(date, time),
                  assignee,
                  key.current,
                );
                close();
              })
            }
          >
            Crear tarea
          </Button>
        </View>
      </View>
    </>
  );
}
export function DemoSheet({ store }: { store: ContactStore }) {
  const flags = useContactFlags(),
    action = useAction(),
    { close } = useLayers();
  const views: { label: string; view: ViewState }[] = [
    { label: "Mostrar detalles normales", view: "normal" },
    { label: "Mostrar cargando", view: "loading" },
    { label: "Mostrar vacío", view: "empty" },
    { label: "Mostrar error", view: "error" },
    { label: "Mostrar sin conexión", view: "offline" },
  ];
  return (
    <>
      <Text>
        Controles de prueba locales. No cambian permisos ni conexiones reales.
      </Text>
      <ErrorBanner error={action.error} />
      {(
        [
          ["addon", "Complemento Conexión directa"],
          ["modeGrant", "Permiso delegado para cambiar conexión"],
          ["linked", "Dispositivo ficticio vinculado"],
          ["emergency", "Pausa de emergencia"],
          ["agent", "Agente conectado"],
          ["brain", "Cerebro externo conectado"],
        ] as const
      ).map(([key, label]) => (
        <Switch
          key={key}
          label={label}
          value={flags[key]}
          onChange={(v) =>
            void action.run(() => store.directory.setFlags({ [key]: v }))
          }
        />
      ))}
      <NavRow
        label="Fallar el próximo cambio"
        onPress={() => {
          store.failNext = true;
          close();
        }}
      />
      {views.map((v) => (
        <NavRow
          key={v.view}
          label={v.label}
          onPress={() => {
            store.view(v.view);
            close();
          }}
        />
      ))}
    </>
  );
}
