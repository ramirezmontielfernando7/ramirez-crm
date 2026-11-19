import React from "react";
import { View, TextInput, Pressable } from "react-native";
import { Send } from "lucide-react-native";
import { Text } from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";
export function StudioBubble({
  text,
  variant = "in",
  who,
  meta = "prueba",
}: {
  text: string;
  variant?: "in" | "ai" | "out";
  who?: string;
  meta?: string;
}) {
  const { colors: c } = useTheme();
  return (
    <View
      style={{
        alignSelf: variant === "in" ? "flex-start" : "flex-end",
        maxWidth: "88%",
        backgroundColor:
          variant === "ai"
            ? c.bubbleAi
            : variant === "out"
              ? c.bubbleTeam
              : c.bubbleIn,
        borderWidth: variant === "in" ? 1 : 0,
        borderColor: c.border,
        borderRadius: 16,
        padding: 12,
        gap: 5,
      }}
    >
      {who && (
        <Text kind="meta" weight="medium">
          {who}
        </Text>
      )}
      <Text>{text}</Text>
      <Text kind="meta" style={{ color: c.text2, textAlign: "right" }}>
        {meta}
      </Text>
    </View>
  );
}
export function StudioComposer({
  value,
  onChange,
  onSend,
  label = "Mensaje de prueba",
  sendLabel = "Enviar mensaje de prueba",
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  label?: string;
  sendLabel?: string;
  disabled?: boolean;
}) {
  const { colors: c } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 8,
        alignItems: "flex-end",
        padding: 12,
      }}
    >
      <TextInput
        accessibilityLabel={label}
        placeholder={
          label === "Mensaje de prueba"
            ? "Escribe un mensaje de prueba…"
            : "Cuéntame de tu negocio o pide un ajuste…"
        }
        placeholderTextColor={c.text3}
        value={value}
        onChangeText={onChange}
        maxLength={2000}
        multiline
        editable={!disabled}
        onSubmitEditing={onSend}
        submitBehavior="submit"
        returnKeyType="send"
        style={{
          flex: 1,
          minHeight: 48,
          maxHeight: 120,
          borderWidth: 1,
          borderColor: c.borderStrong,
          borderRadius: 24,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontFamily: "Inter_400Regular",
          fontSize: 15,
          color: c.text,
          backgroundColor: c.surface,
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={sendLabel}
        disabled={disabled || !value.trim()}
        accessibilityState={{ disabled: disabled || !value.trim() }}
        onPress={onSend}
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: c.accent,
          opacity: disabled || !value.trim() ? 0.5 : 1,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Send size={22} color={c.onAccent} />
      </Pressable>
    </View>
  );
}
