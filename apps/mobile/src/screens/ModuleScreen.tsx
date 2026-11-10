import React, { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { LogOut, FlaskConical, Palette } from "lucide-react-native";
import { Screen } from "../components/Screen";
import {
  AppBar,
  Avatar,
  Banner,
  Button,
  Card,
  EmptyState,
  NavRow,
  PageScroll,
  Text,
} from "../components/ui";
import { useSession } from "../state/SessionProvider";
import { useLayers } from "../components/Layers";
import { canAccess, roleLabels, type Module } from "../domain/access";
import { useTheme } from "../theme/ThemeProvider";
function LogoutDialog() {
  const { signOut } = useSession();
  const { close } = useLayers();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true);
    try {
      await signOut();
      close();
      router.replace("/login");
    } catch {
      setError("No se pudo cerrar la sesión local. Reintenta.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Text>Tendrás que volver a entrar con tu correo y contraseña.</Text>
      {!!error && <Banner type="danger">{error}</Banner>}
      <Button variant="secondary" disabled={busy} onPress={close}>
        Cancelar
      </Button>
      <Button loading={busy} onPress={() => void submit()}>
        Cerrar sesión
      </Button>
    </>
  );
}
export function ModuleScreen({
  module,
  title,
  task,
}: {
  module: Module;
  title: string;
  task: string;
}) {
  const { session, disabled } = useSession();
  const { open } = useLayers();
  const { colors: c } = useTheme();
  if (!session) return null;
  const roleAllowed = canAccess(session.role, module);
  const enabled = !disabled.includes(module);
  return (
    <Screen>
      <AppBar module title={title} />
      <PageScroll style={{ paddingBottom: 112 }}>
        {!roleAllowed || !enabled ? (
          <EmptyState
            title={
              roleAllowed ? "No disponible en tu plan" : "Acceso no permitido"
            }
            message={
              roleAllowed
                ? "Este módulo está desactivado en la organización de prueba."
                : "Tu perfil de prueba no tiene permiso para abrir este módulo."
            }
            action={
              <Button onPress={() => router.replace("/(tabs)/inbox")}>
                Ir a Bandeja
              </Button>
            }
          />
        ) : (
          <>
            <Banner>Demo aislada · Solo datos ficticios · T-M1</Banner>
            {module === "more" ? (
              <>
                <Card>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <Avatar name={session.name} />
                    <View>
                      <Text kind="name" weight="medium">
                        {session.name}
                      </Text>
                      <Text kind="secondary">
                        {roleLabels[session.role]} · Joyería Cristal
                      </Text>
                    </View>
                  </View>
                </Card>
                <NavRow
                  icon={FlaskConical}
                  label="Controles de la demo"
                  onPress={() => router.push("/demo")}
                />
                <NavRow
                  icon={Palette}
                  label="Sistema de diseño"
                  onPress={() => router.push("/design/DS-01")}
                />
                <NavRow
                  icon={LogOut}
                  label="Cerrar sesión"
                  onPress={() =>
                    open({
                      kind: "dialog",
                      title: "¿Cerrar sesión?",
                      content: <LogoutDialog />,
                    })
                  }
                />
              </>
            ) : (
              <>
                <EmptyState
                  title={
                    module === "inbox"
                      ? "Tu base móvil está lista"
                      : `${title} · Próxima etapa`
                  }
                  message={`La navegación y los permisos ya funcionan. El contenido de este módulo se implementará en ${task}.`}
                />
                <Button
                  variant="tonal"
                  onPress={() => router.push("/design/DS-03")}
                >
                  Explorar componentes
                </Button>
                <Button variant="ghost" onPress={() => router.push("/demo")}>
                  Probar temas, roles y estados
                </Button>
                <Card>
                  <Text weight="semibold">Sesión de demostración</Text>
                  <Text kind="secondary">
                    {roleLabels[session.role]} · Vence el{" "}
                    {new Date(session.expiresAt).toLocaleDateString("es-MX")}
                  </Text>
                  <Text kind="meta" style={{ color: c.text3 }}>
                    No hay conexión con Dashfort ni con WhatsApp.
                  </Text>
                </Card>
              </>
            )}
          </>
        )}
      </PageScroll>
    </Screen>
  );
}
