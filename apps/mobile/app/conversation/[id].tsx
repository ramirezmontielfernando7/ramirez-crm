import { router, useLocalSearchParams } from "expo-router";
import { Screen } from "../../src/components/Screen";
import {
  AppBar,
  Banner,
  Button,
  Card,
  EmptyState,
  PageScroll,
  Text,
} from "../../src/components/ui";
import { useInbox } from "../../src/features/inbox/store";
export default function ConversationReturnTarget() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useInbox();
  let item;
  try {
    item = store.repository.get(store.actor, id ?? "");
  } catch {
    return (
      <Screen>
        <EmptyState
          title="Acceso no permitido"
          message="Esta conversación no está disponible para tu perfil."
          action={
            <Button onPress={() => router.replace("/(tabs)/inbox")}>
              Volver a Bandeja
            </Button>
          }
        />
      </Screen>
    );
  }
  return (
    <Screen>
      <AppBar
        title={item.name}
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace("/(tabs)/inbox")
        }
      />
      <PageScroll>
        <Banner>
          Destino de prueba T-M2. El chat completo se implementará en T-M3.
        </Banner>
        <Card>
          <Text>{item.phone}</Text>
          <Text>{item.preview}</Text>
          <Text>
            {item.closed
              ? "Ventana cerrada · Requiere plantilla"
              : "Ventana abierta de demostración"}
          </Text>
        </Card>
        <Button
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/(tabs)/inbox")
          }
        >
          Volver a Bandeja
        </Button>
      </PageScroll>
    </Screen>
  );
}
