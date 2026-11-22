import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { Banner, Button, Card, PickerRow, Text } from "../components/ui";
import type { pipelineResponse } from "../integration/remote-workspace";
import { requiresRemoteLogin } from "../integration/remote-http";
import {
  errorText,
  RemoteFeedback,
  type RemotePageProps,
  useRemoteData,
} from "./RemoteWorkspaceUi";

type Lead = ReturnType<typeof pipelineResponse>["leads"][number];
export function RemotePipeline({
  repository,
  expired,
  openChat,
}: RemotePageProps & { openChat: (id: string) => Promise<void> }) {
  const load = useCallback(() => repository.pipeline(), [repository]);
  const board = useRemoteData(load, expired);
  const [index, setIndex] = useState(0);
  const [extra, setExtra] = useState<Lead[]>([]);
  const [offset, setOffset] = useState(50);
  const [record, select] = useState<Lead>();
  const [destination, choose] = useState<string>();
  const [reasons, setReasons] = useState<
    Awaited<ReturnType<typeof repository.lossReasons>>
  >([]);
  const [reason, chooseReason] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const stage = board.data?.stages[index];
  const dest = board.data?.stages.find(({ id }) => id === destination);
  const leads = [
    ...new Map(
      [...(board.data?.leads ?? []), ...extra]
        .filter((lead) => lead.stageId === stage?.id)
        .map((lead) => [lead.id, lead]),
    ).values(),
  ];
  const total = stage
    ? (board.data?.totals[stage.id] as { count?: number } | undefined)
    : undefined;

  async function act(operation: () => Promise<unknown>, reconcile = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (problem) {
      if (requiresRemoteLogin(problem)) expired(problem);
      else {
        setError(errorText(problem));
        if (reconcile) {
          select(undefined);
          choose(undefined);
          chooseReason(undefined);
          setExtra([]);
          setOffset(50);
          await board.refresh();
        }
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function changeStage(next: number) {
    setIndex(next);
    setExtra([]);
    setOffset(50);
    select(undefined);
  }

  return (
    <>
      <RemoteFeedback {...board} />
      {!!error && <Banner type="warning">{error}</Banner>}
      {record ? (
        <Card style={{ gap: 8 }}>
          <Button
            variant="ghost"
            disabled={busy}
            onPress={() => {
              select(undefined);
              choose(undefined);
              chooseReason(undefined);
            }}
          >
            Volver al Pipeline
          </Button>
          <Text kind="title">{record.name}</Text>
          <Text>{record.phone ?? "Sin teléfono registrado"}</Text>
          <Text>
            {stage?.name}
            {record.amount !== null
              ? ` · ${record.amount.toLocaleString("es-MX")} ${record.currency ?? board.data?.currency ?? ""}`
              : ""}
          </Text>
          {typeof record.assignee === "string" && (
            <Text>Responsable: {record.assignee}</Text>
          )}
          {!!record.tags.length && <Text>{record.tags.join(" · ")}</Text>}
          {record.conversationId && (
            <Button
              variant="secondary"
              disabled={busy}
              onPress={() => void act(() => openChat(record.conversationId!))}
            >
              Abrir chat
            </Button>
          )}
          {repository.allowSend && (
            <>
              <Text weight="semibold">Mover a etapa</Text>
              {board.data?.stages
                .filter(({ id }) => id !== record.stageId)
                .map((next) => (
                  <PickerRow
                    key={next.id}
                    label={next.name}
                    value={destination === next.id ? "Seleccionada" : ""}
                    onPress={() =>
                      void act(async () => {
                        choose(next.id);
                        chooseReason(undefined);
                        setReasons([]);
                        if (next.kind === "lost")
                          setReasons(await repository.lossReasons());
                      })
                    }
                  />
                ))}
              {dest?.kind === "lost" && (
                <>
                  <Text>Motivo de pérdida</Text>
                  {reasons.map((item) => (
                    <PickerRow
                      key={item.key}
                      label={item.label}
                      value={reason === item.key ? "Seleccionado" : ""}
                      onPress={() => {
                        if (!lock.current) chooseReason(item.key);
                      }}
                    />
                  ))}
                </>
              )}
              <Button
                loading={busy}
                disabled={!dest || (dest.kind === "lost" && !reason)}
                onPress={() =>
                  void act(async () => {
                    if (!dest) return;
                    if (
                      !(await repository.moveLead(
                        record.id,
                        dest.id,
                        dest.kind === "lost" ? reason : undefined,
                      ))
                    )
                      return;
                    changeStage(
                      board.data?.stages.findIndex(
                        ({ id }) => id === dest.id,
                      ) ?? index,
                    );
                    choose(undefined);
                    chooseReason(undefined);
                    await board.refresh();
                  }, true)
                }
              >
                Confirmar cambio de etapa
              </Button>
            </>
          )}
        </Card>
      ) : (
        <>
          {stage && (
            <Card style={{ gap: 8 }}>
              <Text kind="title">{stage.name}</Text>
              <Text kind="secondary">
                {total?.count ?? 0} prospectos · Etapa {index + 1} de{" "}
                {board.data?.stages.length}
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                }}
              >
                <Button
                  variant="ghost"
                  disabled={!index || busy}
                  onPress={() => changeStage(index - 1)}
                >
                  Anterior
                </Button>
                <Button
                  variant="ghost"
                  disabled={
                    busy || index + 1 >= (board.data?.stages.length ?? 0)
                  }
                  onPress={() => changeStage(index + 1)}
                >
                  Siguiente
                </Button>
              </View>
              {leads.length === 0 && <Text>Sin prospectos en esta etapa.</Text>}
              {leads.map((lead) => (
                <PickerRow
                  key={lead.id}
                  label={lead.name}
                  value={lead.phone ?? ""}
                  onPress={() => select(lead)}
                />
              ))}
              {leads.length < (total?.count ?? 0) && (
                <Button
                  variant="secondary"
                  loading={busy}
                  onPress={() =>
                    void act(async () => {
                      const result = await repository.pipeline({
                        id: stage.id,
                        offset,
                      });
                      setExtra((old) => [...old, ...result.leads]);
                      setOffset(offset + result.leads.length);
                    })
                  }
                >
                  Cargar más prospectos
                </Button>
              )}
            </Card>
          )}
          {!!board.data && !stage && <Text>Sin etapas disponibles.</Text>}
          <Button
            variant="ghost"
            disabled={board.pending || busy}
            onPress={() => {
              setExtra([]);
              setOffset(50);
              void board.refresh();
            }}
          >
            Actualizar Pipeline
          </Button>
        </>
      )}
    </>
  );
}
