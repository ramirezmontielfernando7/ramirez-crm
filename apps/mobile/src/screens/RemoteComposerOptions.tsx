import React, { useEffect, useRef, useState } from "react";
import {
  Banner,
  Button,
  Card,
  Field,
  PageScroll,
  PickerRow,
  Text,
} from "../components/ui";
import { useLayers } from "../components/Layers";
import {
  canSendTemplates,
  reviewTemplate,
  TEMPLATE_VALUE_MAX,
} from "../integration/remote-composer";
import {
  RemoteHttpError,
  requiresRemoteLogin,
  type RemoteAuthRepository,
} from "../integration/remote-http";
import type { WireConversation } from "../integration/wire";

type Props = {
  repository: RemoteAuthRepository;
  expired: (error: RemoteHttpError) => void;
};

function displayError(reason: unknown) {
  return reason instanceof RemoteHttpError
    ? reason.message
    : "No se pudo completar la solicitud.";
}

function useCatalog<T>(get: () => Promise<T>, expired: Props["expired"]) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [revision, retry] = useState(0);
  useEffect(() => {
    let active = true;
    get().then(
      (result) => {
        if (active) setData(result);
      },
      (reason) => {
        if (!active) return;
        if (requiresRemoteLogin(reason)) expired(reason);
        else setError(displayError(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [revision, get, expired]);
  return {
    data,
    error,
    retry: () => {
      setError("");
      retry((old) => old + 1);
    },
  };
}

function CatalogState({ error, retry }: { error: string; retry: () => void }) {
  return error ? (
    <>
      <Banner type="warning">{error}</Banner>
      <Button onPress={retry}>Reintentar</Button>
    </>
  ) : (
    <Text accessibilityLiveRegion="polite">Cargando…</Text>
  );
}

export function RemoteQuickReplies({
  repository,
  expired,
  insert,
}: Props & { insert?: (text: string) => void }) {
  const { close } = useLayers();
  const load = React.useCallback(() => repository.quickReplies(), [repository]);
  const catalog = useCatalog(load, expired);
  return (
    <PageScroll>
      {!catalog.data && <CatalogState {...catalog} />}
      {catalog.data?.length === 0 && <Text>Sin respuestas rápidas.</Text>}
      {catalog.data?.map((reply) => (
        <Card key={reply.id} style={{ gap: 6 }}>
          <Text weight="semibold">/{reply.shortcut}</Text>
          <Text>{reply.body}</Text>
          {insert && (
            <Button
              variant="secondary"
              onPress={() => {
                insert(reply.body);
                close();
              }}
            >
              {`Insertar /${reply.shortcut}`}
            </Button>
          )}
        </Card>
      ))}
    </PageScroll>
  );
}

export function RemoteTemplates({
  repository,
  expired,
  chat,
  refresh,
}: Props & {
  chat: WireConversation;
  refresh: () => Promise<boolean>;
}) {
  const { close, toast } = useLayers();
  const load = React.useCallback(async () => {
    const [templates, lineAvailable] = await Promise.all([
      repository.templates(),
      repository.allowSend ? repository.templateLineAvailable(chat) : false,
    ]);
    return { templates, lineAvailable };
  }, [repository, chat]);
  const catalog = useCatalog(load, expired);
  const templates = catalog.data?.templates;
  const [id, select] = useState("");
  const [values, setValues] = useState<string[]>([]);
  const [confirming, confirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(() =>
    repository.templateIsUncertain(chat.id),
  );
  const lock = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const writable =
    repository.allowSend &&
    canSendTemplates(chat) &&
    catalog.data?.lineAvailable === true;
  const selected = templates?.find((item) => item.id === id);
  const preview = selected && reviewTemplate(selected, values);
  async function submit() {
    if (
      lock.current ||
      !selected ||
      !preview ||
      !confirming ||
      uncertain ||
      !writable
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!(await repository.sendTemplate(chat, selected, values))) return;
      await refresh();
      if (mounted.current) {
        close();
        toast("Plantilla enviada.");
      }
    } catch (reason) {
      if (!mounted.current) return;
      if (requiresRemoteLogin(reason)) expired(reason);
      else {
        confirm(false);
        setUncertain(repository.templateIsUncertain(chat.id));
        setError(displayError(reason));
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function reconcile() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if ((await refresh()) && mounted.current) {
        repository.templateHistoryChecked(chat.id);
        setUncertain(false);
        close();
        toast(
          "Historial actualizado. Revisa si la plantilla llegó antes de repetir.",
        );
      } else if (mounted.current)
        setError("No se pudo actualizar el historial.");
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <PageScroll>
      {!catalog.data && <CatalogState {...catalog} />}
      {templates?.length === 0 && (
        <Text>Sin plantillas aprobadas disponibles.</Text>
      )}
      {repository.allowSend && catalog.data && !writable && (
        <Banner type="warning">
          Las plantillas de este CRM se envían solo en chats de la línea
          principal de WhatsApp de Meta.
        </Banner>
      )}
      {!!error && <Banner type="warning">{error}</Banner>}
      {uncertain && (
        <>
          <Banner type="warning">
            No se confirmó el envío. Actualiza y revisa el historial antes de
            repetir.
          </Banner>
          <Button loading={busy} onPress={() => void reconcile()}>
            Actualizar historial
          </Button>
        </>
      )}
      {!confirming &&
        templates?.map((item) => (
          <PickerRow
            key={item.id}
            label={`${item.name} · ${item.language}`}
            value={item.id === id ? "Seleccionada" : ""}
            onPress={() => {
              if (lock.current || item.id === id) return;
              select(item.id);
              setValues(item.variables.map(() => ""));
              setError("");
            }}
          />
        ))}
      {selected && (
        <>
          {!confirming &&
            selected.variables.map((variable, index) => (
              <Field
                key={variable}
                label={`Valor de {{${variable}}}`}
                value={values[index] ?? ""}
                editable={!busy}
                maxLength={TEMPLATE_VALUE_MAX}
                onChangeText={(value) =>
                  setValues((previous) =>
                    previous.map((item, i) => (i === index ? value : item)),
                  )
                }
              />
            ))}
          <Card style={{ gap: 6 }}>
            <Text weight="semibold">Vista previa</Text>
            {selected.header && (
              <Text weight="semibold">{selected.header}</Text>
            )}
            {selected.image && (
              <Text kind="meta">
                Incluye la imagen de encabezado aprobada por Meta.
              </Text>
            )}
            <Text>{preview?.text ?? selected.body}</Text>
            {selected.footer && <Text kind="meta">{selected.footer}</Text>}
            {selected.buttons.map((label, index) => (
              <Text key={index} kind="secondary">
                {label}
              </Text>
            ))}
          </Card>
          {writable &&
            (confirming ? (
              <>
                <Banner>Se enviará esta plantilla al contacto del chat.</Banner>
                <Button
                  loading={busy}
                  disabled={!preview || uncertain}
                  onPress={() => void submit()}
                >
                  Confirmar envío
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onPress={() => confirm(false)}
                >
                  Volver a editar
                </Button>
              </>
            ) : (
              <Button
                disabled={!preview || busy || uncertain}
                onPress={() => confirm(true)}
              >
                Revisar envío
              </Button>
            ))}
        </>
      )}
    </PageScroll>
  );
}
