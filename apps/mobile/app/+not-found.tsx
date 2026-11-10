import { router } from "expo-router";
import { Screen } from "../src/components/Screen";
import { Button, EmptyState } from "../src/components/ui";
export default function NotFound() {
  return (
    <Screen>
      <EmptyState
        title="Pantalla no disponible"
        message="Este enlace no corresponde a una pantalla de la demo."
        action={
          <Button onPress={() => router.replace("/")}>Volver al inicio</Button>
        }
      />
    </Screen>
  );
}
