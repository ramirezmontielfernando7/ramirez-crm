import React, { useState, useRef } from "react";
import { Pressable, View } from "react-native";
import { ChevronRight, Pencil } from "lucide-react-native";
import { Screen } from "../../components/Screen";
import {
  Banner,
  Button,
  Choice,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  PageScroll,
  Section,
  Skeleton,
  Text,
} from "../../components/ui";
import { StudioBar } from "../studio/StudioBar";
import { useSession } from "../../state/SessionProvider";
import { useLayers } from "../../components/Layers";
import { useTheme } from "../../theme/ThemeProvider";
import { useInbox, useInboxState } from "../inbox/store";
import { canAccess } from "../../domain/access";
import { router } from "expo-router";
import { useCatalog } from "./state";
import {
  CatalogStore,
  catalogKey,
  tagPalette,
  type CatalogTag as Tag,
  type LossReason,
} from "./core";
import { CatalogTag } from "./CatalogTag";
function Gate({ children }: React.PropsWithChildren) {
  const { session, disabled } = useSession();
  return session &&
    session.role !== "advisor" &&
    canAccess(session.role, "more", disabled) ? (
    <>{children}</>
  ) : (
    <EmptyState
      title="Acceso no permitido"
      message="Administrar catálogos requiere Propietario o Coordinador."
    />
  );
}
const back = () =>
  router.canGoBack() ? router.back() : router.replace("/(tabs)/more");
function useAction() {
  const busy = useRef(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  return {
    pending,
    error,
    run: async (fn: () => Promise<unknown>) => {
      if (busy.current) return;
      busy.current = true;
      setPending(true);
      setError("");
      try {
        await fn();
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "No se pudo guardar el cambio local.",
        );
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
  };
}
function ReadState({ children }: React.PropsWithChildren) {
  const { store, state } = useCatalog(),
    inbox = useInbox(),
    status = useInboxState().status;
  return (
    <>
      {status === "offline" && (
        <Banner type="warning">Sin conexión · catálogo ficticio local.</Banner>
      )}
      {!state.ready ? (
        state.error ? (
          <ErrorState onRetry={() => void store.reload()} />
        ) : (
          <Skeleton rows={4} />
        )
      ) : status === "loading" ? (
        <Skeleton rows={4} />
      ) : status === "error" ? (
        <ErrorState
          onRetry={() => {
            inbox.patch({ status: "normal" });
            void store.reload();
          }}
        />
      ) : (
        children
      )}
    </>
  );
}
export function TagsScreen() {
  return (
    <Screen keyboard>
      <Gate>
        <TagsView />
      </Gate>
    </Screen>
  );
}
function TagsView() {
  const { store, state } = useCatalog(),
    inbox = useInbox(),
    status = useInboxState().status,
    layers = useLayers(),
    { colors: c } = useTheme();
  const manual = state.doc.tags.filter((t) => t.active && !t.automatic),
    automatic = state.doc.tags.filter((t) => t.active && t.automatic);
  const edit = (tag?: Tag, preset?: { name: string; color: string }) =>
    layers.open({
      kind: "sheet",
      title: "Etiqueta",
      content: (
        <TagEditor store={store} tag={tag} preset={preset} edit={edit} />
      ),
    });
  const count = (name: string) =>
    inbox.repository.list(inbox.actor).filter((c) => c.tags.includes(name))
      .length;
  return (
    <>
      <StudioBar title="Etiquetas" onBack={back} />
      <PageScroll>
        <ReadState>
          {status === "empty" || !manual.length ? (
            <EmptyState title="Sin etiquetas" message="Crea la primera." />
          ) : (
            manual.map((t) => (
              <Pressable
                key={t.id}
                accessibilityRole="button"
                accessibilityLabel={`Editar etiqueta ${t.name}`}
                onPress={() => edit(t)}
                style={{
                  minHeight: 64,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  borderBottomWidth: 1,
                  borderColor: c.border,
                  paddingVertical: 10,
                }}
              >
                <CatalogTag name={t.name} />
                <View style={{ flex: 1 }} />
                <Text kind="meta">{count(t.name)} contactos</Text>
                <ChevronRight color={c.text3} size={18} />
              </Pressable>
            ))
          )}
          {!!automatic.length && <Section>Automáticas de importación</Section>}
          {automatic.map((t) => (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              accessibilityLabel={`Fusionar ${t.name}`}
              onPress={() =>
                layers.open({
                  kind: "sheet",
                  title: "Fusionar etiqueta",
                  content: <MergeSheet store={store} source={t} />,
                })
              }
              style={{
                minHeight: 64,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingVertical: 10,
              }}
            >
              <View style={{ flex: 1 }}>
                <CatalogTag name={t.name} />
              </View>
              <Text kind="meta">{count(t.name)}</Text>
              <Text kind="meta" style={{ color: c.accentInk }}>
                Fusionar
              </Text>
            </Pressable>
          ))}
          <Button variant="tonal" onPress={() => edit()}>
            Nueva etiqueta
          </Button>
        </ReadState>
      </PageScroll>
    </>
  );
}
function TagEditor({
  store,
  tag,
  preset,
  edit,
}: {
  store: CatalogStore;
  tag?: Tag;
  preset?: { name: string; color: string };
  edit: (tag?: Tag, preset?: { name: string; color: string }) => void;
}) {
  const [name, setName] = useState(preset?.name ?? tag?.name ?? ""),
    [color, setColor] = useState(preset?.color ?? tag?.color ?? "#4338ca"),
    action = useAction(),
    key = useRef(catalogKey()),
    layers = useLayers();
  return (
    <>
      <Field
        label="Nombre"
        value={name}
        onChangeText={setName}
        maxLength={60}
      />
      <Section>Color</Section>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {tagPalette.map((v) => (
          <Pressable
            key={v}
            accessibilityRole="radio"
            accessibilityLabel={`Color ${v}`}
            accessibilityState={{ selected: color === v, checked: color === v }}
            aria-checked={color === v}
            onPress={() => setColor(v)}
            style={{
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: color === v ? 2 : 0,
              borderRadius: 22,
              borderColor: v,
            }}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: v,
              }}
            />
          </Pressable>
        ))}
      </View>
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      <View style={{ flexDirection: "row", gap: 12 }}>
        {tag && (
          <View style={{ flex: 1 }}>
            <Button
              variant="danger"
              disabled={action.pending}
              onPress={() =>
                layers.open({
                  kind: "dialog",
                  title: "¿Borrar etiqueta?",
                  content: (
                    <Confirm
                      onCancel={() => edit(tag, { name, color })}
                      confirm="Borrar etiqueta"
                      message="Se quitará de los contactos ficticios. El historial se conserva."
                      run={() =>
                        store.removeTag(
                          tag.id,
                          tag.revision,
                          key.current + "-delete",
                        )
                      }
                    />
                  ),
                })
              }
            >
              Borrar
            </Button>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Button
            disabled={action.pending}
            onPress={() =>
              void action.run(async () => {
                await store.saveTag(
                  {
                    id: tag?.id ?? null,
                    name,
                    color,
                    expected: tag?.revision ?? null,
                  },
                  key.current,
                );
                layers.close();
              })
            }
          >
            Guardar
          </Button>
        </View>
      </View>
    </>
  );
}
function Confirm({
  onCancel,
  confirm,
  message,
  run,
}: {
  onCancel: () => void;
  confirm: string;
  message: string;
  run: () => Promise<unknown>;
}) {
  const action = useAction(),
    { close } = useLayers();
  return (
    <>
      <Text>{message}</Text>
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      <Button variant="secondary" disabled={action.pending} onPress={onCancel}>
        Cancelar
      </Button>
      <Button
        disabled={action.pending}
        onPress={() =>
          void action.run(async () => {
            await run();
            close();
          })
        }
      >
        {confirm}
      </Button>
    </>
  );
}
function MergeSheet({
  store,
  source,
  initial = "",
}: {
  store: CatalogStore;
  source: Tag;
  initial?: string;
}) {
  const { state } = useCatalog(),
    [target, setTarget] = useState(initial),
    layers = useLayers(),
    key = useRef(catalogKey()),
    to = state.doc.tags.find(
      (t) => t.id === target && t.active && !t.automatic,
    );
  const restore = () =>
    layers.open({
      kind: "sheet",
      title: "Fusionar etiqueta",
      content: <MergeSheet store={store} source={source} initial={target} />,
    });
  return (
    <>
      <Text>Elige la etiqueta que conservarán los contactos ficticios.</Text>
      {state.doc.tags
        .filter((t) => t.active && !t.automatic)
        .map((t) => (
          <Choice
            key={t.id}
            radio
            label={t.name}
            checked={target === t.id}
            onPress={() => setTarget(t.id)}
          />
        ))}
      <Button
        disabled={!to}
        onPress={() =>
          to &&
          layers.open({
            kind: "dialog",
            title: "¿Fusionar etiquetas?",
            content: (
              <Confirm
                onCancel={restore}
                confirm="Fusionar etiquetas"
                message={`${source.name} se fusionará con ${to.name}, sin duplicar contactos.`}
                run={() =>
                  store.mergeTag(
                    source.id,
                    to.id,
                    source.revision,
                    to.revision,
                    key.current,
                  )
                }
              />
            ),
          })
        }
      >
        Fusionar
      </Button>
    </>
  );
}
export function LossReasonsScreen() {
  return (
    <Screen keyboard>
      <Gate>
        <LossView />
      </Gate>
    </Screen>
  );
}
function LossView() {
  const { store, state } = useCatalog(),
    layers = useLayers(),
    status = useInboxState().status,
    { colors: c } = useTheme();
  const edit = (reason?: LossReason, preset?: string) =>
    layers.open({
      kind: "sheet",
      title: reason ? "Motivo de pérdida" : "Nuevo motivo",
      content: (
        <ReasonEditor
          store={store}
          reason={reason}
          preset={preset}
          edit={edit}
        />
      ),
    });
  return (
    <>
      <StudioBar title="Motivos de pérdida" onBack={back} />
      <PageScroll>
        <ReadState>
          {status === "empty" ? (
            <EmptyState
              title="Sin motivos personalizados"
              message="El motivo Otro permanece disponible."
            />
          ) : (
            state.doc.reasons
              .filter((r) => r.active)
              .map((r) => (
                <View
                  key={r.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    minHeight: 56,
                    borderBottomWidth: 1,
                    borderColor: c.border,
                  }}
                >
                  <Text style={{ flex: 1 }}>{r.name}</Text>
                  {r.fixed ? (
                    <Text kind="meta">Fijo</Text>
                  ) : (
                    <IconButton
                      icon={Pencil}
                      label={`Editar motivo ${r.name}`}
                      onPress={() => edit(r)}
                    />
                  )}
                </View>
              ))
          )}
          <Button variant="tonal" onPress={() => edit()}>
            Nuevo motivo
          </Button>
        </ReadState>
      </PageScroll>
    </>
  );
}
function ReasonEditor({
  store,
  reason,
  preset,
  edit,
}: {
  store: CatalogStore;
  reason?: LossReason;
  preset?: string;
  edit: (reason?: LossReason, preset?: string) => void;
}) {
  const [name, setName] = useState(preset ?? reason?.name ?? ""),
    action = useAction(),
    layers = useLayers(),
    key = useRef(catalogKey());
  return (
    <>
      <Field
        label="Nombre"
        value={name}
        maxLength={60}
        onChangeText={setName}
      />
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      {reason && (
        <Button
          variant="danger"
          disabled={action.pending}
          onPress={() =>
            layers.open({
              kind: "dialog",
              title: "¿Desactivar motivo?",
              content: (
                <Confirm
                  onCancel={() => edit(reason, name)}
                  confirm="Desactivar motivo"
                  message="Los tratos anteriores conservan su motivo. No se ofrecerá para nuevas pérdidas."
                  run={() =>
                    store.deactivateReason(
                      reason.id,
                      reason.revision,
                      key.current + "-deactivate",
                    )
                  }
                />
              ),
            })
          }
        >
          Desactivar motivo
        </Button>
      )}
      <Button
        disabled={action.pending}
        onPress={() =>
          void action.run(async () => {
            await store.saveReason(
              {
                id: reason?.id ?? null,
                name,
                expected: reason?.revision ?? null,
              },
              key.current,
            );
            layers.close();
          })
        }
      >
        Guardar
      </Button>
    </>
  );
}
