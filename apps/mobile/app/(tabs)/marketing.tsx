import { useLocalSearchParams } from "expo-router";
import { TemplateList } from "../../src/features/templates/Screens";
import {
  Audiences,
  CampaignList,
  CampaignMetrics,
} from "../../src/features/marketing/Screens";
export default function Page() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  if (section === "templates") return <TemplateList />;
  if (section === "audiences") return <Audiences />;
  if (section === "metrics") return <CampaignMetrics />;
  return <CampaignList />;
}
