import React, { useState, useRef } from "react";
import { View, Pressable } from "react-native";
import { router } from "expo-router";
import { Screen } from "../../components/Screen";
import {
  Avatar,
  Banner,
  Button,
  Choice,
  EmptyState,
  ErrorState,
  Field,
  NavRow,
  PageScroll,
  Section,
  Skeleton,
  Switch,
  Text,
} from "../../components/ui";
import { StudioBar } from "../studio/StudioBar";
import { useTeam } from "./state";
import { useSession } from "../../state/SessionProvider";
import { useLayers } from "../../components/Layers";
import { catalogKey } from "../catalog/core";
import { roleLabels } from "../../domain/access";
import type { Member, TeamRole } from "./core";
const invitationLabels = {
  pending: "Pendiente",
  accepted: "Aceptada",
  expired: "Vencida",
  revoked: "Revocada",
};
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
        setError(e instanceof Error ? e.message : "No se pudo guardar.");
      } finally {
        busy.current = false;
      }
    },
  };
}
export function TeamScreen() {
  const { store, state } = useTeam(),
    { session } = useSession(),
    layers = useLayers();
  return (
    <Screen keyboard>
      <StudioBar
        title="Equipo y permisos"
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace("/(tabs)/more")
        }
      />
      <PageScroll>
        {!state.ready ? (
          state.error ? (
            <ErrorState onRetry={() => void store.reload()} />
          ) : (
            <Skeleton rows={4} />
          )
        ) : session?.role !== "owner" ? (
          <EmptyState
            title="Acceso no permitido"
            message="Gestionar personas requiere propietario activo."
          />
        ) : (
          <>
            {state.doc.members.filter((m) => m.active).length === 1 &&
              !state.doc.invitations.some(
                (i) => store.invitationState(i.id) === "pending",
              ) && (
                <EmptyState
                  title="Aún eres solo tú"
                  message="Invita a tu equipo ficticio."
                />
              )}
            {state.doc.members.map((m) => {
              const invitation = state.doc.invitations
                .filter((i) => i.memberId === m.id)
                .at(-1);
              const status = m.active
                ? ""
                : invitation
                  ? invitationLabels[store.invitationState(invitation.id)]
                  : "Desactivado";
              return (
                <Pressable
                  key={m.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${m.name} · ${roleLabels[m.role]}${status ? ` · ${status}` : ""}`}
                  onPress={() =>
                    layers.open({
                      kind: "sheet",
                      title: m.name,
                      content: <MemberEditor member={m} />,
                    })
                  }
                  style={{
                    minHeight: 76,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 12,
                  }}
                >
                  <Avatar name={m.name} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text weight="medium">{m.name}</Text>
                    <Text kind="meta">
                      {roleLabels[m.role]}
                      {status ? ` · ${status}` : ""}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
            <Button
              onPress={() =>
                layers.open({
                  kind: "sheet",
                  title: "Invitar persona",
                  content: <InviteForm />,
                })
              }
            >
              Invitar persona
            </Button>
            <Section>Qué puede cada rol</Section>
            <Text>Propietario · Todo</Text>
            <Text>
              Coordinador · Atención y CRM; sin IA, plan ni gestión de personas
            </Text>
            <Text>Asesor · Solo sus chats y su CRM</Text>
          </>
        )}
      </PageScroll>
    </Screen>
  );
}
function InviteForm() {
  const { store } = useTeam(),
    { session } = useSession(),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [role, setRole] = useState<TeamRole>("advisor"),
    [created, setCreated] = useState(""),
    action = useAction(),
    key = useRef(catalogKey()),
    { close } = useLayers();
  return (
    <>
      <Field label="Nombre" value={name} onChangeText={setName} />
      <Field
        label="Correo"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        hint="Solo correos ficticios @example.test"
      />
      {(["advisor", "coordinator"] as const).map((r) => (
        <Choice
          key={r}
          radio
          label={roleLabels[r]}
          checked={role === r}
          onPress={() => setRole(r)}
        />
      ))}
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      {!!created && (
        <Banner>
          Invitación local creada: {created}. No se envió ningún mensaje.
        </Banner>
      )}
      <Button variant="secondary" onPress={close}>
        Cancelar
      </Button>
      <Button
        disabled={!!created}
        onPress={() =>
          void action.run(async () =>
            setCreated(
              await store.invite(
                session!.id,
                { name, email, role },
                key.current,
              ),
            ),
          )
        }
      >
        Crear enlace
      </Button>
    </>
  );
}
function MemberEditor({
  member: m,
  preset,
}: {
  member: Member;
  preset?: { role: TeamRole; receive: boolean };
}) {
  const { store, state } = useTeam(),
    { session } = useSession(),
    { close, toast, open } = useLayers(),
    action = useAction(),
    [role, setRole] = useState(preset?.role ?? m.role),
    [receive, setReceive] = useState(preset?.receive ?? m.receiveNew),
    key = useRef(catalogKey());
  const invitation = state.doc.invitations
    .filter((i) => i.memberId === m.id)
    .at(-1);
  return (
    <>
      {(["owner", "coordinator", "advisor"] as const).map((r) => (
        <Choice
          key={r}
          radio
          label={roleLabels[r]}
          checked={role === r}
          onPress={() => setRole(r)}
        />
      ))}
      <Switch
        label="Recibe chats nuevos"
        value={receive}
        onChange={setReceive}
      />
      {!!invitation && (
        <Text>
          Invitación: {invitationLabels[store.invitationState(invitation.id)]}
        </Text>
      )}
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      <Button
        onPress={() =>
          void action.run(async () => {
            await store.update(
              session!.id,
              m.id,
              {
                role,
                active: m.active,
                receiveNew: receive,
                expected: m.revision,
              },
              key.current,
            );
            close();
          })
        }
      >
        Guardar
      </Button>
      {invitation && invitation.status === "pending" && (
        <Button
          variant="secondary"
          onPress={() =>
            void action.run(async () => {
              await store.revoke(
                session!.id,
                invitation.id,
                key.current + "-revoke",
              );
              close();
            })
          }
        >
          Revocar invitación
        </Button>
      )}
      {invitation && store.invitationState(invitation.id) !== "accepted" && (
        <Button
          variant="secondary"
          onPress={() =>
            void action.run(async () => {
              const id = await store.reissue(
                session!.id,
                invitation.id,
                key.current + "-reissue",
              );
              toast(`Invitación local: ${id}`);
              close();
            })
          }
        >
          Reemitir invitación
        </Button>
      )}
      {m.active && (
        <>
          <Button
            variant="secondary"
            onPress={() =>
              void action.run(async () => {
                await store.resetAccess(
                  session!.id,
                  m.id,
                  key.current + "-reset",
                );
                toast(
                  "Restablecimiento ficticio registrado; ninguna contraseña real cambió.",
                );
                close();
              })
            }
          >
            Restablecer acceso ficticio
          </Button>
          <Button
            variant="danger"
            onPress={() =>
              open({
                kind: "dialog",
                title: "¿Desactivar acceso?",
                content: (
                  <Deactivate
                    member={m}
                    cancel={() =>
                      open({
                        kind: "sheet",
                        title: m.name,
                        content: (
                          <MemberEditor member={m} preset={{ role, receive }} />
                        ),
                      })
                    }
                  />
                ),
              })
            }
          >
            Desactivar acceso
          </Button>
        </>
      )}
    </>
  );
}

function Deactivate({
  member: m,
  cancel,
}: {
  member: Member;
  cancel: () => void;
}) {
  const { store } = useTeam(),
    { session } = useSession(),
    action = useAction(),
    { close } = useLayers(),
    key = useRef(catalogKey());
  return (
    <>
      <Text>
        Se desactivará el acceso ficticio de {m.name}. Sus asignaciones
        históricas se conservan.
      </Text>
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      <Button variant="secondary" onPress={cancel}>
        Cancelar
      </Button>
      <Button
        variant="danger"
        onPress={() =>
          void action.run(async () => {
            await store.update(
              session!.id,
              m.id,
              {
                role: m.role,
                active: false,
                receiveNew: m.receiveNew,
                expected: m.revision,
              },
              key.current,
            );
            close();
          })
        }
      >
        Confirmar desactivación
      </Button>
    </>
  );
}
export function TeamLab() {
  const { store, state } = useTeam(),
    { session } = useSession(),
    action = useAction();
  return (
    <Screen>
      <StudioBar title="Laboratorio de equipo" onBack={() => router.back()} />
      <PageScroll>
        {session?.role !== "owner" ? (
          <EmptyState
            title="Acceso no permitido"
            message="Solo propietario ficticio."
          />
        ) : (
          <>
            <Banner>
              Controles locales de demostración. No envían invitaciones ni crean
              sesiones.
            </Banner>
            {!!action.error && <Banner type="danger">{action.error}</Banner>}
            {state.doc.invitations.map((i) => (
              <View key={i.id}>
                <Text>
                  {i.id} · {invitationLabels[store.invitationState(i.id)]}
                </Text>
                <Button
                  onPress={() =>
                    void action.run(() => store.accept(i.id, catalogKey()))
                  }
                >
                  {`Aceptar muestra ${i.id}`}
                </Button>
                <Button
                  onPress={() =>
                    void action.run(() =>
                      store.expireDemo(session.id, i.id, catalogKey()),
                    )
                  }
                >
                  {`Vencer muestra ${i.id}`}
                </Button>
              </View>
            ))}
          </>
        )}
      </PageScroll>
    </Screen>
  );
}
