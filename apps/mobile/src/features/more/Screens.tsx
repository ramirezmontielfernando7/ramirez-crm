import { useStudio } from "../studio/hooks";
import { demoPlans } from "../studio/usage-model";
import {
  MessageCircle,
  Users,
  Target,
  Wallet,
  Tag,
  Zap,
  X,
  MessageSquare,
  Shield,
  Plug,
  SlidersHorizontal,
  Palette,
  Building2,
  LayoutDashboard,
} from "lucide-react-native";
import React, { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import {
  CalendarDays,
  ListChecks,
  MessagesSquare,
  ChartColumn,
  Smartphone,
  ShieldCheck,
  Sparkles,
  Bell,
  Settings,
  Gauge,
  LogOut,
  Moon,
} from "lucide-react-native";
import { Screen } from "../../components/Screen";
import { AppBar } from "../../components/ModuleUi";
import {
  Avatar,
  Banner,
  Button,
  EmptyState,
  NavRow,
  PageScroll,
  SearchBox,
  Section,
  Text,
} from "../../components/ui";
import { StudioBar } from "../studio/StudioBar";
import { useSession } from "../../state/SessionProvider";
import { useTheme } from "../../theme/ThemeProvider";
import { roleLabels, visibleModules } from "../../domain/access";
import { settingsFor } from "./catalog";
import { useLayers } from "../../components/Layers";
import { NoticeSheet } from "../notices/NoticeScreens";
import { UsagePromptBridge } from "../usage/UsageScreens";
import { usePlatform } from "../platform/state";
import { usePersonalization } from "../personalization/state";
import {
  BrandMark,
  moduleLabels,
  useLocalAction,
} from "../personalization/Screens";
const settingIcons: Record<string, typeof Settings> = {
  "/channel-settings": MessageCircle,
  "/team": Users,
  "/ads-settings": Target,
  "/usage": Wallet,
  "/tags": Tag,
  "/quick-replies": Zap,
  "/loss-reasons": X,
  "/calendar-settings": CalendarDays,
  "/internal-settings": MessageSquare,
  "/optout": Shield,
  "/my-ai": Plug,
  "/ai-connector-settings": SlidersHorizontal,
  "/personal-settings": Smartphone,
  "/notification-settings": Bell,
  "/appearance": Palette,
  "/brand": Building2,
  "/navigation-settings": LayoutDashboard,
};
export function SettingsScreen() {
  const { session } = useSession(),
    [q, setQ] = useState("");
  if (!session) return null;
  const groups = settingsFor(session.role, q);
  return (
    <Screen>
      <StudioBar title="Ajustes" onBack={() => router.back()} />
      {session.role === "advisor" ? (
        <EmptyState
          title="Acceso no permitido"
          message="Tu perfil no administra los ajustes del equipo."
        />
      ) : (
        <>
          <View style={{ paddingHorizontal: 16 }}>
            <SearchBox
              accessibilityLabel="Buscar un ajuste"
              placeholder="Buscar un ajuste"
              value={q}
              onChangeText={setQ}
            />
          </View>
          <PageScroll>
            {groups.map((g) => (
              <View key={g.title}>
                <Section>{g.title}</Section>
                {g.items.map((i) => (
                  <NavRow
                    key={i.route}
                    icon={settingIcons[i.route]}
                    label={i.label}
                    hint={i.hint}
                    onPress={() => router.push(i.route as never)}
                  />
                ))}
              </View>
            ))}
            {!groups.length && (
              <EmptyState
                title="Sin resultados"
                message="Prueba con otra palabra: etiquetas, plantillas, equipo…"
              />
            )}
          </PageScroll>
        </>
      )}
    </Screen>
  );
}
function Logout() {
  const { signOut } = useSession(),
    l = useLayers(),
    a = useLocalAction();
  return (
    <>
      <Text>Tendrás que volver a entrar con tu correo y contraseña.</Text>
      {!!a.error && <Banner type="danger">{a.error}</Banner>}
      <Button variant="secondary" disabled={a.busy} onPress={l.close}>
        Cancelar
      </Button>
      <Button
        loading={a.busy}
        onPress={() =>
          void a.run(async () => {
            await signOut();
            l.close();
            router.replace("/login");
          })
        }
      >
        Cerrar sesión
      </Button>
    </>
  );
}
export function MoreScreen() {
  const studio = useStudio();
  const { session, disabled } = useSession(),
    t = useTheme(),
    l = useLayers(),
    { state: p } = usePlatform(false),
    { store } = usePersonalization(),
    a = useLocalAction();
  if (!session) return null;
  const displayName =
    store.team.snapshot().doc.members.find((m) => m.id === session.id)?.name ??
    session.name;
  const planName = studio.state.ready
    ? demoPlans.find((p) => p.id === studio.store.usageStats().data.plan)?.name
    : null;
  const role = session.role,
    menu = store.navigation(role, disabled),
    hidden = visibleModules(role, disabled).filter(
      (m) => m !== "more" && !menu.includes(m),
    );
  return (
    <Screen>
      <AppBar module title="Más" />
      <PageScroll style={{ paddingBottom: 112 }}>
        {role === "owner" && <UsagePromptBridge />}
        <View
          style={{
            flexDirection: "row",
            gap: 14,
            alignItems: "center",
            paddingBottom: 18,
          }}
        >
          <Avatar name={displayName} />
          <View>
            <Text kind="name" weight="semibold">
              {displayName}
            </Text>
            <Text kind="secondary">{`${roleLabels[role]}${role === "owner" && planName ? ` · Plan ${planName}` : ""}`}</Text>
          </View>
        </View>
        <Section>Trabajo</Section>
        {hidden.map((m) => (
          <NavRow
            key={m}
            label={moduleLabels[m]}
            onPress={() => router.push(`/(tabs)/${m}` as never)}
          />
        ))}
        <NavRow
          icon={CalendarDays}
          label="Agenda"
          onPress={() => router.push("/agenda")}
        />
        <NavRow
          icon={ListChecks}
          label="Tareas y notas"
          onPress={() => router.push("/work")}
        />
        <NavRow
          icon={MessagesSquare}
          label="Chat de equipo"
          onPress={() => router.push("/(tabs)/inbox?area=team")}
        />
        {role !== "advisor" && (
          <NavRow
            icon={ChartColumn}
            label="Resultados"
            onPress={() => router.push("/results")}
          />
        )}
        <NavRow
          icon={Smartphone}
          label="Mi número"
          onPress={() => router.push("/(tabs)/inbox?area=number")}
        />
        {p.allowed && (
          <NavRow
            icon={ShieldCheck}
            label="Plataforma"
            onPress={() => router.push("/platform-panel")}
          />
        )}{" "}
        {role === "owner" && (
          <>
            <Section>Asistente</Section>
            <NavRow
              icon={Sparkles}
              label="Preguntar al asistente"
              onPress={() => router.push("/assistant")}
            />
          </>
        )}
        <Section>Cuenta</Section>
        <NavRow
          icon={Bell}
          label="Avisos"
          onPress={() =>
            l.open({ kind: "sheet", title: "Avisos", content: <NoticeSheet /> })
          }
        />
        {role !== "advisor" && (
          <NavRow
            icon={Settings}
            label="Ajustes"
            onPress={() => router.push("/settings")}
          />
        )}{" "}
        {role === "owner" && (
          <NavRow
            icon={Gauge}
            label="Uso y plan"
            onPress={() => router.push("/usage")}
          />
        )}
        <NavRow
          icon={Moon}
          label="Tema oscuro"
          end={t.dark ? "Encendido" : "Apagado"}
          onPress={() => void a.run(() => t.setMode(t.dark ? "light" : "dark"))}
        />
        {!!a.error && <Banner type="danger">{a.error}</Banner>}
        <NavRow
          icon={LogOut}
          label="Cerrar sesión"
          onPress={() =>
            l.open({
              kind: "dialog",
              title: "¿Cerrar sesión?",
              content: <Logout />,
            })
          }
        />
        <View style={{ alignItems: "center", gap: 8, paddingVertical: 14 }}>
          {t.brandAsset === "sample" && <BrandMark size={32} />}
          <Text kind="meta">{`${t.brandName} by Demfort · versión 0.1.3 (demo)`}</Text>
        </View>
      </PageScroll>
    </Screen>
  );
}
