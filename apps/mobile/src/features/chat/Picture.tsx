import { Image as ImageIcon } from "lucide-react-native";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Rect } from "react-native-svg";
export function SamplePicture({ height = 150 }: { height?: number }) {
  return (
    <View
      accessibilityLabel="Imagen ficticia de muestra"
      style={{
        height,
        width: "100%",
        borderRadius: 10,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg width="100%" height="100%" style={{ position: "absolute" }}>
        <Defs>
          <LinearGradient id="sample" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#bfe3e4" />
            <Stop offset="0.55" stopColor="#7cc0c3" />
            <Stop offset="1" stopColor="#4a9ea3" />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#sample)" />
      </Svg>
      <ImageIcon size={34} color="#fff" strokeWidth={1.8} />
    </View>
  );
}
