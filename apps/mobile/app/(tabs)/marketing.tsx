import { useLocalSearchParams } from "expo-router";
import { TemplateList } from "../../src/features/templates/Screens";
import { ModuleScreen } from "../../src/screens/ModuleScreen";
export default function Page() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  if (section === "templates") return <TemplateList />;
  return <ModuleScreen module="marketing" title="Marketing" task="T-M11" />;
}
