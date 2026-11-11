import React, { memo } from "react";
import { Pressable, View } from "react-native";
import {
  Check,
  CheckCheck,
  Clock3,
  CircleAlert,
  FileText,
  MapPin,
  Contact,
  Play,
} from "lucide-react-native";
import { Button, Text } from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";
import { deliveryLabels, type Message } from "./model";
import { SamplePicture } from "./Picture";
export const ConversationBubble = memo(function ConversationBubble({
  message: m,
  day,
  onRetry,
  onMedia,
  onFull,
  onTemplate,
  locked,
}: {
  message: Message;
  day: string;
  onRetry: (id: string) => void;
  onMedia: (id: string) => void;
  onFull: (id: string) => void;
  onTemplate: () => void;
  locked: boolean;
}) {
  const { colors: c } = useTheme();
  const center = m.sender === "note" || m.sender === "system";
  const incoming = m.sender === "in";
  const bg =
    m.sender === "ai"
      ? c.bubbleAi
      : m.sender === "connected"
        ? c.bubbleConnected
        : m.sender === "team"
          ? c.bubbleTeam
          : m.sender === "note"
            ? c.wash
            : c.bubbleIn;
  const Icon =
    m.status === "pending"
      ? Clock3
      : m.status === "sent"
        ? Check
        : m.status === "failed"
          ? CircleAlert
          : CheckCheck;
  const sender =
    m.sender === "ai"
      ? "IA"
      : m.sender === "connected"
        ? "Joe · IA conectada"
        : m.sender === "note"
          ? "Nota interna"
          : m.sender === "in"
            ? "Cliente"
            : m.sender === "system"
              ? "Evento"
              : "Equipo";
  return (
    <View
      style={{
        paddingHorizontal: 12,
        paddingVertical: 3,
        alignItems: center ? "center" : incoming ? "flex-start" : "flex-end",
      }}
    >
      {!!day && (
        <View
          style={{
            alignSelf: "center",
            padding: 8,
            marginBottom: 6,
            borderRadius: 8,
            backgroundColor: c.surface,
          }}
        >
          <Text kind="meta" style={{ color: c.text2 }}>
            {day}
          </Text>
        </View>
      )}
      <View
        style={{
          maxWidth: center ? "96%" : "86%",
          backgroundColor: m.sender === "system" ? "transparent" : bg,
          padding: center ? 8 : 12,
          borderRadius: center ? 12 : 16,
          borderTopLeftRadius: incoming ? 4 : 16,
          borderTopRightRadius: !incoming && !center ? 4 : 16,
          gap: 5,
          borderWidth: incoming ? 1 : 0,
          borderColor: c.border,
        }}
      >
        {["ai", "connected", "note"].includes(m.sender) && (
          <Text
            kind="capsule"
            weight="semibold"
            style={{
              color:
                m.sender === "ai"
                  ? c.tagText
                  : m.sender === "connected"
                    ? c.info
                    : c.text2,
            }}
          >
            {m.sender === "note"
              ? "Nota interna · Solo tu equipo"
              : `✧ ${sender}`}
          </Text>
        )}
        {m.attachment && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              m.attachment.kind === "image"
                ? "Ver imagen de muestra"
                : `Ver adjunto ${m.attachment.name}`
            }
            onPress={() => onMedia(m.id)}
            style={{ minHeight: 48, minWidth: 160, maxWidth: 230 }}
          >
            {m.attachment.kind === "image" ? (
              <SamplePicture />
            ) : (
              <View
                style={{
                  padding: 16,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {m.attachment.kind === "video" ? (
                  <Play size={26} color={c.accentInk} />
                ) : m.attachment.kind === "location" ? (
                  <MapPin size={26} color={c.accentInk} />
                ) : m.attachment.kind === "contact" ? (
                  <Contact size={26} color={c.accentInk} />
                ) : (
                  <FileText size={26} color={c.accentInk} />
                )}
                <Text kind="secondary" style={{ flex: 1 }}>
                  {m.attachment.name}
                </Text>
              </View>
            )}
          </Pressable>
        )}
        <Text
          selectable
          kind={center ? "meta" : "body"}
          accessibilityLabel={`${sender}: ${m.text}${m.sender === "in" || center ? "" : `, ${deliveryLabels[m.status]}`}`}
        >
          {m.text.length > 1200 ? `${m.text.slice(0, 1200)}…` : m.text}
        </Text>
        {m.text.length > 1200 && (
          <Button variant="ghost" onPress={() => onFull(m.id)}>
            Ver mensaje completo
          </Button>
        )}
        {!center && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              justifyContent: "flex-end",
            }}
          >
            <Text kind="meta" style={{ color: c.text2 }}>
              {new Date(m.time).toLocaleTimeString("es-MX", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
            {!incoming && (
              <View
                accessibilityLabel={`Estado: ${deliveryLabels[m.status]}`}
                style={
                  m.status === "failed"
                    ? {
                        backgroundColor: c.surface,
                        borderRadius: 6,
                        padding: 2,
                      }
                    : undefined
                }
              >
                <Icon
                  size={15}
                  color={
                    m.status === "failed"
                      ? c.danger
                      : m.status === "read"
                        ? c.info
                        : c.text2
                  }
                />
              </View>
            )}
          </View>
        )}
        {m.status === "failed" && (
          <View
            style={{
              backgroundColor: c.surface,
              borderRadius: 8,
              padding: 8,
              gap: 4,
            }}
          >
            <Text kind="meta" style={{ color: c.danger }}>
              No entregado · {m.failure}
            </Text>
            {locked && !m.templateId ? (
              <Button variant="ghost" onPress={onTemplate}>
                Enviar plantilla
              </Button>
            ) : (
              <Button variant="ghost" onPress={() => onRetry(m.id)}>
                Reintentar mensaje
              </Button>
            )}
          </View>
        )}
      </View>
    </View>
  );
});
