import React, { useState, useSyncExternalStore } from "react";
import { View, ScrollView, Pressable } from "react-native";
import {
  Button,
  Field,
  FilterChips,
  Text,
  StageCapsule,
  NavRow,
} from "../../components/ui";
import { DetailRow, Option } from "../contact/Controls";
import {
  GitBranch,
  DollarSign,
  Flag,
  UserCheck,
  Plus,
  Filter,
  Download,
  Upload,
  Tag,
  Clock3,
  Archive,
  RefreshCw,
} from "lucide-react-native";
import { personName } from "../contact/model";
import { useLayers } from "../../components/Layers";
import { CrmModel, palette, type CrmId } from "./core";
import type { CrmNavigation } from "./CrmView";
export const layerTitles: Partial<Record<CrmId, string>> = {
  "CRM-02": "Detalle del trato",
  "CRM-03": "Mover a",
  "CRM-04": "Monto del trato",
  "CRM-05": "¿Por qué se perdió?",
  "CRM-06": "Nuevo lead",
  "CRM-07C": "Color",
  "CRM-07D": "Eliminar etapa",
  "CRM-08": "Buscar y filtrar",
  "CRM-09": "Pipeline",
  "CRM-12": "Nuevo contacto / editar",
  "CRM-13": "Contacto",
  "CRM-14": "Filtros",
  "CRM-15": "Con los seleccionados",
  "CRM-16": "Contactos",
};
export function CrmOverlay(props: CrmNavigation & { id: CrmId; arg?: string }) {
  const { model: m, id, onLayer, onChat, onHistory, arg } = props;
  useSyncExternalStore(m.subscribe, m.snapshot, m.snapshot);
  const { close, toast } = useLayers();
  const [error, setError] = useState(""),
    [value, setValue] = useState(""),
    [target, setTarget] = useState("Nuevo"),
    [amount, setAmount] = useState("");
  const contact = m.state.contactId ? m.get(m.state.contactId) : null;
  const act = (work: () => void, exit = true) => {
    try {
      work();
      setError("");
      if (exit) close();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const footer = (
    <>
      {error && <Text accessibilityRole="alert">{error}</Text>}
      <Button variant="secondary" onPress={close}>
        Cancelar
      </Button>
    </>
  );
  if (id === "CRM-12") return <ContactForm model={m} done={close} />;
  if (id === "CRM-08" || id === "CRM-14")
    return <Filters model={m} pipeline={id === "CRM-08"} done={close} />;
  if (id === "CRM-02" && contact)
    return (
      <View style={{ gap: 12 }}>
        <Text kind="title" weight="semibold">
          {contact.name}
        </Text>
        <StageCapsule>{contact.stage}</StageCapsule>
        <DetailRow
          label="Etapa"
          value={contact.stage}
          icon={GitBranch}
          onPress={() => onLayer("CRM-03")}
        />
        <DetailRow
          label="Monto"
          value={"$" + contact.amount.toLocaleString("es-MX")}
          icon={DollarSign}
          onPress={() => onLayer("CRM-04")}
        />
        <DetailRow
          label="Prioridad"
          value={contact.priority}
          icon={Flag}
          onPress={() => setValue("edit-priority")}
        />
        <DetailRow
          label="Asesor"
          value={personName(contact.assigned)}
          onPress={
            m.actor.role !== "advisor"
              ? () => setValue("edit-assign")
              : undefined
          }
          icon={UserCheck}
        />
        {value === "edit-priority" &&
          ["Alta", "Media", "Baja", "Sin prioridad"].map((p) => (
            <Option
              key={p}
              label={p}
              checked={contact.priority === p}
              onPress={() => act(() => m.setPriority(contact.id, p))}
            />
          ))}
        {value === "edit-assign" &&
          ["demo-owner", "demo-coordinator", "demo-advisor"].map((uid) => (
            <Option
              key={uid}
              label={personName(uid)}
              checked={contact.assigned === uid}
              onPress={() => act(() => m.assignContact(contact.id, uid))}
            />
          ))}
        <Button
          variant="secondary"
          onPress={() => {
            close();
            onChat(contact.id);
          }}
        >
          Abrir chat
        </Button>
        <Button
          variant="tonal"
          onPress={() => act(() => m.move(contact.id, "Cliente"))}
        >
          Ganado
        </Button>
        <Button variant="danger" onPress={() => onLayer("CRM-05")}>
          Perdido
        </Button>
        {footer}
      </View>
    );
  if (id === "CRM-03" && contact)
    return (
      <>
        {m.stageList.map((s) => (
          <Option
            key={s.name}
            label={s.name}
            checked={contact.stage === s.name}
            onPress={() =>
              s.name === "Perdido"
                ? onLayer("CRM-05")
                : act(() => m.move(contact.id, s.name))
            }
          />
        ))}
        {footer}
      </>
    );
  if (id === "CRM-04" && contact)
    return <AmountForm model={m} id={contact.id} done={close} />;
  if (id === "CRM-05" && contact)
    return (
      <View style={{ gap: 8 }}>
        {m.repository.catalog.reasonNames().map((reason) => (
          <Option
            key={reason}
            label={reason}
            checked={value === reason}
            onPress={() => setValue(reason)}
          />
        ))}
        {footer}
        <Button
          variant="danger"
          onPress={() => act(() => m.move(contact.id, "Perdido", value))}
        >
          Marcar perdido
        </Button>
      </View>
    );
  if (id === "CRM-06")
    return (
      <View style={{ gap: 10 }}>
        <Text>Contacto</Text>
        <ScrollView style={{ maxHeight: 280 }}>
          {m
            .list()
            .slice(0, 50)
            .map((c) => (
              <Option
                key={c.id}
                label={c.name}
                checked={value === c.id}
                onPress={() => setValue(c.id)}
              />
            ))}
        </ScrollView>
        <Text>Etapa: {m.stageList[0]?.name}</Text>
        <Field
          label="Monto (opcional)"
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
        />
        {footer}
        <Button
          onPress={() =>
            act(() => {
              if (!value) throw Error("Elige un contacto.");
              if (amount) m.amount(value, amount);
              m.move(value, m.stageList[0]!.name);
            })
          }
        >
          Crear lead
        </Button>
      </View>
    );
  if (id === "CRM-07C")
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
        {palette.map((color) => (
          <Pressable
            key={color}
            accessibilityRole="button"
            accessibilityLabel={`Color ${color}`}
            onPress={() =>
              act(() => m.color(arg ?? m.stageList[0]!.name, color))
            }
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: color,
            }}
          />
        ))}
        {error && <Text>{error}</Text>}
      </View>
    );
  if (id === "CRM-07D")
    return (
      <View style={{ gap: 12 }}>
        <Text>Eliminar «{arg}». Sus tratos se moverán a otra etapa.</Text>
        {m.stageList
          .filter((s) => s.name !== arg)
          .map((s) => (
            <Option
              key={s.name}
              label={s.name}
              checked={target === s.name}
              onPress={() => setTarget(s.name)}
            />
          ))}
        {footer}
        <Button
          variant="danger"
          onPress={() => act(() => m.deleteStage(arg ?? "", target))}
        >
          Eliminar
        </Button>
      </View>
    );
  if (id === "CRM-09")
    return (
      <>
        {m.actor.role !== "advisor" && (
          <NavRow
            icon={GitBranch}
            label="Gestionar etapas"
            onPress={() => {
              close();
              m.navigate("CRM-07", "");
            }}
          />
        )}
        <NavRow
          icon={Filter}
          label="Filtrar por asesor"
          onPress={() => onLayer("CRM-08")}
        />
        <NavRow
          icon={Plus}
          label="Nuevo lead"
          onPress={() => onLayer("CRM-06")}
        />
      </>
    );
  if (id === "CRM-13" && contact)
    return (
      <>
        <NavRow
          icon={Clock3}
          label="Ver historial"
          onPress={() => {
            close();
            onHistory(contact.id);
          }}
        />
        {m.actor.role !== "advisor" && (
          <>
            <Text>Cambiar consentimiento</Text>
            {(["Opt-in", "Sin respuesta", "Baja"] as const).map((v) => (
              <Option
                key={v}
                label={v}
                checked={contact.consent === v}
                onPress={() => act(() => m.consent(contact.id, v))}
              />
            ))}
          </>
        )}
        <NavRow
          icon={Archive}
          label="Archivar contacto"
          onPress={() => act(() => m.archive(contact.id))}
        />
        {error && <Text>{error}</Text>}
      </>
    );
  if (id === "CRM-15")
    return (
      <View style={{ gap: 10 }}>
        <Text>Etiqueta</Text>
        <FilterChips
          options={m.repository.catalog.tagNames()}
          value={value}
          onChange={setValue}
        />
        <Button variant="tonal" onPress={() => act(() => m.bulk("tag", value))}>
          Etiquetar
        </Button>
        {m.actor.role !== "advisor" && (
          <>
            <Text>Asignar a…</Text>
            {[
              ["demo-owner", "Fernando"],
              ["demo-coordinator", "Ana"],
              ["demo-advisor", "Luis"],
            ].map(([uid, name]) => (
              <Button
                key={uid}
                variant="secondary"
                onPress={() => act(() => m.bulk("assign", uid!))}
              >
                {name!}
              </Button>
            ))}
            <Button
              variant="secondary"
              onPress={() =>
                act(() => {
                  const csv = m.exportSample();
                  toast(
                    `${csv.split("\n").length - 1} contactos · exportación ficticia preparada`,
                  );
                })
              }
            >
              Exportar CSV
            </Button>
          </>
        )}
        {footer}
      </View>
    );
  if (id === "CRM-16")
    return (
      <>
        <NavRow
          icon={Upload}
          label="Importar contactos"
          onPress={() => {
            close();
            m.navigate("CRM-17", "");
          }}
        />
        {m.actor.role !== "advisor" && (
          <NavRow
            icon={Download}
            label="Exportar CSV"
            onPress={() =>
              act(() => {
                m.exportSample();
                toast("Exportación ficticia preparada");
              })
            }
          />
        )}
        <NavRow
          icon={Plus}
          label="Nuevo contacto"
          onPress={() => onLayer("CRM-12", "")}
        />
        {error && <Text>{error}</Text>}
      </>
    );
  return <Text>Esta acción requiere un contacto disponible.</Text>;
}
function ContactForm({
  model: m,
  done,
}: {
  model: CrmModel;
  done: () => void;
}) {
  const contact = m.state.contactId ? m.get(m.state.contactId) : null;
  const [name, setName] = useState(contact?.name ?? ""),
    [phone, setPhone] = useState(contact?.phone ?? ""),
    [email, setEmail] = useState(contact?.email ?? ""),
    [notes, setNotes] = useState(contact?.notes ?? ""),
    [error, setError] = useState("");
  return (
    <View style={{ gap: 12 }}>
      <Field label="Nombre" value={name} onChangeText={setName} />
      <Field
        label="Teléfono"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
        hint="Es la llave del contacto en WhatsApp."
      />
      <Field
        label="Correo (opcional)"
        keyboardType="email-address"
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
      />
      <Field label="Notas" multiline value={notes} onChangeText={setNotes} />
      <Text>
        Al guardar, el consentimiento nuevo queda como «sin respuesta» hasta que
        el cliente acepte.
      </Text>
      {error && <Text accessibilityRole="alert">{error}</Text>}
      <Button variant="secondary" onPress={done}>
        Cancelar
      </Button>
      <Button
        onPress={() => {
          try {
            m.saveContact({ id: contact?.id, name, phone, email, notes });
            done();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Guardar
      </Button>
    </View>
  );
}
function AmountForm({
  model: m,
  id,
  done,
}: {
  model: CrmModel;
  id: string;
  done: () => void;
}) {
  const [raw, setRaw] = useState(String(m.get(id).amount)),
    [error, setError] = useState("");
  return (
    <View style={{ gap: 12 }}>
      <Field
        label="Monto (MXN)"
        keyboardType="decimal-pad"
        value={raw}
        onChangeText={setRaw}
        error={error}
      />
      <Button variant="secondary" onPress={done}>
        Cancelar
      </Button>
      <Button
        onPress={() => {
          try {
            m.amount(id, raw);
            done();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Guardar
      </Button>
    </View>
  );
}
function Filters({
  model: m,
  pipeline,
  done,
}: {
  model: CrmModel;
  pipeline: boolean;
  done: () => void;
}) {
  const [draft, setDraft] = useState({ ...m.state });
  const set = (p: Partial<typeof draft>) => setDraft({ ...draft, ...p });
  return (
    <View style={{ gap: 10 }}>
      {pipeline ? (
        <Field
          label="Buscar lead"
          value={draft.query}
          onChangeText={(query) => set({ query })}
        />
      ) : (
        <>
          <Text>Etapa</Text>
          <FilterChips
            options={["Todas", ...m.stageList.map((s) => s.name)]}
            value={draft.stage}
            onChange={(stage) => set({ stage })}
          />
          <Text>Etiqueta</Text>
          <FilterChips
            options={["Todas", ...m.repository.catalog.tagNames()]}
            value={draft.tag}
            onChange={(tag) => set({ tag })}
          />
          <Text>Fuente</Text>
          <FilterChips
            options={["Toda fuente", "Orgánico", "Facebook Ads"]}
            value={draft.source}
            onChange={(source) => set({ source })}
          />
        </>
      )}
      {m.actor.role !== "advisor" && (
        <>
          <Text>Asesor</Text>
          {[
            "Todos",
            "Sin asignar",
            "demo-owner",
            "demo-coordinator",
            "demo-advisor",
          ].map((who) => (
            <Option
              key={who}
              label={who.startsWith("demo-") ? personName(who) : who}
              checked={draft.who === who}
              onPress={() => set({ who })}
            />
          ))}
        </>
      )}
      <Button
        variant="secondary"
        onPress={() => {
          m.patch({
            stage: "Todas",
            tag: "Todas",
            source: "Toda fuente",
            who: "Todos",
            query: "",
            offset: 0,
          });
          done();
        }}
      >
        Limpiar
      </Button>
      <Button
        onPress={() => {
          m.patch({
            query: draft.query,
            stage: draft.stage,
            tag: draft.tag,
            source: draft.source,
            who: draft.who,
            offset: 0,
          });
          done();
        }}
      >
        {pipeline ? "Ver resultados" : "Aplicar"}
      </Button>
    </View>
  );
}
