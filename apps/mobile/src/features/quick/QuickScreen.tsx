import React, { useRef, useState } from "react";
import { View, Pressable } from "react-native";
import { router } from "expo-router";
import { Zap } from "lucide-react-native";
import { Screen } from "../../components/Screen";
import {
  Banner,
  Button,
  EmptyState,
  ErrorState,
  Field,
  PageScroll,
  Skeleton,
  Text,
} from "../../components/ui";
import { useSession } from "../../state/SessionProvider";
import { useTheme } from "../../theme/ThemeProvider";
import { useLayers } from "../../components/Layers";
import { StudioBar } from "../studio/StudioBar";
import { useInbox, useInboxState } from "../inbox/store";
import { canAccess } from "../../domain/access";
import { useQuick } from "./state";
import { type QuickReply, type QuickRepository, quickProblem } from "./core";
export function QuickScreen() {
  const { session, disabled } = useSession();
  return (
    <Screen keyboard>
      {session &&
      session.role !== "advisor" &&
      canAccess(session.role, "more", disabled) ? (
        <QuickView />
      ) : (
        <EmptyState
          title="Acceso no permitido"
          message="Administrar respuestas rápidas requiere Propietario o Coordinador."
        />
      )}
    </Screen>
  );
}
function QuickView() {
  const { store, state } = useQuick(),
    layers = useLayers(),
    inbox = useInbox(),
    status = useInboxState().status,
    { colors: c } = useTheme();
  const edit = (row?: QuickReply) =>
    layers.open({
      kind: "sheet",
      title: "Respuesta rápida",
      content: <QuickEditor store={store} row={row} />,
    });
  return (
    <>
      <StudioBar
        title="Respuestas rápidas"
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace("/(tabs)/more")
        }
      />
      <PageScroll>
        {status === "offline" && (
          <Banner type="warning">
            Sin conexión · catálogo ficticio local.
          </Banner>
        )}
        {!state.ready ? (
          state.error ? (
            <ErrorState onRetry={() => void store.reload()} />
          ) : (
            <Skeleton rows={3} />
          )
        ) : status === "loading" ? (
          <Skeleton rows={3} />
        ) : status === "error" ? (
          <ErrorState
            onRetry={() => {
              inbox.patch({ status: "normal" });
              void store.reload();
            }}
          />
        ) : (
          <>
            {status === "empty" || !state.doc.rows.length ? (
              <EmptyState
                title="Sin respuestas rápidas"
                message="Crea atajos como /precio."
              />
            ) : (
              state.doc.rows.map((row) => (
                <Pressable
                  key={row.id}
                  accessibilityRole="button"
                  accessibilityLabel={`/${row.shortcut} · ${row.body}`}
                  onPress={() => edit(row)}
                  style={{
                    minHeight: 76,
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderColor: c.border,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <Zap size={21} strokeWidth={1.8} color={c.accentInk} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text weight="medium">/{row.shortcut}</Text>
                    <Text kind="meta" numberOfLines={2}>
                      {row.body}
                    </Text>
                  </View>
                </Pressable>
              ))
            )}
            <Button variant="tonal" onPress={() => edit()}>
              Nueva respuesta
            </Button>
          </>
        )}
      </PageScroll>
    </>
  );
}
function QuickEditor({
  store,
  row,
}: {
  store: QuickRepository;
  row?: QuickReply;
}) {
  const [shortcut, setShortcut] = useState(row?.shortcut ?? ""),
    [body, setBody] = useState(row?.body ?? ""),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    busy = useRef(false),
    { close } = useLayers();
  const save = async () => {
    if (busy.current) return;
    const problem = quickProblem(shortcut, body);
    setError(problem);
    if (problem) return;
    busy.current = true;
    setPending(true);
    try {
      await store.save({
        id: row?.id ?? null,
        shortcut,
        body,
        expected: row?.revision ?? null,
      });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return (
    <>
      <Field
        label="Atajo"
        value={shortcut}
        onChangeText={setShortcut}
        autoCapitalize="none"
        hint={`Se usa escribiendo /${shortcut || "atajo"}`}
      />
      <Field
        label="Texto"
        value={body}
        onChangeText={setBody}
        multiline
        hint="Usa {nombre} para el nombre del contacto."
      />
      {!!error && <Banner type="danger">{error}</Banner>}
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" disabled={pending} onPress={close}>
            Cancelar
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button disabled={pending} onPress={() => void save()}>
            Guardar
          </Button>
        </View>
      </View>
    </>
  );
}
