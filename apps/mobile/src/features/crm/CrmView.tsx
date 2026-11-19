import React, { memo, useMemo, useSyncExternalStore } from "react";
import {
  FlatList,
  TextInput,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import {
  Search,
  MoreVertical,
  Plus,
  SquareCheckBig,
  UserPlus,
  SlidersHorizontal,
  Pencil,
  MessageCircle,
  ListChecks,
  ArrowUp,
  Trash2,
} from "lucide-react-native";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
  Banner,
  Field,
  Section,
  StageCapsule,
  TagCapsule,
  Text,
} from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";
import { SectionTabs } from "./SectionTabs";
import { personName } from "../contact/model";
import { CrmModel, type CrmContact, type CrmId } from "./core";
export type CrmNavigation = {
  model: CrmModel;
  onLayer: (id: CrmId, arg?: string) => void;
  onChat: (id: string) => void;
  onTask: (id: string) => void;
  onHistory: (id: string) => void;
};
import {
  AppBar,
  IconButton,
  FilterChips,
  SegmentedControl,
} from "../../components/ModuleUi";
import { refinementB } from "../../theme/refinement-b";
const fmt = (n: number) =>
  "$" + n.toLocaleString("es-MX", { maximumFractionDigits: 2 });
const ContactRow = memo(function ContactRow({
  item,
  selected,
  selecting,
  onPress,
}: {
  item: CrmContact;
  selected: boolean;
  selecting: boolean;
  onPress: () => void;
}) {
  const { colors: c } = useTheme();
  return (
    <Pressable
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityLabel={`${item.name}, ${item.phone}`}
      accessibilityState={{
        selected,
        checked: selecting ? selected : undefined,
      }}
      onPress={onPress}
      style={{
        minHeight: 88,
        paddingHorizontal: 16,
        paddingVertical: 12,
        flexDirection: "row",
        gap: 12,
        backgroundColor: selected ? c.tint : c.surface,
      }}
    >
      {selecting && <Text>{selected ? "☑" : "☐"}</Text>}
      <Avatar name={item.name} />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Text
            weight="medium"
            kind="name"
            numberOfLines={1}
            style={{ flex: 1, fontSize: refinementB.nameSize }}
          >
            {item.name}
          </Text>
          {item.consent === "Baja" && <TagCapsule danger>Baja</TagCapsule>}
        </View>
        <Text
          kind="secondary"
          style={{ color: c.text3, fontSize: refinementB.secondarySize }}
        >
          {item.phone}
        </Text>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <StageCapsule>{item.stage}</StageCapsule>
          {item.tags.slice(0, 1).map((t) => (
            <TagCapsule key={t}>{t}</TagCapsule>
          ))}
        </View>
      </View>
    </Pressable>
  );
});
export function CrmView(props: CrmNavigation) {
  const { model: m, onLayer, onChat, onTask } = props;
  const revision = useSyncExternalStore(m.subscribe, m.snapshot, m.snapshot),
    { colors: c } = useTheme(),
    { width } = useWindowDimensions();
  const state = m.state,
    screen = state.screen;
  const rows = useMemo(() => m.list(), [m, revision]);
  const selected = state.contactId ? m.get(state.contactId) : null;
  const isContact = screen === "CRM-10",
    isDetail = screen === "CRM-11",
    manager = screen === "CRM-07";
  const segment = (
    <SectionTabs
      value={isContact ? "contacts" : "pipeline"}
      onChange={(section) =>
        section === "library"
          ? onLayer("CRM-16", "library")
          : m.navigate(section === "contacts" ? "CRM-10" : "CRM-01", "")
      }
    />
  );

  if (state.status === "loading" || state.status === "error")
    return (
      <>
        <AppBar title="CRM" module />
        {segment}
        {state.status === "loading" ? (
          <Skeleton rows={7} />
        ) : (
          <ErrorState onRetry={() => m.patch({ status: "normal" })} />
        )}
      </>
    );
  if (screen === "CRM-17") return <CrmImport {...props} />;
  if (manager)
    return (
      <>
        <AppBar
          title="Etapas del pipeline"
          onBack={() => m.navigate("CRM-01", "")}
        />
        <ScrollView
          contentContainerStyle={{ paddingBottom: 140 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={{ padding: 16, color: c.text3 }}>
            Reordena con las flechas, cambia el color tocando el punto.
          </Text>
          {m.stageList.map((s, i) => (
            <View
              key={s.name}
              style={{
                flexDirection: "row",
                alignItems: "center",
                minHeight: 56,
                paddingHorizontal: 16,
                borderBottomWidth: 1,
                borderColor: c.border,
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Color de ${s.name}`}
                onPress={() => onLayer("CRM-07C", s.name)}
                style={{
                  width: 48,
                  height: 48,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <View
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 8,
                    backgroundColor: s.color,
                  }}
                />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text>{s.name}</Text>
                <Text kind="meta">
                  {rows.filter((r) => r.stage === s.name).length} tratos
                </Text>
              </View>
              <IconButton
                icon={ArrowUp}
                label={`Subir ${s.name}`}
                disabled={i === 0}
                onPress={() => m.reorder(i)}
              />
              <IconButton
                icon={Trash2}
                label={`Eliminar ${s.name}`}
                onPress={() => onLayer("CRM-07D", s.name)}
              />
            </View>
          ))}
          <StageAdder model={m} />
        </ScrollView>
      </>
    );
  if (isDetail && selected)
    return (
      <>
        <AppBar
          title="Contacto"
          onBack={() => m.navigate("CRM-10")}
          actions={
            <>
              <IconButton
                icon={Pencil}
                label="Editar contacto"
                onPress={() => onLayer("CRM-12", selected.id)}
              />
              <IconButton
                icon={MoreVertical}
                label="Opciones del contacto"
                onPress={() => onLayer("CRM-13")}
              />
            </>
          }
        />
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 14 }}
        >
          <View style={{ alignItems: "center", gap: 6 }}>
            <Avatar name={selected.name} />
            <Text kind="title" weight="semibold">
              {selected.name}
            </Text>
            <Text kind="secondary">{selected.phone}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button icon={MessageCircle} onPress={() => onChat(selected.id)}>
                {selected.closed ? "Escribir primero" : "Abrir chat"}
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button
                variant="secondary"
                icon={ListChecks}
                onPress={() => onTask(selected.id)}
              >
                Tarea
              </Button>
            </View>
          </View>
          <Card>
            {[
              ["Etapa", selected.stage],
              ["Asesor", personName(selected.assigned)],
              ["Consentimiento", selected.consent],
              ["Fuente", selected.source],
              ["Correo", selected.email || "—"],
            ].map(([key, value]) => (
              <View
                key={key}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  gap: 8,
                  minHeight: 32,
                }}
              >
                <Text kind="secondary">{key}</Text>
                <Text kind="secondary" style={{ flexShrink: 1 }}>
                  {value}
                </Text>
              </View>
            ))}
          </Card>
          <Section>Etiquetas</Section>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {selected.tags.map((t) => (
              <TagCapsule key={t}>{t}</TagCapsule>
            ))}
          </View>
          <Section>Notas de trabajo</Section>
          <Card>
            <Text>{selected.notes || "Sin notas"}</Text>
          </Card>
          {selected.consent === "Baja" && (
            <Text style={{ color: c.danger }}>
              Pidió no recibir mensajes. Solo una persona con permiso puede
              quitar la baja.
            </Text>
          )}
        </ScrollView>
      </>
    );
  return (
    <>
      <AppBar
        title="CRM"
        module
        actions={
          state.selecting ? (
            <>
              <Text>{state.selected.size} seleccionados</Text>
              <Button variant="ghost" onPress={() => m.cancelSelection()}>
                Cancelar
              </Button>
              <IconButton
                icon={MoreVertical}
                label="Acciones con seleccionados"
                onPress={() => onLayer("CRM-15")}
              />
            </>
          ) : (
            <>
              <IconButton
                icon={isContact ? SquareCheckBig : Search}
                label={isContact ? "Seleccionar contactos" : "Buscar lead"}
                onPress={() =>
                  isContact ? m.patch({ selecting: true }) : onLayer("CRM-08")
                }
              />
              <IconButton
                icon={MoreVertical}
                label="Más opciones"
                onPress={() => onLayer(isContact ? "CRM-16" : "CRM-09")}
              />
            </>
          )
        }
      />
      {!state.selecting && segment}
      {state.status === "offline" && (
        <Banner type="warning">
          Sin conexión · puedes consultar los datos de demostración.
        </Banner>
      )}
      {isContact ? (
        <>
          <View
            style={{
              marginHorizontal: 16,
              marginTop: 6,
              marginBottom: 4,
              height: 44,
              borderRadius: 22,
              backgroundColor: c.sunken,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 14,
            }}
          >
            <Search size={20} color={c.text3} />
            <TextInput
              accessibilityLabel="Buscar nombre o teléfono"
              placeholder="Buscar nombre o teléfono"
              placeholderTextColor={c.text3}
              value={state.query}
              onChangeText={(query) => m.patch({ query, offset: 0 })}
              style={{
                flex: 1,
                color: c.text,
                fontFamily: "Inter_400Regular",
                fontSize: 15,
                height: 44,
                padding: 0,
              }}
            />
          </View>
          <View
            style={{
              paddingHorizontal: 16,
              flexDirection: "row",
              alignItems: "center",
            }}
          >
            <View style={{ flex: 1 }}>
              <FilterChips
                options={["Todas", "Opt-in", "Sin respuesta", "Baja"]}
                value={state.consent}
                onChange={(consent) => m.patch({ consent, offset: 0 })}
              />
            </View>
            <IconButton
              icon={SlidersHorizontal}
              label="Filtros de contactos"
              onPress={() => onLayer("CRM-14")}
            />
          </View>
          <FlatList
            data={state.status === "empty" ? [] : rows}
            keyExtractor={(r) => r.id}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            contentContainerStyle={{ paddingBottom: 150 }}
            contentOffset={{ x: 0, y: state.offset }}
            onScroll={(e) => {
              m.state.offset = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={32}
            renderItem={({ item }) => (
              <ContactRow
                item={item}
                selecting={state.selecting}
                selected={state.selected.has(item.id)}
                onPress={() =>
                  state.selecting
                    ? m.toggle(item.id)
                    : m.navigate("CRM-11", item.id)
                }
              />
            )}
            ListEmptyComponent={
              <EmptyState
                title="Sin resultados"
                message="Prueba con otro nombre o quita los filtros."
              />
            }
            ListFooterComponent={
              <Text kind="meta" style={{ textAlign: "center", padding: 14 }}>
                Mostrando {rows.length} contactos
              </Text>
            }
          />
        </>
      ) : (
        <>
          <View
            style={{
              flexDirection: "row",
              gap: 8,
              paddingHorizontal: 16,
              paddingVertical: 8,
            }}
          >
            {[
              [
                "Abiertos",
                String(
                  rows.filter((r) => !["Cliente", "Perdido"].includes(r.stage))
                    .length,
                ),
              ],
              [
                "En juego",
                fmt(
                  rows
                    .filter((r) => !["Cliente", "Perdido"].includes(r.stage))
                    .reduce((n, r) => n + r.amount, 0),
                ),
              ],
              [
                "Ganados",
                String(rows.filter((r) => r.stage === "Cliente").length),
              ],
            ].map(([label, value]) => (
              <Card key={label} style={{ flex: 1, padding: 9 }}>
                <Text kind="meta">{label}</Text>
                <Text weight="semibold" numberOfLines={1}>
                  {value}
                </Text>
              </Card>
            ))}
          </View>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "center",
              gap: 5,
              padding: 6,
            }}
          >
            {m.stageList.map((s, i) => (
              <View
                key={s.name}
                style={{
                  width: 16,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: i === state.column ? c.accent : c.border,
                }}
              />
            ))}
          </View>
          <FlatList
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            data={m.stageList}
            keyExtractor={(s) => s.name}
            initialScrollIndex={state.column}
            getItemLayout={(_, i) => ({
              length: width,
              offset: width * i,
              index: i,
            })}
            onMomentumScrollEnd={(e) =>
              m.patch({
                column: Math.round(e.nativeEvent.contentOffset.x / width),
              })
            }
            renderItem={({ item: s }) => (
              <View
                style={{ width, paddingHorizontal: 16, paddingVertical: 6 }}
              >
                <View
                  style={{ flexDirection: "row", gap: 8, paddingBottom: 12 }}
                >
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: s.color,
                      marginTop: 5,
                    }}
                  />
                  <Text weight="semibold" style={{ flex: 1 }}>
                    {s.name}
                  </Text>
                  <Text kind="meta">
                    {rows.filter((r) => r.stage === s.name).length} ·{" "}
                    {fmt(
                      rows
                        .filter((r) => r.stage === s.name)
                        .reduce((n, r) => n + r.amount, 0),
                    )}
                  </Text>
                </View>
                <FlatList
                  data={
                    state.status === "empty"
                      ? []
                      : rows.filter((r) => r.stage === s.name)
                  }
                  keyExtractor={(r) => r.id}
                  initialNumToRender={8}
                  windowSize={5}
                  contentContainerStyle={{ paddingBottom: 150 }}
                  renderItem={({ item: r }) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${r.name}, ${fmt(r.amount)}`}
                      onPress={() => onLayer("CRM-02", r.id)}
                      style={{
                        borderWidth: 1,
                        borderColor: c.border,
                        borderRadius: 16,
                        padding: 14,
                        marginBottom: 10,
                        gap: 10,
                        backgroundColor: c.surface,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <Avatar name={r.name} />
                        <Text
                          weight="medium"
                          style={{ flex: 1 }}
                          numberOfLines={1}
                        >
                          {r.name}
                        </Text>
                        <Text>{fmt(r.amount)}</Text>
                      </View>
                      <View style={{ flexDirection: "row", gap: 6 }}>
                        {r.tags.slice(0, 2).map((t) => (
                          <TagCapsule key={t}>{t}</TagCapsule>
                        ))}
                        <Text kind="meta">
                          {r.assigned ? "Asignado" : "Sin asignar"}
                        </Text>
                      </View>
                    </Pressable>
                  )}
                  ListEmptyComponent={
                    <Text
                      style={{
                        textAlign: "center",
                        padding: 24,
                        color: c.text3,
                      }}
                    >
                      Sin tratos en esta etapa
                    </Text>
                  }
                />
              </View>
            )}
          />
        </>
      )}
      {!state.selecting && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isContact ? "Nuevo contacto" : "Nuevo lead"}
          onPress={() => onLayer(isContact ? "CRM-12" : "CRM-06", "")}
          style={{
            position: "absolute",
            right: 18,
            bottom: 100,
            width: 56,
            height: 56,
            borderRadius: 18,
            backgroundColor: c.accent,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isContact ? (
            <UserPlus size={24} color={c.onAccent} />
          ) : (
            <Plus size={24} color={c.onAccent} />
          )}
        </Pressable>
      )}
    </>
  );
}
function StageAdder({ model: m }: { model: CrmModel }) {
  const [name, setName] = React.useState(""),
    [error, setError] = React.useState("");
  return (
    <View style={{ padding: 16, gap: 10 }}>
      <Field
        label="Nueva etapa"
        value={name}
        onChangeText={setName}
        error={error}
      />
      <Button
        variant="tonal"
        onPress={() => {
          try {
            m.addStage(name);
            setName("");
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Agregar etapa
      </Button>
    </View>
  );
}
function CrmImport({ model: m }: CrmNavigation) {
  const [step, setStep] = React.useState(1),
    [consent, setConsent] = React.useState<"yes" | "unknown" | null>(null),
    [error, setError] = React.useState("");
  return (
    <>
      <AppBar
        title="Importar contactos"
        onBack={() => m.navigate("CRM-10", "")}
      />
      <View style={{ flexDirection: "row", gap: 6, padding: 16 }}>
        {[1, 2, 3].map((i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 4,
              backgroundColor: i <= step ? "#12999d" : "#94a3b8",
            }}
          />
        ))}
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 14 }}
      >
        {step === 1 ? (
          <Card>
            <Text kind="title">Elige tu archivo</Text>
            <Text>.csv o .xlsx · máx. 5 MB y 10,000 filas</Text>
            <Button onPress={() => setStep(2)}>Elegir archivo</Button>
          </Card>
        ) : step === 2 ? (
          <>
            <Text>Archivo leído: muestra ficticia · 1 fila válida</Text>
            <Text weight="semibold">¿Aceptaron recibir mensajes?</Text>
            {(["yes", "unknown"] as const).map((v) => (
              <Button
                key={v}
                variant={consent === v ? "tonal" : "secondary"}
                onPress={() => setConsent(v)}
              >
                {v === "yes"
                  ? "Sí, aceptaron (opt-in)"
                  : "No lo sé / no aceptaron"}
              </Button>
            ))}
            <Text>{error}</Text>
            <Button
              onPress={() => {
                try {
                  m.importSample(consent);
                  setStep(3);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Importar
            </Button>
          </>
        ) : (
          <EmptyState
            title="Importación lista"
            message="1 contacto ficticio procesado"
            action={
              <Button onPress={() => m.navigate("CRM-10", "")}>
                Ver contactos
              </Button>
            }
          />
        )}
      </ScrollView>
    </>
  );
}
