import { useSession } from "../../state/SessionProvider";
import { canAccess } from "../../domain/access";
import { MarketingTabs } from "../marketing/Tabs";
import { useMarketing } from "../marketing/state";
import { useTheme } from "../../theme/ThemeProvider";
import React, { useRef, useState } from "react";
import { View, FlatList, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Plus, RefreshCw, FileText } from "lucide-react-native";
import { Screen } from "../../components/Screen";
import {
  AppBar,
  IconButton,
  FilterChips,
  SegmentedControl,
} from "../../components/ModuleUi";
import {
  Banner,
  Button,
  Card,
  Choice,
  EmptyState,
  ErrorState,
  Field,
  NavRow,
  PageScroll,
  Section,
  Skeleton,
  Text,
} from "../../components/ui";
import { StudioBar } from "../studio/StudioBar";
import { useLayers } from "../../components/Layers";
import { catalogKey } from "../catalog/core";
import { useTemplates } from "./state";
import {
  statusLabels,
  variables,
  type TemplateInput,
  type TemplateStatus,
} from "./core";
const filters = ["Todas", "Aprobadas", "En revisión", "Rechazadas"];
function useAction() {
  const busy = useRef(false),
    [error, setError] = useState("");
  return {
    error,
    run: async (fn: () => Promise<unknown>) => {
      if (busy.current) return;
      busy.current = true;
      setError("");
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error local.");
      } finally {
        busy.current = false;
      }
    },
  };
}
function Ready({ children }: React.PropsWithChildren) {
  const { store, state } = useTemplates();
  const { session, disabled } = useSession();
  if (!session || !canAccess(session.role, "marketing", disabled))
    return (
      <EmptyState
        title="Acceso no permitido"
        message="Marketing no está disponible para tu perfil."
        action={
          <Button onPress={() => router.replace("/(tabs)/inbox")}>
            Volver a Bandeja
          </Button>
        }
      />
    );
  return !state.ready ? (
    state.error ? (
      <ErrorState onRetry={() => void store.hydrate()} />
    ) : (
      <Skeleton rows={4} />
    )
  ) : store.team.actor(store.actor).role === "advisor" ? (
    <EmptyState
      title="Acceso no permitido"
      message="Tu rol puede usar plantillas aprobadas en Chat, pero no administrar Marketing."
    />
  ) : (
    <>{children}</>
  );
}
export function TemplateList() {
  const { store, state } = useTemplates(),
    [filter, setFilter] = useState("Todas"),
    { colors: c } = useTheme(),
    layers = useLayers();
  return (
    <Screen>
      <AppBar
        module
        title="Marketing"
        actions={
          <>
            <IconButton
              icon={RefreshCw}
              label="Sincronizar plantillas"
              onPress={() => {
                void store.reload();
                layers.toast("Sincronización local · sin Meta");
              }}
            />
            <IconButton
              icon={Plus}
              label="Nueva plantilla"
              onPress={() => router.push("/template-new")}
            />
          </>
        }
      />
      <MarketingTabs value="templates" />
      <Ready>
        <FilterChips options={filters} value={filter} onChange={setFilter} />
        <FlatList
          data={state.doc.rows.filter(
            (t) =>
              filter === "Todas" ||
              statusLabels[t.status] ===
                (filter === "Aprobadas"
                  ? "Aprobada"
                  : filter === "Rechazadas"
                    ? "Rechazada"
                    : filter),
          )}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ paddingBottom: 100 }}
          ListEmptyComponent={
            <EmptyState
              title="Sin plantillas"
              message="Crea una muestra o sincroniza el catálogo local."
            />
          }
          renderItem={({ item: t }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.name}
              onPress={() => router.push(`/template-detail?id=${t.id}`)}
              style={{
                minHeight: 104,
                padding: 16,
                flexDirection: "row",
                gap: 12,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: c.wash,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <FileText size={22} color={c.accentInk} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <View
                  style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
                >
                  <Text
                    kind="secondary"
                    weight="medium"
                    numberOfLines={1}
                    style={{ flex: 1 }}
                  >
                    {t.name}
                  </Text>
                  <Text
                    kind="meta"
                    style={{
                      color:
                        t.status === "approved"
                          ? c.success
                          : t.status === "rejected"
                            ? c.danger
                            : c.warning,
                    }}
                  >
                    {statusLabels[t.status]}
                  </Text>
                </View>
                <Text kind="meta" numberOfLines={2}>
                  {t.body}
                </Text>
                <Text kind="meta">
                  {t.category} · Calidad{" "}
                  {t.status === "approved"
                    ? "Alta"
                    : t.status === "paused"
                      ? "Baja"
                      : "—"}
                </Text>
              </View>
            </Pressable>
          )}
        />
      </Ready>
    </Screen>
  );
}
export function TemplateDetail() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    { state } = useTemplates();
  return (
    <Screen>
      <Ready>{state.ready && <Detail id={id} />}</Ready>
    </Screen>
  );
}
function Detail({ id }: { id: string }) {
  const { store } = useTemplates(),
    marketing = useMarketing();
  let t;
  try {
    t = store.get(id);
  } catch {
    return (
      <EmptyState
        title="Plantilla no disponible"
        message="Regresa al catálogo."
      />
    );
  }
  return (
    <>
      <StudioBar title={t.name} onBack={() => router.back()} />
      <PageScroll>
        <Text>{statusLabels[t.status]}</Text>
        {t.status === "rejected" && (
          <Banner type="danger">Rechazo ficticio: {t.reason}</Banner>
        )}
        {t.status === "paused" && (
          <Banner type="warning">
            Plantilla pausada · no puede enviarse en Chat.
          </Banner>
        )}
        <Section>Vista previa</Section>
        <Card>
          {t.header === "image" ? (
            <Banner>Imagen de demostración · sin archivo real</Banner>
          ) : t.header === "text" ? (
            <Text weight="semibold">{t.headerText}</Text>
          ) : null}
          <Text>{store.preview(t, ["Ana", "martes", "10:00"])}</Text>
          {!!t.footer && <Text kind="meta">{t.footer}</Text>}
          {t.button !== "none" && (
            <Text>
              {t.buttonText}
              {t.button === "link" ? " · https://example.invalid/demo" : ""}
            </Text>
          )}
        </Card>
        <Card>
          <Text>Categoría · {t.category}</Text>
          <Text>Idioma · es_MX</Text>
          <Text>
            Calidad ·{" "}
            {t.status === "approved"
              ? "Alta"
              : t.status === "paused"
                ? "Baja"
                : "—"}
          </Text>
          <Text>
            Usada en ·{" "}
            {marketing.state.ready ? marketing.store.usage(t.id) : "…"} campañas
            ficticias
          </Text>
        </Card>
        {t.status === "rejected" && (
          <Button onPress={() => router.push(`/template-new?source=${t.id}`)}>
            Corregir y reenviar
          </Button>
        )}
      </PageScroll>
    </>
  );
}
const defaults: TemplateInput = {
  name: "seguimiento_cotizacion",
  category: "UTILITY",
  header: "none",
  headerText: "",
  body: "Hola {{1}}, te confirmo tu sesión el {{2}} a las {{3}}.",
  footer: "",
  button: "none",
  buttonText: "",
};
export function TemplateEditor() {
  const { state } = useTemplates();
  return (
    <Screen>
      <StudioBar title="Nueva plantilla" onBack={() => router.back()} />
      <PageScroll>
        <Ready>{state.ready && <Editor />}</Ready>
      </PageScroll>
    </Screen>
  );
}
function Editor() {
  const { source } = useLocalSearchParams<{ source?: string }>(),
    { store } = useTemplates(),
    original = useRef(
      source ? store.rows().find((t) => t.id === source) : undefined,
    ).current,
    [draft, setDraft] = useState<TemplateInput>(
      original ? { ...original } : defaults,
    ),
    a = useAction(),
    key = useRef(catalogKey()),
    layers = useLayers();
  const set = (p: Partial<TemplateInput>) => setDraft((d) => ({ ...d, ...p }));
  let preview = "";
  try {
    preview = store.preview(draft, ["Ana", "martes", "10:00"]);
  } catch (e) {
    preview = (e as Error).message;
  }
  if (source && !original)
    return (
      <EmptyState
        title="Plantilla no disponible"
        message="Regresa al catálogo."
      />
    );
  return (
    <>
      <Field
        label="Nombre"
        value={draft.name}
        onChangeText={(v) => set({ name: v })}
        maxLength={64}
      />
      <Text kind="meta">
        Minúsculas, números y guion bajo. Solo datos ficticios.
      </Text>
      <Section>Categoría</Section>
      {(["UTILITY", "MARKETING"] as const).map((v) => (
        <Choice
          key={v}
          label={v}
          checked={draft.category === v}
          onPress={() => set({ category: v })}
        />
      ))}
      <NavRow
        label="Idioma · Español (México)"
        onPress={() => layers.toast("Esta simulación utiliza es_MX")}
      />
      <Section>Encabezado</Section>
      {(["none", "text", "image"] as const).map((v) => (
        <Choice
          key={v}
          label={
            v === "none"
              ? "Sin encabezado"
              : v === "text"
                ? "Texto"
                : "Imagen ficticia"
          }
          checked={draft.header === v}
          onPress={() => set({ header: v })}
        />
      ))}
      {draft.header === "text" && (
        <Field
          label="Texto del encabezado"
          value={draft.headerText}
          onChangeText={(v) => set({ headerText: v })}
          maxLength={60}
        />
      )}
      <Field
        label="Cuerpo"
        multiline
        value={draft.body}
        onChangeText={(v) => set({ body: v })}
        maxLength={1024}
      />
      <Field
        label="Pie (opcional)"
        value={draft.footer}
        onChangeText={(v) => set({ footer: v })}
        maxLength={60}
      />
      <Section>Botones (opcional)</Section>
      {(["none", "quick", "link"] as const).map((v) => (
        <Choice
          key={v}
          label={
            v === "none"
              ? "Ninguno"
              : v === "quick"
                ? "Respuesta rápida"
                : "Enlace ficticio"
          }
          checked={draft.button === v}
          onPress={() => set({ button: v })}
        />
      ))}
      {draft.button !== "none" && (
        <Field
          label="Texto del botón"
          value={draft.buttonText}
          onChangeText={(v) => set({ buttonText: v })}
          maxLength={25}
        />
      )}
      <Section>Vista previa</Section>
      <Card>
        <Text>{preview}</Text>
      </Card>
      {!!a.error && <Banner type="danger">{a.error}</Banner>}
      <Button
        onPress={() =>
          void a.run(async () => {
            const id = await store.submit(
              draft,
              key.current,
              original
                ? { id: original.id, revision: original.revision }
                : undefined,
            );
            router.replace(`/template-detail?id=${id}`);
          })
        }
      >
        Enviar a revisión
      </Button>
    </>
  );
}
export function TemplateLab() {
  const { store, state } = useTemplates(),
    a = useAction();
  return (
    <Screen>
      <StudioBar
        title="Laboratorio de plantillas"
        onBack={() => router.back()}
      />
      <PageScroll>
        <Ready>
          {state.ready && (
            <>
              <Banner>
                Revisión exclusivamente local. No sincroniza con Meta ni activa
                campañas.
              </Banner>
              {!!a.error && <Banner type="danger">{a.error}</Banner>}
              {state.doc.rows.map((t) => (
                <Card key={t.id}>
                  <Text>
                    {t.name} · {statusLabels[t.status]}
                  </Text>
                  {(t.status === "pending"
                    ? ["approved", "rejected"]
                    : t.status === "approved"
                      ? ["paused"]
                      : t.status === "paused"
                        ? ["approved"]
                        : []
                  ).map((s) => (
                    <Button
                      key={s}
                      variant="secondary"
                      onPress={() =>
                        void a.run(() =>
                          store.review(
                            t.id,
                            s as TemplateStatus,
                            s === "rejected"
                              ? "Rechazo de prueba: revisa el cuerpo y sus variables."
                              : "",
                            t.revision,
                          ),
                        )
                      }
                    >{`${statusLabels[s as TemplateStatus]} · ${t.name}`}</Button>
                  ))}
                </Card>
              ))}
            </>
          )}
        </Ready>
      </PageScroll>
    </Screen>
  );
}
