import React, { useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { MoreVertical, Plus } from "lucide-react-native";
import { Screen } from "../../src/components/Screen";
import {
  AppBar,
  Banner,
  Button,
  Card,
  Choice,
  Composer,
  EmptyState,
  ErrorState,
  Field,
  FilterChips,
  IconButton,
  KpiCard,
  ListRow,
  MessageBubble,
  NavRow,
  PageScroll,
  PickerRow,
  SearchBox,
  Section,
  Skeleton,
  StageCapsule,
  Switch,
  TagCapsule,
  Text,
  TypingIndicator,
} from "../../src/components/ui";
import { useTheme } from "../../src/theme/ThemeProvider";
import { radii, spacing, typography } from "../../src/theme/tokens";
import { useLayers } from "../../src/components/Layers";
const titles: Record<string, string> = {
  "DS-01": "Colores",
  "DS-02": "Tipografía",
  "DS-03": "Controles",
  "DS-04": "Chat",
  "DS-05": "Estados",
  "DS-06": "Capas",
};
const tokenLabels: Record<string, string> = {
  base: "surface-base",
  sunken: "surface-sunken",
  text2: "text-2",
  text3: "text-3",
  accentInk: "accent-ink",
  wash: "accent-wash",
  tint: "accent-tint",
  brand: "brand-teal (solo logo)",
  bubbleIn: "bubble-in",
  bubbleTeam: "bubble-out",
  bubbleAi: "bubble-ai",
  bubbleConnected: "bubble-conn",
};
function ColorsGallery() {
  const { colors: c } = useTheme();
  const groups = {
    Superficies: ["base", "surface", "sunken"],
    Texto: ["text", "text2", "text3"],
    "Acento (white-label)": ["accent", "accentInk", "wash", "tint", "brand"],
    Estado: ["success", "warning", "danger", "info"],
    Chat: ["bubbleIn", "bubbleTeam", "bubbleAi", "bubbleConnected"],
  } as const;
  return (
    <>
      {Object.entries(groups).map(([group, keys]) => (
        <View key={group}>
          <Section>{group}</Section>
          {keys.map((key) => (
            <View
              key={key}
              style={{
                flexDirection: "row",
                gap: 12,
                alignItems: "center",
                paddingVertical: 6,
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  backgroundColor: c[key],
                  borderColor: c.borderStrong,
                  borderWidth: 1,
                }}
              />
              <View>
                <Text weight="medium" kind="secondary">
                  {tokenLabels[key] ?? key}
                </Text>
                <Text kind="meta" style={{ color: c.text3 }}>
                  {c[key]}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ))}
    </>
  );
}
function TypographyGallery() {
  const { colors: c } = useTheme();
  const labels = {
    module: "Título de módulo",
    title: "Título de pantalla",
    name: "Nombre en lista",
    body: "Cuerpo / chat",
    secondary: "Secundario",
    capsule: "Etiqueta / cápsula",
    meta: "Meta (hora, ticks)",
  };
  return (
    <>
      {(Object.keys(typography) as (keyof typeof typography)[]).map((key) => (
        <View
          key={key}
          style={{
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderColor: c.border,
          }}
        >
          <Text
            kind={key}
            weight={
              key === "module" || key === "title"
                ? "semibold"
                : key === "name" || key === "capsule"
                  ? "medium"
                  : "regular"
            }
            style={key === "module" ? { color: c.accentInk } : undefined}
          >
            {labels[key]} — Dashfort 123
          </Text>
          <Text kind="meta" style={{ color: c.text3 }}>
            {typography[key].join("/")} · Inter
          </Text>
        </View>
      ))}
      <Section>Espaciado (4 pt)</Section>
      <View
        style={{
          flexDirection: "row",
          gap: 12,
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
        {spacing.map((size) => (
          <View key={size} style={{ alignItems: "center", gap: 6 }}>
            <View
              style={{
                width: size,
                height: size,
                borderRadius: 4,
                backgroundColor: c.accent,
              }}
            />
            <Text kind="meta">{size}</Text>
          </View>
        ))}
      </View>
      <Section>Radios</Section>
      <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
        {Object.entries(radii).map(([key, radius]) => (
          <View key={key} style={{ alignItems: "center", gap: 6 }}>
            <View
              style={{
                width: 56,
                height: 44,
                borderWidth: 2,
                borderColor: c.accent,
                backgroundColor: c.wash,
                borderRadius: radius,
              }}
            />
            <Text kind="meta">{key}</Text>
          </View>
        ))}
      </View>
      <Section>Áreas táctiles</Section>
      <Text kind="secondary">
        Mínimo 44 × 44 pt (iOS) / 48 dp (Android). Texto del sistema sin límite
        artificial de escala.
      </Text>
    </>
  );
}
function ControlsGallery() {
  const { toast, open, close } = useLayers();
  const [normal, setNormal] = useState("Texto");
  const [phone, setPhone] = useState("55 12");
  const [active, setActive] = useState(true);
  const [checked, setChecked] = useState(true);
  const [radio, setRadio] = useState(true);
  const [chip, setChip] = useState("Todos");
  const [query, setQuery] = useState("");
  const [value, setValue] = useState("Valor elegido");
  return (
    <>
      <Button onPress={() => toast("Botón principal")}>Principal</Button>
      <Button variant="secondary" onPress={() => toast("Botón secundario")}>
        Secundario
      </Button>
      <Button variant="tonal" icon={Plus} onPress={() => toast("Botón tonal")}>
        Tonal con ícono
      </Button>
      <Button
        variant="danger"
        onPress={() => toast("Botón de peligro · Sin acción destructiva")}
      >
        Peligro
      </Button>
      <Button disabled>Deshabilitado</Button>
      <Button variant="ghost" onPress={() => toast("Botón de solo texto")}>
        Solo texto
      </Button>
      <Section>Campos</Section>
      <Field
        label="Normal"
        value={normal}
        onChangeText={setNormal}
        hint="Texto de ayuda"
      />
      <Field
        label="Con error"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        error={
          phone.replace(/\D/g, "").length < 10
            ? "Escribe el número completo con lada."
            : ""
        }
      />
      <PickerRow
        label="Selector"
        value={value}
        onPress={() =>
          open({
            kind: "sheet",
            title: "Elige un valor",
            content: (
              <>
                {["Valor elegido", "Otra opción"].map((option) => (
                  <NavRow
                    key={option}
                    label={option}
                    onPress={() => {
                      setValue(option);
                      close();
                    }}
                  />
                ))}
              </>
            ),
          })
        }
      />
      <Section>Selección</Section>
      <Switch label="Interruptor" value={active} onChange={setActive} />
      <Choice
        radio
        label="Opción de radio"
        checked={radio}
        onPress={() => setRadio(!radio)}
      />
      <Choice
        label="Casilla"
        checked={checked}
        onPress={() => setChecked(!checked)}
      />
      <Section>Chips y cápsulas</Section>
      <FilterChips
        options={["Todos", "No leídos 3", "Míos"]}
        value={chip}
        onChange={setChip}
      />
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <StageCapsule>Interesado</StageCapsule>
        <StageCapsule>Cliente</StageCapsule>
        <TagCapsule>VIP</TagCapsule>
        <TagCapsule danger>Rechazada</TagCapsule>
      </View>
      <Section>Fila, búsqueda y tarjeta</Section>
      <SearchBox
        value={query}
        onChangeText={setQuery}
        placeholder="Buscar componente…"
      />
      {(!query ||
        "María González".toLowerCase().includes(query.toLowerCase())) && (
        <ListRow
          name="María González"
          preview="Me interesa el anillo"
          time="9:12"
          unread={3}
          stage="Interesado"
          ai
          onPress={() => toast("Fila de demostración seleccionada")}
        />
      )}
      <KpiCard label="Conversaciones de prueba" value="128" />
    </>
  );
}
function ChatGallery() {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const { toast } = useLayers();
  return (
    <>
      <Text kind="meta" style={{ textAlign: "center" }}>
        Hoy · Galería de componentes
      </Text>
      <MessageBubble>Mensaje del cliente</MessageBubble>
      <MessageBubble variant="team">Mensaje del equipo</MessageBubble>
      <MessageBubble variant="ai">Respuesta del agente de IA</MessageBubble>
      <MessageBubble variant="connected">
        Enviado por una IA conectada
      </MessageBubble>
      <MessageBubble variant="system">
        — La IA pasó el chat a Ana López —
      </MessageBubble>
      <MessageBubble variant="note">Nunca se envía al cliente</MessageBubble>
      <MessageBubble attachment>Imagen con pie</MessageBubble>
      <MessageBubble
        variant="team"
        failed
        onRetry={() => toast("Ejemplo de fallo: requiere una plantilla")}
      >
        No entregado
      </MessageBubble>
      <TypingIndicator />
      {messages.map((text, i) => (
        <MessageBubble key={i} variant="team">
          {text}
        </MessageBubble>
      ))}
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={() => {
          if (draft.trim()) {
            setMessages((previous) => [...previous.slice(-19), draft.trim()]);
            setDraft("");
          }
        }}
      />
      <Text kind="meta">
        Prueba local del componente. El chat completo, la ventana de 24 h y los
        borradores persistentes corresponden a T-M3.
      </Text>
    </>
  );
}
function StatesGallery() {
  const [state, setState] = useState("Normal");
  const { toast } = useLayers();
  return (
    <>
      <FilterChips
        options={["Normal", "Cargando", "Vacío", "Error", "Sin conexión"]}
        value={state}
        onChange={setState}
      />
      {state === "Sin conexión" && (
        <Banner type="warning">
          Sin conexión. Los datos guardados siguen disponibles.
        </Banner>
      )}
      {state === "Cargando" ? (
        <Skeleton rows={4} />
      ) : state === "Vacío" ? (
        <EmptyState />
      ) : state === "Error" ? (
        <ErrorState
          onRetry={() => {
            setState("Normal");
            toast("Datos de prueba recuperados");
          }}
        />
      ) : (
        <>
          <Section>Cargando</Section>
          <Skeleton />
          <Section>Vacío</Section>
          <EmptyState />
          <Section>Error recuperable</Section>
          <ErrorState
            onRetry={() => toast("Reintento de demostración completado")}
          />
        </>
      )}
      <Section>Avisos</Section>
      <Banner>Información neutra.</Banner>
      <Banner type="success">Todo salió bien.</Banner>
      <Banner type="warning">Atención: algo requiere tu revisión.</Banner>
      <Banner type="danger">Algo falló y hay que corregirlo.</Banner>
    </>
  );
}
function LayersGallery() {
  const { open, close, toast } = useLayers();
  const [stage, setStage] = useState("Interesado");
  return (
    <>
      <Text kind="secondary">
        Toca cada ejemplo. Atrás y el botón de cierre cierran la capa superior.
      </Text>
      <Button
        variant="tonal"
        onPress={() =>
          open({
            kind: "sheet",
            title: "Adjuntar · Ejemplo",
            content: (
              <>
                {["Imagen", "Documento", "Cámara"].map((label) => (
                  <NavRow
                    key={label}
                    label={label}
                    onPress={() => {
                      close();
                      toast(`${label}: integración pendiente de T-M3`);
                    }}
                  />
                ))}
              </>
            ),
          })
        }
      >
        Hoja inferior (acciones)
      </Button>
      <Button
        variant="tonal"
        onPress={() =>
          open({
            kind: "menu",
            title: "Menú de ejemplo",
            content: (
              <>
                {["Filtros", "Archivados", "Seleccionar varios"].map(
                  (label) => (
                    <NavRow
                      key={label}
                      label={label}
                      onPress={() => {
                        close();
                        toast(`Seleccionaste ${label}`);
                      }}
                    />
                  ),
                )}
              </>
            ),
          })
        }
      >
        Menú ⋮
      </Button>
      <Button
        variant="tonal"
        onPress={() =>
          open({
            kind: "dialog",
            title: "¿Eliminar ejemplo?",
            content: (
              <>
                <Text>Esta acción solo confirma un ejemplo de la galería.</Text>
                <Button variant="secondary" onPress={close}>
                  Cancelar
                </Button>
                <Button
                  variant="danger"
                  onPress={() => {
                    close();
                    toast("Ejemplo eliminado");
                  }}
                >
                  Eliminar
                </Button>
              </>
            ),
          })
        }
      >
        Diálogo de confirmación
      </Button>
      <Button variant="tonal" onPress={() => toast("Aviso breve (toast), 3 s")}>
        Aviso breve
      </Button>
      <Button
        variant="tonal"
        onPress={() =>
          open({
            kind: "sheet",
            title: "Mover a…",
            content: (
              <>
                {["Interesado", "Cliente", "Perdido"].map((label) => (
                  <NavRow
                    key={label}
                    label={label}
                    onPress={() => {
                      setStage(label);
                      close();
                      toast("Etapa de ejemplo actualizada");
                    }}
                  />
                ))}
              </>
            ),
          })
        }
      >
        Hoja de selección
      </Button>
      <StageCapsule>{stage}</StageCapsule>
      <Card>
        <Text kind="secondary">
          La barra flotante se verifica entrando con cada uno de los tres
          perfiles desde los controles de la demo.
        </Text>
      </Card>
      <Button variant="ghost" onPress={() => router.push("/demo")}>
        Probar barra por rol
      </Button>
    </>
  );
}
export default function DesignScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors: c } = useTheme();
  const { open, close } = useLayers();
  const Gallery = {
    "DS-01": ColorsGallery,
    "DS-02": TypographyGallery,
    "DS-03": ControlsGallery,
    "DS-04": ChatGallery,
    "DS-05": StatesGallery,
    "DS-06": LayersGallery,
  }[id ?? ""];
  return (
    <Screen keyboard>
      <AppBar
        title={titles[id ?? ""] ?? "Sistema de diseño"}
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace("/demo")
        }
        actions={
          <IconButton
            icon={MoreVertical}
            label="Galerías del sistema de diseño"
            onPress={() =>
              open({
                kind: "menu",
                title: "Sistema de diseño",
                content: (
                  <>
                    {Object.entries(titles).map(([key, label]) => (
                      <NavRow
                        key={key}
                        label={`${key} · ${label}`}
                        onPress={() => {
                          close();
                          router.replace(`/design/${key}`);
                        }}
                      />
                    ))}
                  </>
                ),
              })
            }
          />
        }
      />
      <PageScroll
        style={id === "DS-04" ? { backgroundColor: c.sunken } : undefined}
      >
        {Gallery ? (
          <Gallery />
        ) : (
          <EmptyState
            title="Galería no disponible"
            message="Elige DS-01 a DS-06."
          />
        )}
      </PageScroll>
    </Screen>
  );
}
