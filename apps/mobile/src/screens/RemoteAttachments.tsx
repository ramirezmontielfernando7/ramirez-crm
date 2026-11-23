import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import { FileText, Headphones, Video } from "lucide-react-native";
import { useTheme } from "../theme/ThemeProvider";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useVideoPlayer, VideoView } from "expo-video";
import * as Sharing from "expo-sharing";
import { startActivityAsync } from "expo-intent-launcher";
import { getContentUriAsync } from "expo-file-system/legacy";
import type { File } from "expo-file-system";
import { useLayers } from "../components/Layers";
import { Banner, Button, PageScroll, Text } from "../components/ui";
import {
  safeDocument,
  type RemoteAttachment,
} from "../integration/remote-media";
import {
  RemoteHttpError,
  requiresRemoteLogin,
} from "../integration/remote-http";
import {
  cacheRemoteMedia,
  deleteCacheFile,
  stageAttachment,
  type LocalAttachment,
} from "./remote-media-cache";
import { type RemotePageProps, errorText } from "./RemoteWorkspaceUi";

type Props = RemotePageProps;

export function RemoteAttachmentRow({
  item,
  repository,
  expired,
  sticker = false,
}: Props & { item: RemoteAttachment; sticker?: boolean }) {
  const { open } = useLayers();
  const { colors } = useTheme();
  const [thumbnail, setThumbnail] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (Platform.OS === "web" || item.kind !== "image") return;
    const abort = new AbortController();
    let file: File | undefined;
    void cacheRemoteMedia(repository, item, abort.signal, true).then(
      (result) => {
        if (abort.signal.aborted) deleteCacheFile(result);
        else {
          file = result;
          setThumbnail(result.uri);
        }
      },
      (reason) => {
        if (abort.signal.aborted) return;
        setLoading(false);
        setFailed(true);
        if (requiresRemoteLogin(reason)) expired(reason);
      },
    );
    return () => {
      abort.abort();
      if (file) deleteCacheFile(file);
    };
  }, [repository, item.id, item.kind, item.mime, item.size, expired, attempt]);

  const view = () => {
    if (item.kind === "image") {
      setFull(true);
      return;
    }
    open({
      kind: "sheet",
      title: item.name,
      content: (
        <AttachmentViewer
          item={item}
          repository={repository}
          expired={expired}
        />
      ),
    });
  };
  if (item.kind !== "image") {
    const [name, Icon] = {
      audio: ["Abrir audio", Headphones],
      video: ["Abrir video", Video],
      document: ["Ver documento", FileText],
    }[item.kind];
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name as string}
        onPress={view}
        style={{
          padding: 8,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colors.border,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        {React.createElement(Icon as typeof FileText, {
          size: 20,
          color: colors.accent,
        })}
        <View style={{ flexShrink: 1 }}>
          <Text numberOfLines={2}>{item.name}</Text>
          <Text kind="meta">
            {item.size === null
              ? "Tamaño no disponible"
              : item.size < 1024
                ? item.size + " B"
                : Math.round(item.size / 1024) + " KB"}
          </Text>
        </View>
      </Pressable>
    );
  }
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          failed ? "Reintentar imagen" : sticker ? "Ver sticker" : "Ver imagen"
        }
        onPress={() => {
          if (failed) {
            setFailed(false);
            setLoading(true);
            setThumbnail(undefined);
            setAttempt((value) => value + 1);
          } else view();
        }}
        style={{
          width: sticker ? 132 : 218,
          height: sticker ? 132 : 164,
          maxWidth: "100%",
          overflow: "hidden",
          borderRadius: sticker ? 0 : 9,
          backgroundColor: sticker ? "transparent" : colors.sunken,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {!!thumbnail && !failed && (
          <Image
            source={{ uri: thumbnail }}
            accessibilityLabel="Vista previa del adjunto"
            resizeMode="contain"
            fadeDuration={130}
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setFailed(true);
              setLoading(false);
            }}
            style={{ position: "absolute", width: "100%", height: "100%" }}
          />
        )}
        {failed ? (
          <Text kind="meta">Reintentar imagen</Text>
        ) : loading && Platform.OS !== "web" ? (
          <ActivityIndicator accessibilityLabel="Cargando imagen" />
        ) : null}
      </Pressable>
      {full && (
        <AttachmentViewer
          item={item}
          repository={repository}
          expired={expired}
          dismiss={() => setFull(false)}
        />
      )}
    </View>
  );
}

function AudioPlayback({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  return (
    <Button
      onPress={() => {
        if (status.playing) player.pause();
        else {
          if (status.didJustFinish)
            void player.seekTo(0).then(() => player.play());
          else player.play();
        }
      }}
    >
      {status.playing ? "Pausar" : "Reproducir audio"}
    </Button>
  );
}

function VideoPlayback({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return (
    <VideoView
      player={player}
      nativeControls
      style={{ height: 220, width: "100%" }}
    />
  );
}

function AttachmentViewer({
  item,
  repository,
  expired,
  dismiss,
}: Props & { item: RemoteAttachment; dismiss?: () => void }) {
  const [uri, setUri] = useState<string>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const { close } = useLayers();
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const abort = new AbortController();
    let file: File | undefined;
    void cacheRemoteMedia(repository, item, abort.signal).then(
      (result) => {
        if (abort.signal.aborted) deleteCacheFile(result);
        else {
          file = result;
          setUri(result.uri);
        }
      },
      (reason) => {
        if (abort.signal.aborted) return;
        if (requiresRemoteLogin(reason)) expired(reason);
        else setError(errorText(reason));
      },
    );
    return () => {
      abort.abort();
      if (file) deleteCacheFile(file);
    };
  }, [repository, item, expired, revision]);

  async function openDocument() {
    if (!uri || !safeDocument(item.mime)) return;
    try {
      if (Platform.OS === "android")
        await startActivityAsync("android.intent.action.VIEW", {
          data: await getContentUriAsync(uri),
          type: item.mime,
          flags: 1,
        });
      else if (await Sharing.isAvailableAsync())
        await Sharing.shareAsync(uri, { mimeType: item.mime });
      else setError("No hay un visor compatible disponible.");
    } catch {
      setError("No hay un visor compatible disponible.");
    }
  }

  if (dismiss) {
    return (
      <Modal visible animationType="fade" onRequestClose={dismiss}>
        <View
          style={{
            flex: 1,
            backgroundColor: colors.base,
            justifyContent: "center",
          }}
        >
          <View
            style={{
              padding: 12,
              paddingTop: 24,
              flexDirection: "row",
              justifyContent: "space-between",
            }}
          >
            <Button variant="ghost" onPress={dismiss}>
              Cerrar imagen
            </Button>
            {!!uri && (
              <View style={{ flexDirection: "row" }}>
                <Button
                  variant="ghost"
                  onPress={() => setZoom((value) => Math.max(1, value - 0.5))}
                >
                  Reducir
                </Button>
                <Button
                  variant="ghost"
                  onPress={() => setZoom((value) => Math.min(3, value + 0.5))}
                >
                  Ampliar
                </Button>
              </View>
            )}
          </View>
          {!!uri ? (
            <ScrollView
              maximumZoomScale={3}
              nestedScrollEnabled
              contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
            >
              <ScrollView
                horizontal
                nestedScrollEnabled
                contentContainerStyle={{
                  flexGrow: 1,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Image
                  source={{ uri }}
                  accessibilityLabel="Imagen del chat"
                  resizeMode="contain"
                  style={{
                    width: width * zoom,
                    height: Math.max(160, height - 124) * zoom,
                  }}
                />
              </ScrollView>
            </ScrollView>
          ) : Platform.OS === "web" ? (
            <Text>Abre la imagen en Android o iOS.</Text>
          ) : error ? (
            <View style={{ padding: 16 }}>
              <Banner type="warning">{error}</Banner>
              <Button
                onPress={() => {
                  setError("");
                  setRevision((old) => old + 1);
                }}
              >
                Reintentar descarga
              </Button>
            </View>
          ) : (
            <ActivityIndicator accessibilityLabel="Descargando imagen" />
          )}
        </View>
      </Modal>
    );
  }

  return (
    <PageScroll>
      {Platform.OS === "web" ? (
        <Text>Abre el adjunto en Android o iOS.</Text>
      ) : (
        <>
          {!uri && !error && (
            <ActivityIndicator accessibilityLabel="Descargando adjunto" />
          )}
          {!!error && <Banner type="warning">{error}</Banner>}
          {!uri && !!error && (
            <Button
              onPress={() => {
                setError("");
                setRevision((old) => old + 1);
              }}
            >
              Reintentar descarga
            </Button>
          )}
          {!!uri && item.kind === "image" && (
            <Image
              source={{ uri }}
              accessibilityLabel="Imagen del chat"
              resizeMode="contain"
              style={{ height: 310, width: "100%" }}
            />
          )}
          {!!uri && item.kind === "audio" && <AudioPlayback uri={uri} />}
          {!!uri && item.kind === "video" && <VideoPlayback uri={uri} />}
          {!!uri &&
            item.kind === "document" &&
            (safeDocument(item.mime) ? (
              <Button onPress={() => void openDocument()}>
                Abrir con el sistema
              </Button>
            ) : (
              <Banner type="warning">
                Vista externa no disponible para este formato.
              </Banner>
            ))}
          <Button variant="ghost" onPress={close}>
            Cerrar adjunto
          </Button>
        </>
      )}
    </PageScroll>
  );
}

export function RemoteAttachmentComposer({
  repository,
  expired,
  id,
  refresh,
  offerTemplates,
}: Props & {
  id: string;
  refresh: () => Promise<boolean>;
  offerTemplates: () => void;
}) {
  const { close, toast } = useLayers();
  const [attachment, setAttachment] = useState<LocalAttachment>();
  const [prepared, setPrepared] = useState<number>();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [closedWindow, setClosedWindow] = useState(false);
  const [uncertain, setUncertain] = useState(() =>
    repository.mediaNeedsRefresh(id),
  );
  const lock = useRef(false);
  const mounted = useRef(false);
  const upload = useRef<AbortController | undefined>(undefined);
  const staged = useRef<LocalAttachment | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      upload.current?.abort();
      if (staged.current) deleteCacheFile(staged.current.file);
    };
  }, []);

  async function pick(kind: "camera" | "gallery" | "document") {
    if (lock.current || Platform.OS === "web") return;
    lock.current = true;
    setBusy(true);
    setError("");
    setClosedWindow(false);
    try {
      let asset: Parameters<typeof stageAttachment>[0] | undefined;
      if (kind === "document") {
        const result = await DocumentPicker.getDocumentAsync({
          multiple: false,
          copyToCacheDirectory: true,
        });
        if (!result.canceled) asset = result.assets[0];
      } else {
        if (
          kind === "camera" &&
          !(await ImagePicker.requestCameraPermissionsAsync()).granted
        ) {
          if (mounted.current)
            setError(
              "Dashfort necesita acceso a la cámara para tomar la foto.",
            );
          return;
        }
        const result = await (kind === "camera"
          ? ImagePicker.launchCameraAsync({ mediaTypes: ["images"] })
          : ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"] }));
        if (!result.canceled) asset = result.assets[0];
      }
      if (!asset) return;
      const selection = stageAttachment(asset);
      if (!mounted.current) {
        deleteCacheFile(selection.file);
        return;
      }
      if (staged.current) deleteCacheFile(staged.current.file);
      staged.current = selection;
      setAttachment(selection);
      setConfirm(false);
    } catch (reason) {
      if (mounted.current) setError(errorText(reason));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function send() {
    if (lock.current || !confirm || !attachment || uncertain) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const abort = new AbortController();
    upload.current = abort;
    setPrepared(0);
    try {
      const result = await repository.sendMedia(
        id,
        attachment,
        abort.signal,
        (percent) => {
          if (mounted.current) setPrepared(percent);
        },
      );
      if (!result || !mounted.current) return;
      await refresh();
      if (mounted.current) {
        close();
        toast(result.queued ? "Adjunto en cola." : "Adjunto enviado.");
      }
    } catch (reason) {
      if (!mounted.current) return;
      if (requiresRemoteLogin(reason)) expired(reason);
      else {
        setConfirm(false);
        setUncertain(repository.mediaNeedsRefresh(id));
        setError(
          abort.signal.aborted
            ? repository.mediaNeedsRefresh(id)
              ? "Subida cancelada. Su resultado puede ser incierto."
              : "Subida cancelada."
            : errorText(reason),
        );
        if (
          reason instanceof RemoteHttpError &&
          reason.code === "window_closed"
        )
          setClosedWindow(true);
      }
    } finally {
      upload.current = undefined;
      lock.current = false;
      if (mounted.current) setPrepared(undefined);
      if (mounted.current) setBusy(false);
    }
  }
  async function reconcile() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if ((await refresh()) && mounted.current) {
        repository.mediaHistoryChecked(id);
        close();
        toast(
          "Historial actualizado. Revisa si el adjunto aparece antes de repetir.",
        );
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <PageScroll>
      {!!error && <Banner type="warning">{error}</Banner>}
      {closedWindow && (
        <Button onPress={offerTemplates}>Ver plantillas aprobadas</Button>
      )}
      {uncertain && (
        <>
          <Banner type="warning">
            Consulta y revisa el historial antes de repetir el envío.
          </Banner>
          <Button loading={busy} onPress={() => void reconcile()}>
            Actualizar historial
          </Button>
        </>
      )}
      {!confirm && (
        <>
          <Button
            variant="secondary"
            disabled={busy}
            onPress={() => void pick("gallery")}
          >
            Elegir foto
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onPress={() => void pick("camera")}
          >
            Tomar foto
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onPress={() => void pick("document")}
          >
            Elegir documento
          </Button>
        </>
      )}
      {attachment && (
        <>
          {attachment.kind === "image" && (
            <Image
              source={{ uri: attachment.uri }}
              accessibilityLabel="Vista previa de la foto"
              resizeMode="contain"
              style={{ height: 200, width: "100%" }}
            />
          )}
          <Text>
            {attachment.name} · {Math.ceil(attachment.size / 1024)} KB
          </Text>
          <Text kind="secondary">
            {attachment.kind === "document"
              ? "Se enviará como documento."
              : attachment.mime}
          </Text>
          {confirm ? (
            <>
              <Banner>El cliente recibirá este archivo.</Banner>
              <Button
                loading={busy}
                disabled={uncertain}
                onPress={() => void send()}
              >
                Confirmar envío del archivo
              </Button>
              {prepared !== undefined && (
                <Text accessibilityLiveRegion="polite">
                  {prepared < 100
                    ? `Preparando archivo… ${prepared} %`
                    : "Subiendo archivo…"}
                </Text>
              )}
              <Button
                variant="secondary"
                onPress={() => {
                  if (upload.current) upload.current.abort();
                  else setConfirm(false);
                }}
              >
                {prepared !== undefined ? "Cancelar subida" : "Volver a editar"}
              </Button>
            </>
          ) : (
            <Button
              disabled={busy || uncertain}
              onPress={() => setConfirm(true)}
            >
              Revisar envío del archivo
            </Button>
          )}
        </>
      )}
    </PageScroll>
  );
}
