import React, { useRef, useState } from "react";
import { router } from "expo-router";
import { Image, Pressable, View } from "react-native";
import { ArrowUp, ArrowDown, Image as ImageIcon } from "lucide-react-native";
import { Screen } from "../../components/Screen";
import {
  Banner,
  Button,
  Choice,
  Field,
  NavRow,
  PageScroll,
  Section,
  Switch,
  Text,
} from "../../components/ui";
import { FilterChips, IconButton } from "../../components/ModuleUi";
import { StudioBar } from "../studio/StudioBar";
import { usePersonalization } from "./state";
import { accents, fonts, resolveAppearance, type Font } from "./core";
import {
  roles,
  roleLabels,
  visibleModules,
  type Module,
  type Role,
} from "../../domain/access";
import { useLayers } from "../../components/Layers";
import { useTheme } from "../../theme/ThemeProvider";
export function useLocalAction() {
  const lock = useRef(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return {
    busy,
    error,
    run: async (fn: () => Promise<unknown>) => {
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
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
        lock.current = false;
        setBusy(false);
      }
    },
  };
}
const fontLabels: Record<Font, string> = {
  Inter: "Inter (predeterminada)",
  Geist: "Geist",
  DMSans: "DM Sans",
  PlusJakarta: "Plus Jakarta",
};
export function AppearanceScreen() {
  const { store, state } = usePersonalization(),
    a = useLocalAction(),
    p = resolveAppearance(state.brand, state.personal);
  return (
    <Screen>
      <StudioBar title="Apariencia" onBack={() => router.back()} />
      <PageScroll>
        {!!a.error && <Banner type="danger">{a.error}</Banner>}
        <Section>Tema</Section>
        {(["light", "dark"] as const).map((theme, i) => (
          <Choice
            key={theme}
            radio
            label={i === 0 ? "Claro" : "Oscuro"}
            checked={p.theme === theme}
            onPress={() => void a.run(() => store.personal({ theme }))}
          />
        ))}
        <Section>Letra</Section>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {fonts.map((font) => (
            <Pressable
              key={font}
              accessibilityRole="radio"
              accessibilityLabel={fontLabels[font]}
              accessibilityState={{ checked: p.font === font }}
              onPress={() => void a.run(() => store.personal({ font }))}
              style={{ minHeight: 48, justifyContent: "center" }}
            >
              <FontChip selected={p.font === font} label={fontLabels[font]} />
            </Pressable>
          ))}
        </View>
        <Section>Estilo del chat</Section>
        {(["classic", "whatsapp"] as const).map((chat, i) => (
          <Choice
            key={chat}
            radio
            label={i === 0 ? "Clásico" : "Estilo WhatsApp"}
            checked={p.chat === chat}
            onPress={() => void a.run(() => store.personal({ chat }))}
          />
        ))}
        <Text kind="meta">
          Tu preferencia personal tiene prioridad sobre la organización.
        </Text>
        <Button
          variant="ghost"
          disabled={a.busy}
          onPress={() =>
            void a.run(() =>
              store.personal({ theme: null, font: null, chat: null }),
            )
          }
        >
          Usar preferencias de la organización
        </Button>
      </PageScroll>
    </Screen>
  );
}
function FontChip({ selected, label }: { selected: boolean; label: string }) {
  const { colors: c } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: selected ? c.wash : c.surface,
      }}
    >
      <Text
        kind="capsule"
        weight="medium"
        style={{ color: selected ? c.accentInk : c.text2 }}
      >
        {label}
      </Text>
    </View>
  );
}
export function BrandMark({ size = 40 }: { size?: number }) {
  const { colors: c, brandAsset } = useTheme();
  return brandAsset === "original" ? (
    <Image
      accessibilityLabel="Ícono Dashfort"
      source={require("../../../assets/icon.png")}
      style={{ width: size, height: size, borderRadius: 12 }}
    />
  ) : (
    <View
      accessibilityLabel="Marca de muestra local"
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        backgroundColor: c.accent,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        weight="semibold"
        style={{ color: c.onAccent, fontSize: size * 0.5 }}
      >
        D
      </Text>
    </View>
  );
}
function AssetDialog({
  apply,
}: {
  apply: (asset: "original" | "sample") => Promise<void>;
}) {
  const a = useLocalAction(),
    l = useLayers();
  return (
    <>
      <Text>
        Elige una imagen de muestra. No se abrirán archivos ni se subirán
        imágenes. El ícono del sistema requiere una compilación futura.
      </Text>
      {!!a.error && <Banner type="danger">{a.error}</Banner>}
      {(["original", "sample"] as const).map((asset, i) => (
        <Button
          key={asset}
          disabled={a.busy}
          onPress={() =>
            void a.run(async () => {
              await apply(asset);
              l.close();
            })
          }
        >
          {i === 0 ? "Restaurar logo original" : "Usar marca de muestra"}
        </Button>
      ))}
    </>
  );
}
export function BrandScreen() {
  const { store, state } = usePersonalization(),
    b = state.brand,
    a = useLocalAction(),
    l = useLayers(),
    [name, setName] = useState(b.name),
    [accent, setAccent] = useState(b.accent),
    owner = store.team.actor(store.actor).role === "owner";
  return (
    <Screen>
      <StudioBar title="Marca" onBack={() => router.back()} />
      <PageScroll>
        {!owner ? (
          <Banner>
            Solo el propietario administra la marca de su organización ficticia.
          </Banner>
        ) : (
          <>
            {!!a.error && <Banner type="danger">{a.error}</Banner>}
            <Field
              label="Nombre del CRM"
              value={name}
              onChangeText={setName}
              maxLength={40}
            />
            <Section>Color de acento</Section>
            <View style={{ flexDirection: "row", gap: 12 }}>
              {accents.map((color) => (
                <Pressable
                  key={color}
                  accessibilityRole="radio"
                  accessibilityLabel={`Acento ${color}`}
                  accessibilityState={{ checked: color === accent }}
                  onPress={() => setAccent(color)}
                  style={{
                    width: 48,
                    height: 48,
                    backgroundColor: color,
                    borderRadius: 24,
                    borderWidth: color === accent ? 3 : 0,
                    borderColor: "#929299",
                  }}
                />
              ))}
            </View>
            <NavRow
              icon={ImageIcon}
              label="Logo e ícono"
              onPress={() =>
                l.open({
                  kind: "sheet",
                  title: "Logo e ícono",
                  content: (
                    <AssetDialog apply={(asset) => store.brand({ asset })} />
                  ),
                })
              }
            />
            <BrandMark />
            <Button
              loading={a.busy}
              onPress={() => void a.run(() => store.brand({ name, accent }))}
            >
              Guardar marca
            </Button>
            <Text kind="meta">
              Simulación local por organización. No cambia el ícono de la APK
              instalada.
            </Text>
          </>
        )}
      </PageScroll>
    </Screen>
  );
}
export const moduleLabels: Record<Module, string> = {
  inbox: "Bandeja",
  crm: "CRM",
  studio: "Estudio IA",
  marketing: "Marketing",
  more: "Más",
};
function OrderSheet({ role }: { role: Role }) {
  const { store, state } = usePersonalization(),
    a = useLocalAction(),
    list = state.brand.menus[role];
  const move = (m: Module, d: number) => {
    const n = [...list],
      i = n.indexOf(m),
      j = i + d;
    if (i < 0 || j < 0 || j >= n.length - 1) return;
    [n[i], n[j]] = [n[j]!, n[i]!];
    void a.run(() => store.menu(role, n));
  };
  return (
    <>
      {!!a.error && <Banner type="danger">{a.error}</Banner>}
      {list
        .filter((m) => m !== "more")
        .map((m) => (
          <View key={m} style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ flex: 1 }}>{moduleLabels[m]}</Text>
            <IconButton
              icon={ArrowUp}
              label={`Subir ${moduleLabels[m]}`}
              disabled={a.busy || list.indexOf(m) === 0}
              onPress={() => move(m, -1)}
            />
            <IconButton
              icon={ArrowDown}
              label={`Bajar ${moduleLabels[m]}`}
              disabled={a.busy || list.indexOf(m) === list.length - 2}
              onPress={() => move(m, 1)}
            />
          </View>
        ))}
      <Text kind="meta">Más permanece al final.</Text>
    </>
  );
}
export function NavigationScreen() {
  const { store, state } = usePersonalization(),
    a = useLocalAction(),
    layers = useLayers(),
    [role, setRole] = useState<Role>("owner"),
    owner = store.team.actor(store.actor).role === "owner",
    list = state.brand.menus[role];
  const change = (modules: readonly Module[]) =>
    void a.run(() => store.menu(role, modules));
  return (
    <Screen>
      <StudioBar title="Navegación" onBack={() => router.back()} />
      <PageScroll>
        {!owner ? (
          <Banner>Solo el propietario configura el menú por rol.</Banner>
        ) : (
          <>
            {!!a.error && <Banner type="danger">{a.error}</Banner>}
            <Text kind="secondary">
              Elige qué va en la barra inferior (máx. 4) por rol.
            </Text>
            <FilterChips
              options={roles.map((r) => roleLabels[r])}
              value={roleLabels[role]}
              onChange={(v) => setRole(roles.find((r) => roleLabels[r] === v)!)}
            />
            {visibleModules(role)
              .filter((m) => m !== "more")
              .map((m) => (
                <Switch
                  key={m}
                  label={moduleLabels[m]}
                  value={list.includes(m)}
                  onChange={(v) =>
                    change(
                      v
                        ? [...list.filter((x) => x !== "more"), m, "more"]
                        : list.filter((x) => x !== m),
                    )
                  }
                />
              ))}
            <Text kind="secondary">Más · Siempre visible</Text>
            <NavRow
              icon={ArrowUp}
              label="Orden del menú"
              onPress={() =>
                layers.open({
                  kind: "sheet",
                  title: `Orden · ${roleLabels[role]}`,
                  content: <OrderSheet role={role} />,
                })
              }
            />
            <Button
              variant="secondary"
              disabled={a.busy}
              onPress={() => change(visibleModules(role))}
            >
              Restaurar menú del rol
            </Button>
            <Text kind="meta">
              Ocultar un acceso no concede ni revoca permisos.
            </Text>
          </>
        )}
      </PageScroll>
    </Screen>
  );
}
