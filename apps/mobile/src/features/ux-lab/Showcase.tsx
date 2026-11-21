import React, { useState } from "react";
import {
  Pressable,
  TextInput,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import {
  ArrowLeft,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Paperclip,
  Send,
  CheckCheck,
  ChevronRight,
} from "lucide-react-native";
import { Text, Avatar } from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";
import { seedConversations } from "../inbox/model";
import { premium as p, premiumColors, dockReserve } from "./tokens";
import { PremiumSegments, PremiumDock, PremiumPill } from "./Components";
const people = seedConversations(12)
  .filter((c) => !c.archived)
  .slice(0, 4);
const areas = [
  { key: "clients", label: "Clientes" },
  { key: "team", label: "Equipo" },
  { key: "number", label: "Mi número" },
];
const crmTabs = [
  { key: "pipeline", label: "Pipeline" },
  { key: "contacts", label: "Contactos" },
  { key: "library", label: "Biblioteca" },
];
/** Isolated visual proposal. Uses shared fictitious seed and RN controls; no writes to app repositories. */
export function PremiumShowcase({
  screen,
  onScreen,
}: {
  screen: "inbox" | "chat" | "crm";
  onScreen: (screen: "inbox" | "chat" | "crm") => void;
}) {
  const { width } = useWindowDimensions(),
    { dark, fontFamily } = useTheme(),
    c = premiumColors(dark),
    [area, setArea] = useState("clients"),
    [section, setSection] = useState("pipeline"),
    [filter, setFilter] = useState("Todos"),
    [query, setQuery] = useState(""),
    [draft, setDraft] = useState("");
  const IconAction = ({
    icon: Icon,
    label,
    onPress,
  }: {
    icon: typeof Plus;
    label: string;
    onPress: () => void;
  }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        width: 48,
        height: 48,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon size={22} color={c.accent} strokeWidth={1.8} />
    </Pressable>
  );
  const rows = people.filter((person) =>
    person.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <View style={{ flex: 1, backgroundColor: c.base }}>
      {screen === "chat" ? (
        <>
          <View
            style={{
              height: 64,
              backgroundColor: c.surface,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingRight: 8,
              borderBottomWidth: 1,
              borderColor: c.line,
            }}
          >
            <IconAction
              icon={ArrowLeft}
              label="Volver a Bandeja"
              onPress={() => onScreen("inbox")}
            />
            <Avatar name={people[0]?.name ?? "Contacto demo"} />
            <View style={{ flex: 1 }}>
              <Text weight="semibold" numberOfLines={1}>
                {people[0]?.name}
              </Text>
              <Text kind="meta" style={{ color: c.secondary }}>
                Atención humana · En línea
              </Text>
            </View>
            <IconAction
              icon={MoreHorizontal}
              label="Acciones de muestra"
              onPress={() => {}}
            />
          </View>
          <ScrollView
            testID="premium-chat-scroll"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16, gap: 16, flexGrow: 1 }}
          >
            <Text
              kind="meta"
              style={{ alignSelf: "center", color: c.secondary }}
            >
              Hoy
            </Text>
            {[
              {
                kind: "in",
                text: "Hola, ¿me compartes las opciones disponibles?",
                time: "9:12",
              },
              {
                kind: "ai",
                text: "Claro. Te ayudo a encontrar la mejor opción para ti.",
                time: "9:12",
              },
              {
                kind: "out",
                text: "Buen día, soy Ana. Ya tengo tu cotización lista.",
                time: "9:13",
              },
            ].map((m, i) => (
              <View
                key={i}
                style={{
                  alignSelf: m.kind === "in" ? "flex-start" : "flex-end",
                  maxWidth: "86%",
                  borderRadius: 18,
                  borderTopLeftRadius: m.kind === "in" ? 6 : 18,
                  borderTopRightRadius: m.kind === "in" ? 18 : 6,
                  padding: 12,
                  gap: 6,
                  backgroundColor:
                    m.kind === "in"
                      ? c.surface
                      : m.kind === "ai"
                        ? dark
                          ? "#302b49"
                          : "#eeeafb"
                        : c.wash,
                  borderWidth: 1,
                  borderColor: m.kind === "in" ? c.line : "transparent",
                }}
              >
                {m.kind === "ai" && (
                  <Text
                    kind="capsule"
                    weight="semibold"
                    style={{ color: dark ? "#c5b6f1" : "#67529c" }}
                  >
                    ✧ IA · Respuesta asistida
                  </Text>
                )}
                <Text>{m.text}</Text>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "flex-end",
                    gap: 4,
                  }}
                >
                  <Text kind="meta" style={{ color: c.secondary }}>
                    {m.time}
                  </Text>
                  {m.kind !== "in" && <CheckCheck size={14} color={c.accent} />}
                </View>
              </View>
            ))}
            <View style={{ flex: 1 }} />
            <Text
              kind="meta"
              style={{ alignSelf: "center", color: c.secondary }}
            >
              Propuesta visual · Conversación ficticia
            </Text>
          </ScrollView>
          <View
            style={{
              backgroundColor: c.surface,
              borderTopWidth: 1,
              borderColor: c.line,
              padding: 12,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: "row", gap: 8 }}>
              <PremiumPill label="Responder" selected onPress={() => {}} />
              <PremiumPill label="Nota interna" onPress={() => {}} />
            </View>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              <IconAction
                icon={Paperclip}
                label="Adjunto de muestra"
                onPress={() => {}}
              />
              <View style={{ flex: 1 }}>
                <TextInput
                  accessibilityLabel="Mensaje de muestra"
                  placeholder="Escribe un mensaje…"
                  placeholderTextColor={c.secondary}
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                  style={{
                    minHeight: 48,
                    maxHeight: 112,
                    borderRadius: 24,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    color: c.text,
                    fontFamily: fontFamily(),
                    fontSize: 15,
                    backgroundColor: c.base,
                    borderWidth: 1,
                    borderColor: c.line,
                  }}
                />
              </View>
              <IconAction
                icon={Send}
                label="Vaciar borrador de muestra"
                onPress={() => setDraft("")}
              />
            </View>
          </View>
        </>
      ) : (
        <>
          <View
            style={{
              height: p.header,
              paddingLeft: p.gutter,
              paddingRight: 4,
              flexDirection: "row",
              alignItems: "center",
            }}
          >
            <Text
              accessibilityRole="header"
              weight="semibold"
              style={{
                fontSize: p.title,
                lineHeight: 32,
                flex: 1,
                color: c.text,
              }}
            >
              {screen === "inbox" ? "Bandeja" : "CRM"}
            </Text>
            <IconAction
              icon={Plus}
              label="Crear · muestra"
              onPress={() => {}}
            />
            <IconAction
              icon={MoreHorizontal}
              label="Más opciones · muestra"
              onPress={() => {}}
            />
          </View>
          <View style={{ paddingHorizontal: p.gutter }}>
            <PremiumSegments
              width={width - 2 * p.gutter}
              options={screen === "inbox" ? areas : crmTabs}
              value={screen === "inbox" ? area : section}
              onChange={screen === "inbox" ? setArea : setSection}
            />
            <View
              style={{
                height: 56,
                flexDirection: "row",
                alignItems: "center",
                gap: p.chipGap,
              }}
            >
              {(screen === "inbox"
                ? ["Todos", "No leídos", "Sin asignar"]
                : ["Todos", "Mi equipo", "Este mes"]
              ).map((label) => (
                <PremiumPill
                  key={label}
                  label={label}
                  selected={filter === label}
                  onPress={() => setFilter(label)}
                />
              ))}
            </View>
          </View>
          <ScrollView
            testID="premium-list"
            contentContainerStyle={{ paddingBottom: dockReserve(0), gap: 12 }}
          >
            <View
              style={{
                marginHorizontal: 16,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              <View
                style={{
                  flex: 1,
                  height: 48,
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: c.surface,
                  borderRadius: 16,
                  paddingHorizontal: 12,
                  borderWidth: 1,
                  borderColor: c.line,
                }}
              >
                <Search size={18} color={c.secondary} />
                <TextInput
                  accessibilityLabel="Buscar en propuesta"
                  value={query}
                  onChangeText={setQuery}
                  placeholder={
                    screen === "inbox" ? "Buscar conversación" : "Buscar en CRM"
                  }
                  placeholderTextColor={c.secondary}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 48,
                    paddingHorizontal: 10,
                    color: c.text,
                    fontFamily: fontFamily(),
                    fontSize: 14,
                  }}
                />
              </View>
              <IconAction
                icon={SlidersHorizontal}
                label="Filtros · muestra"
                onPress={() => {}}
              />
            </View>
            {screen === "inbox" ? (
              <View
                style={{
                  backgroundColor: c.surface,
                  marginHorizontal: 16,
                  borderRadius: p.cardRadius,
                  overflow: "hidden",
                  borderWidth: 1,
                  borderColor: c.line,
                }}
              >
                {rows.map((person, i) => (
                  <Pressable
                    key={person.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Abrir muestra ${person.name}`}
                    onPress={() => onScreen("chat")}
                    style={{
                      padding: 14,
                      gap: 12,
                      flexDirection: "row",
                      alignItems: "center",
                      borderBottomWidth: i === rows.length - 1 ? 0 : 1,
                      borderColor: c.line,
                    }}
                  >
                    <Avatar
                      name={
                        area === "team"
                          ? ([
                              "Ana López",
                              "Luis Ortega",
                              "Equipo de ventas",
                              "Avisos",
                            ][i] ?? person.name)
                          : person.name
                      }
                    />
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text
                        weight="semibold"
                        numberOfLines={1}
                        style={{ fontSize: 15.5 }}
                      >
                        {area === "team"
                          ? [
                              "Ana López",
                              "Luis Ortega",
                              "Equipo de ventas",
                              "Avisos",
                            ][i]
                          : person.name}
                      </Text>
                      <Text
                        kind="secondary"
                        numberOfLines={1}
                        style={{ color: c.secondary, fontSize: 13.5 }}
                      >
                        {area === "team"
                          ? "Mensaje interno ficticio"
                          : area === "number"
                            ? "Conversación personal ficticia"
                            : "¿Me compartes más información?"}
                      </Text>
                    </View>
                    <Text kind="meta" style={{ color: c.secondary }}>
                      9:13
                    </Text>
                  </Pressable>
                ))}
                {!rows.length && (
                  <Text style={{ padding: 20 }}>Sin resultados</Text>
                )}
              </View>
            ) : (
              <>
                {(section === "pipeline"
                  ? ["Nuevo", "En conversación", "Interesados"]
                  : section === "contacts"
                    ? ["Contactos recientes"]
                    : ["Biblioteca del equipo"]
                ).map((stage, i) => (
                  <View
                    key={stage}
                    style={{
                      marginHorizontal: 16,
                      padding: 16,
                      gap: 12,
                      borderRadius: p.cardRadius,
                      backgroundColor: c.surface,
                      borderWidth: 1,
                      borderColor: c.line,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: ["#94a3b8", c.accent, "#bd8a43"][i],
                        }}
                      />
                      <Text weight="semibold" style={{ flex: 1 }}>
                        {stage}
                      </Text>
                      <Text kind="meta" style={{ color: c.secondary }}>
                        {i + 2}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Abrir ficha de muestra ${stage}`}
                      onPress={() => onScreen("chat")}
                      style={{ gap: 8 }}
                    >
                      <Text weight="semibold">
                        {section === "library"
                          ? "Catálogo de temporada"
                          : (people[i]?.name ?? "Contacto demo")}
                      </Text>
                      <Text kind="secondary" style={{ color: c.secondary }}>
                        {section === "library"
                          ? "Documento ficticio · Disponible sin conexión"
                          : "Cotización en seguimiento · Ana López"}
                      </Text>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <PremiumPill
                          label={section === "library" ? "PDF" : "Seguimiento"}
                          selected
                          onPress={() => {}}
                        />
                        <View style={{ flex: 1 }} />
                        {section === "pipeline" && (
                          <Text weight="semibold">
                            {["$2,400", "$1,800", "$3,200"][i]}
                          </Text>
                        )}
                        <ChevronRight size={18} color={c.secondary} />
                      </View>
                    </Pressable>
                  </View>
                ))}
              </>
            )}
          </ScrollView>
          <PremiumDock
            value={screen}
            onChange={(key) => {
              if (key === "crm" || key === "inbox") onScreen(key);
            }}
          />
        </>
      )}
    </View>
  );
}
