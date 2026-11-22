import { useCallback, useState } from "react";
import { SegmentedControl } from "../components/ModuleUi";
import { Button, Card, Text } from "../components/ui";
import type { ReportRange } from "../integration/remote-workspace";
import { Metrics, ReportPeriodFields } from "./RemoteResults";
import {
  RemoteFeedback,
  type RemotePageProps,
  useRemoteData,
} from "./RemoteWorkspaceUi";

const tabs = [
  { key: "list", label: "Campañas" },
  { key: "metrics", label: "Métricas" },
];
export function RemoteCampaigns(props: RemotePageProps) {
  const [tab, setTab] = useState("list");
  return (
    <>
      <SegmentedControl
        fixedGeometry
        value={tab}
        options={tabs}
        onChange={setTab}
      />
      {tab === "list" ? (
        <CampaignList {...props} />
      ) : (
        <CampaignMetrics {...props} />
      )}
    </>
  );
}
function CampaignList({ repository, expired }: RemotePageProps) {
  const load = useCallback(() => repository.campaigns(), [repository]);
  const result = useRemoteData(load, expired);
  const [selected, select] = useState<string>();
  return (
    <>
      <RemoteFeedback {...result} />
      <Button disabled variant="secondary">
        Crear campaña · Disponible en la versión web
      </Button>
      <Button disabled variant="secondary">
        Enviar campaña · Disponible en la versión web
      </Button>
      {result.data?.length === 0 && <Text>Sin campañas.</Text>}
      {result.data?.map((campaign) => (
        <Card key={campaign.id} style={{ gap: 6 }}>
          <Text weight="semibold">{campaign.name}</Text>
          <Text kind="secondary">{campaign.state}</Text>
          {selected === campaign.id && <Metrics values={campaign.values} />}
          <Button
            variant="ghost"
            onPress={() =>
              select(selected === campaign.id ? undefined : campaign.id)
            }
          >
            {selected === campaign.id ? "Ocultar métricas" : "Ver métricas"}
          </Button>
        </Card>
      ))}
      <Button
        variant="ghost"
        disabled={result.pending}
        onPress={() => void result.refresh()}
      >
        Actualizar campañas
      </Button>
    </>
  );
}
function CampaignMetrics({ repository, expired }: RemotePageProps) {
  const [range, setRange] = useState<ReportRange>();
  const [custom, setCustom] = useState(false);
  const load = useCallback(
    () => repository.campaignMetrics(range),
    [repository, range],
  );
  const result = useRemoteData(load, expired);
  return (
    <>
      <Button variant="ghost" onPress={() => setCustom(!custom)}>
        {custom ? "Ocultar rango" : "Cambiar rango"}
      </Button>
      {custom && <ReportPeriodFields apply={setRange} />}
      <RemoteFeedback {...result} />
      {!!result.data?.period && <Text kind="meta">{result.data.period}</Text>}
      {!!result.data && (
        <Card style={{ gap: 6 }}>
          <Text weight="semibold">Totales del periodo</Text>
          <Metrics values={result.data.totals} />
        </Card>
      )}
      {result.data?.campaigns.map((campaign) => (
        <Card key={campaign.id} style={{ gap: 6 }}>
          <Text weight="semibold">{campaign.name}</Text>
          <Metrics values={campaign.values} />
        </Card>
      ))}
    </>
  );
}
