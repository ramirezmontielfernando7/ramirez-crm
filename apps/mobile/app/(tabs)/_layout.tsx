import { Tabs } from "expo-router";
import { TabBar } from "../../src/components/TabBar";
export const unstable_settings = { initialRouteName: "inbox" };
export default function TabsLayout() {
  return (
    <Tabs
      backBehavior="initialRoute"
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: "transparent" },
      }}
    >
      <Tabs.Screen name="inbox" />
      <Tabs.Screen name="crm" />
      <Tabs.Screen name="studio" />
      <Tabs.Screen name="marketing" />
      <Tabs.Screen name="more" />
    </Tabs>
  );
}
