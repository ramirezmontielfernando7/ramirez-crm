import { useCallback, useState } from "react";
import { AppBar, SegmentedControl } from "../components/ModuleUi";
import { Screen } from "../components/Screen";
import {
  Banner,
  Button,
  Card,
  Field,
  PageScroll,
  Text,
} from "../components/ui";
import {
  validReportRange,
  type AnalyticsBlock,
  type DisplayMetric,
  type ReportRange,
} from "../integration/remote-workspace";
import {
  RemoteFeedback,
  type RemotePageProps,
  useRemoteData,
} from "./RemoteWorkspaceUi";

const sections: { key: AnalyticsBlock; label: string }[] = [
  { key: "sales", label: "Ventas" },
  { key: "bot", label: "IA" },
  { key: "ads", label: "Origen" },
  { key: "hygiene", label: "Seguimiento" },
  { key: "team", label: "Equipo" },
];
export function Metrics({ values }: { values: DisplayMetric[] }) {
  return values.map(({ label, value }) => (
    <Text key={label} kind="secondary">
      {label} · {value}
    </Text>
  ));
}

export function ReportPeriodFields({
  apply,
}: {
  apply: (range?: ReportRange) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");
  return (
    <Card style={{ gap: 8 }}>
      <Field
        label="Desde (AAAA-MM-DD)"
        value={from}
        onChangeText={setFrom}
        maxLength={10}
      />
      <Field
        label="Hasta (AAAA-MM-DD)"
        value={to}
        onChangeText={setTo}
        maxLength={10}
      />
      <Button
        variant="secondary"
        onPress={() => {
          const range = { from: from.trim(), to: to.trim() };
          if (!validReportRange(range)) {
            setError("Usa un rango válido de hasta 366 días.");
            return;
          }
          setError("");
          apply(range);
        }}
      >
        Aplicar fechas
      </Button>
      <Button
        variant="ghost"
        onPress={() => {
          setFrom("");
          setTo("");
          setError("");
          apply(undefined);
        }}
      >
        Periodo del CRM
      </Button>
      {!!error && <Banner type="warning">{error}</Banner>}
    </Card>
  );
}

export function RemoteResults({
  repository,
  expired,
  back,
}: RemotePageProps & { back: () => void }) {
  const [block, setBlock] = useState<AnalyticsBlock>("sales");
  const [range, setRange] = useState<ReportRange>();
  const [ranges, showRanges] = useState(false);
  return (
    <Screen>
      <AppBar title="Resultados" onBack={back} />
      <PageScroll>
        <SegmentedControl
          value={block}
          options={sections}
          onChange={(name) => setBlock(name as AnalyticsBlock)}
        />
        {block !== "hygiene" && (
          <Button variant="ghost" onPress={() => showRanges(!ranges)}>
            {ranges ? "Ocultar rango" : "Cambiar rango"}
          </Button>
        )}
        {block !== "hygiene" && ranges && (
          <ReportPeriodFields apply={setRange} />
        )}
        <Report
          key={block}
          repository={repository}
          expired={expired}
          block={block}
          range={range}
        />
      </PageScroll>
    </Screen>
  );
}

function Report({
  repository,
  expired,
  block,
  range,
}: RemotePageProps & { block: AnalyticsBlock; range?: ReportRange }) {
  const load = useCallback(
    () => repository.analytics(block, range),
    [repository, block, range],
  );
  const result = useRemoteData(load, expired);
  return (
    <>
      <RemoteFeedback {...result} />
      {!!result.data?.period && <Text kind="meta">{result.data.period}</Text>}
      {!!result.data?.empty && <Text>Sin actividad en el periodo.</Text>}
      {!!result.data && (
        <Card style={{ gap: 6 }}>
          <Metrics values={result.data.metrics} />
        </Card>
      )}
      {result.data?.groups.map(({ title, values }, index) => (
        <Card key={index} style={{ gap: 6 }}>
          <Text weight="semibold">{title}</Text>
          <Metrics values={values} />
        </Card>
      ))}
    </>
  );
}
