import React, { useState } from "react";
import { router } from "expo-router";
import { Screen } from "../src/components/Screen";
import {
  AppBar,
  Banner,
  Button,
  Card,
  NavRow,
  PageScroll,
  Section,
  SegmentedControl,
  Switch,
  Text,
} from "../src/components/ui";
import { useTheme } from "../src/theme/ThemeProvider";
import { type ThemeMode } from "../src/theme/tokens";
import { useSession } from "../src/state/SessionProvider";
import { useLayers } from "../src/components/Layers";
import { roleLabels, roles } from "../src/domain/access";
import { DEMO_PASSWORD } from "../src/services/demo-auth";
export default function Demo() {
  const theme = useTheme();
  const auth = useSession();
  const { toast, close } = useLayers();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo completar la prueba.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <AppBar
        title="Controles de la demo"
        onBack={() => router.replace(auth.session ? "/(tabs)/more" : "/login")}
      />
      <PageScroll>
        <Banner>
          Entorno ficticio y sin APIs. Estos controles son exclusivos de la demo
          experimental.
        </Banner>
        {!!error && <Banner type="danger">{error}</Banner>}
        {!!theme.error && <Banner type="warning">{theme.error}</Banner>}
        <Section>Apariencia</Section>
        <SegmentedControl
          options={[
            { key: "light", label: "Claro" },
            { key: "dark", label: "Oscuro" },
            { key: "system", label: "Automático" },
          ]}
          value={theme.mode}
          onChange={(value) => void theme.setMode(value as ThemeMode)}
        />
        <Text kind="meta">
          Reducir movimiento: {theme.reducedMotion ? "activado" : "desactivado"}{" "}
          (sigue al sistema). Transiciones de navegación sin animación.
        </Text>
        <Section>Perfiles ficticios</Section>
        <Text kind="secondary">
          Credenciales de prueba: fer@ejemplo.mx, coordinador@ejemplo.mx o
          asesor@ejemplo.mx. Contraseña: {DEMO_PASSWORD}.
        </Text>
        {roles.map((role) => (
          <Button
            key={role}
            loading={busy}
            variant={auth.session?.role === role ? "primary" : "secondary"}
            onPress={() =>
              void run(async () => {
                close();
                await auth.signIn(
                  role === "owner"
                    ? "fer@ejemplo.mx"
                    : role === "coordinator"
                      ? "coordinador@ejemplo.mx"
                      : "asesor@ejemplo.mx",
                  DEMO_PASSWORD,
                );
                router.replace("/(tabs)/inbox");
              })
            }
          >{`Entrar como ${roleLabels[role]}`}</Button>
        ))}
        {auth.session && (
          <>
            <Section>Estados de acceso</Section>
            <Switch
              label="Estudio IA disponible en el plan"
              value={!auth.disabled.includes("studio")}
              onChange={(enabled) =>
                auth.setDisabled(enabled ? [] : ["studio"])
              }
            />
            <Button
              variant="tonal"
              onPress={() => router.push("/(tabs)/studio")}
            >
              Probar enlace a Estudio IA
            </Button>
            <Button
              variant="secondary"
              onPress={() =>
                void run(async () => {
                  await auth.expire();
                  router.replace("/login");
                })
              }
            >
              Simular sesión caducada
            </Button>
          </>
        )}
        <Section>Acceso por enlace</Section>
        {auth.session ? (
          <Text kind="secondary">
            Los enlaces de acceso se prueban sin sesión activa.
          </Text>
        ) : (
          <>
            <NavRow
              label="AUTH-03 · Activar cuenta ficticia"
              onPress={() => router.push("/activar/demo-activate")}
            />
            <NavRow
              label="AUTH-04 · Restablecer contraseña ficticia"
              onPress={() => router.push("/restablecer/demo-reset")}
            />
            <NavRow
              label="AUTH-04 · Enlace vencido"
              onPress={() => router.push("/restablecer/vencido")}
            />
            <NavRow
              label="AUTH-05 · Registro cerrado"
              onPress={() => router.push("/register")}
            />
          </>
        )}
        <Section>Sistema de diseño</Section>
        {["Colores", "Tipografía", "Controles", "Chat", "Estados", "Capas"].map(
          (name, index) => (
            <NavRow
              key={name}
              label={`DS-0${index + 1} · ${name}`}
              onPress={() => router.push(`/design/DS-0${index + 1}`)}
            />
          ),
        )}
        <Card>
          <Text weight="semibold">Alcance de esta entrega</Text>
          <Text kind="secondary">
            T-M1: acceso, tema, componentes y navegación. Las listas,
            conversaciones y módulos se incorporan a partir de T-M2.
          </Text>
        </Card>
        <Button
          variant="ghost"
          onPress={() =>
            void run(async () => {
              await auth.restore();
              toast("Sesión local revisada");
            })
          }
        >
          Comprobar recuperación de sesión
        </Button>
      </PageScroll>
    </Screen>
  );
}
