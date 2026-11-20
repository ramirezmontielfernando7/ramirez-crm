import React, { useState, useRef } from "react";
import { View } from "react-native";
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
            {state.doc.members.map((m) => (
              <NavRow
                key={m.id}
                label={`${m.name} · ${roleLabels[m.role]}${!m.active ? " · Pendiente o desactivado" : ""}`}
                onPress={() =>
                  layers.open({
                    kind: "sheet",
                    title: m.name,
                    content: <MemberEditor member={m} />,
                  })
                }
              />
            ))}
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
            <Text>Coordinador · Todo menos IA y plan</Text>
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
function MemberEditor({ member: m }: { member: Member }) {
  const { store, state } = useTeam(),
    { session } = useSession(),
    { close, toast } = useLayers(),
    action = useAction(),
    [role, setRole] = useState(m.role),
    [receive, setReceive] = useState(m.receiveNew),
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
        <Text>Invitación: {store.invitationState(invitation.id)}</Text>
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
                key.current + "-disable",
              );
              close();
            })
          }
        >
          Desactivar acceso
        </Button>
      )}
    </>
  );
}
