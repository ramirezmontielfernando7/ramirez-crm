import React, { useEffect, useRef } from "react";
import { Animated, View } from "react-native";
import { MessageCircle } from "lucide-react-native";
import { Screen } from "../../components/Screen";
import { Text } from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";
export function OpeningScreen() {
  const { colors: c, reducedMotion } = useTheme(),
    scale = useRef(new Animated.Value(reducedMotion ? 1 : 0.9)).current;
  useEffect(() => {
    if (reducedMotion) {
      scale.setValue(1);
      return;
    }
    const animation = Animated.timing(scale, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [reducedMotion, scale]);
  return (
    <Screen>
      <View
        accessibilityLabel="Dashfort by Demfort"
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
        }}
      >
        <Animated.View
          accessible={false}
          style={{
            width: 84,
            height: 84,
            borderRadius: 24,
            backgroundColor: c.brand,
            alignItems: "center",
            justifyContent: "center",
            transform: [{ scale }],
          }}
        >
          <MessageCircle size={46} color="#ffffff" strokeWidth={1.8} />
        </Animated.View>
        <Text
          weight="semibold"
          style={{
            fontSize: 26,
            lineHeight: 32,
            letterSpacing: -0.3,
            color: c.accentInk,
          }}
        >
          Dashfort
        </Text>
        <Text kind="meta" style={{ fontSize: 12.5 }}>
          by Demfort
        </Text>
      </View>
    </Screen>
  );
}
