import { useCallback, useState } from "react";
import { Linking } from "react-native";
import { AppBar, SegmentedControl } from "../components/ModuleUi";
import { Screen } from "../components/Screen";
import {
  Banner,
  Button,
  Card,
  PageScroll,
  Switch,
  Text,
} from "../components/ui";
import {
  RemoteHttpError,
  requiresRemoteLogin,
  type RemoteAuthRepository,
} from "../integration/remote-http";
import { useTheme } from "../theme/ThemeProvider";
import type { ThemeMode } from "../theme/tokens";
import {
  RemoteFeedback,
  type RemotePageProps,
  useRemoteData,
} from "./RemoteWorkspaceUi";

import type { RemotePushControls } from "./useRemotePush";

const themes = [
  { key: "light", label: "Claro" },
  { key: "dark", label: "Oscuro" },
  { key: "system", label: "Automático" },
];
const barOptions = [
  { key: "standard", label: "Bandeja primero" },
  { key: "crm-first", label: "CRM primero" },
];
export type MobileBar = "standard" | "crm-first";

export async function remoteModulesAccess(repo: RemoteAuthRepository) {
  async function can(read: () => Promise<unknown>) {
    try {
      await read();
      return true;
    } catch (reason) {
      if (
        reason instanceof RemoteHttpError &&
        !requiresRemoteLogin(reason) &&
        [403, 404].includes(reason.status)
      )
        return false;
      throw reason;
    }
  }
  const day = new Date().toISOString().slice(0, 10);
  const [agents, campaigns, results, teamResults, team, tasks, agenda] =
    await Promise.all([
      can(() => repo.agents()),
      can(() => repo.campaigns()),
      can(() => repo.analytics("hygiene")),
      can(() => repo.analytics("team")),
      can(() => repo.team()),
      can(() => repo.tasks()),
      can(() => repo.calendar(day, day)),
    ]);
  return { agents, campaigns, results, teamResults, team, tasks, agenda };
}

export function RemoteSettings({
  repository,
  expired,
  back,
  team,
  push,
  bar,
  setBar,
  logout,
}: RemotePageProps & {
  back: () => void;
  team: boolean;
  push: RemotePushControls;
  bar: MobileBar;
  setBar: (option: MobileBar) => Promise<void>;
  logout: () => Promise<void>;
}) {
  const theme = useTheme();
  const [error, setError] = useState("");
  const [members, showMembers] = useState(false);
  async function openWebSettings() {
    setError("");
    try {
      await Linking.openURL(repository.origin + "/settings");
    } catch {
      setError("No se pudo abrir el CRM en el navegador.");
    }
  }
  return (
    <Screen>
      <AppBar title="Ajustes" onBack={back} />
      <PageScroll>
        <Card style={{ gap: 8 }}>
          <Text weight="semibold">Perfil y seguridad</Text>
          <Text kind="secondary">
            Nombre de perfil, contraseña y verificación en dos pasos
          </Text>
          <Button variant="secondary" onPress={() => void openWebSettings()}>
            Abrir Ajustes en la web
          </Button>
        </Card>
        <Card style={{ gap: 8 }}>
          <Text weight="semibold">Apariencia en este dispositivo</Text>
          <SegmentedControl
            options={themes}
            value={theme.mode}
            onChange={(mode) => void theme.setMode(mode as ThemeMode)}
          />
          {!!theme.error && <Banner type="warning">{theme.error}</Banner>}
          <Text weight="semibold">Barra inferior</Text>
          <SegmentedControl
            options={barOptions}
            value={bar}
            onChange={async (key) => {
              setError("");
              try {
                await setBar(key as MobileBar);
              } catch {
                setError("No se pudo guardar la barra.");
              }
            }}
          />
        </Card>
        {team && (
          <>
            <Button variant="secondary" onPress={() => showMembers(!members)}>
              {members ? "Ocultar equipo" : "Ver equipo"}
            </Button>
            {members && <Directory repository={repository} expired={expired} />}
          </>
        )}
        <Text kind="meta">
          Facturación y administración de plataforma · Disponible en la versión
          web
        </Text>
        <Card style={{ gap: 8 }}>
          <Text weight="semibold">Notificaciones</Text>
          <Text kind="secondary">
            Recibe un aviso de Android al llegar un mensaje. La pantalla
            bloqueada no muestra el texto ni el nombre del cliente.
          </Text>
          {push.available ? (
            <>
              <Switch
                label="Avisos de mensajes"
                value={push.enabled}
                onChange={(enabled) => {
                  if (!push.busy) void push.toggle(enabled);
                }}
              />
              {push.busy && (
                <Text kind="meta" accessibilityLiveRegion="polite">
                  Guardando…
                </Text>
              )}
              {!!push.message && <Banner type="warning">{push.message}</Banner>}
              {push.denied && (
                <Button
                  variant="ghost"
                  onPress={() => void Linking.openSettings().catch(() => {})}
                >
                  Abrir ajustes de Android
                </Button>
              )}
              {!push.enabled &&
                push.message.startsWith("Falta desvincular") && (
                  <Button
                    variant="ghost"
                    disabled={push.busy}
                    onPress={() => void push.toggle(false)}
                  >
                    Reintentar desvinculación
                  </Button>
                )}
            </>
          ) : (
            <Text kind="meta">
              Avisos del sistema no disponibles en esta instalación.
            </Text>
          )}
          <Text kind="meta">Sonidos y preferencias por tipo · Demo</Text>
        </Card>
        {!!error && <Banner type="warning">{error}</Banner>}
        <Button onPress={() => void logout()}>Cerrar sesión</Button>
      </PageScroll>
    </Screen>
  );
}
function Directory({ repository, expired }: RemotePageProps) {
  const load = useCallback(() => repository.team(), [repository]);
  const result = useRemoteData(load, expired);
  return (
    <>
      <RemoteFeedback {...result} />
      {result.data?.length === 0 && <Text>Sin personas en el equipo.</Text>}
      {result.data?.map((person) => (
        <Card key={person.id}>
          <Text>{person.name}</Text>
          {!!person.role && (
            <Text kind="secondary">
              {person.role === "owner"
                ? "Propietario"
                : person.role === "coordinador"
                  ? "Coordinador"
                  : "Asesor"}
            </Text>
          )}
        </Card>
      ))}
    </>
  );
}
