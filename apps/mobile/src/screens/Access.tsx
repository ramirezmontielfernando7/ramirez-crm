import React, { useRef, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { MessageCircle } from "lucide-react-native";
import { Screen } from "../components/Screen";
import {
  AppBar,
  Banner,
  Button,
  Field,
  PageScroll,
  Text,
} from "../components/ui";
import { useTheme } from "../theme/ThemeProvider";
import { useLayers } from "../components/Layers";
import { useSession } from "../state/SessionProvider";
import { validateLogin, validatePassword } from "../domain/access";
function Recovery() {
  const { close } = useLayers();
  return (
    <>
      <Text>
        Por seguridad no hay recuperación automática. Pídele a la persona
        administradora de tu empresa un enlace para restablecer; se abre en esta
        app.
      </Text>
      <Button onPress={close}>Entendido</Button>
    </>
  );
}
export function LoginScreen() {
  const { colors: c } = useTheme();
  const { open } = useLayers();
  const { signIn, notice } = useSession();
  const [email, setEmail] = useState("fer@ejemplo.mx");
  const [password, setPassword] = useState("Dashfort2026");
  const [errors, setErrors] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const submit = async () => {
    if (locked.current) return;
    const result = validateLogin(email, password);
    setErrors(result);
    setError("");
    if (result.email || result.password) return;
    locked.current = true;
    setBusy(true);
    try {
      await signIn(email, password);
      router.replace("/(tabs)/inbox");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo iniciar sesión.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return (
    <Screen keyboard>
      <PageScroll style={{ paddingTop: 36 }}>
        <View style={{ alignItems: "center", marginBottom: 14, gap: 4 }}>
          <View
            style={{
              width: 72,
              height: 72,
              backgroundColor: c.brand,
              borderRadius: 20,
              justifyContent: "center",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <MessageCircle size={34} color="#fff" strokeWidth={1.8} />
          </View>
          <Text kind="module" weight="semibold" style={{ color: c.accentInk }}>
            Dashfort
          </Text>
          <Text kind="secondary" style={{ color: c.text3 }}>
            by Demfort
          </Text>
        </View>
        {!!notice && <Banner type="warning">{notice}</Banner>}
        {!!error && <Banner type="danger">{error}</Banner>}
        <Field
          label="Correo"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          error={errors.email}
          onBlur={() =>
            setErrors((e) => ({
              ...e,
              email: validateLogin(email, password).email,
            }))
          }
          editable={!busy}
        />
        <Field
          label="Contraseña"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          error={errors.password}
          onSubmitEditing={() => void submit()}
          editable={!busy}
        />
        <Button loading={busy} onPress={() => void submit()}>
          Iniciar sesión
        </Button>
        <Button
          variant="ghost"
          onPress={() =>
            open({
              kind: "dialog",
              title: "Pide un enlace nuevo",
              content: <Recovery />,
            })
          }
        >
          ¿Olvidaste tu contraseña?
        </Button>
        <Text
          kind="secondary"
          style={{ textAlign: "center", color: c.text3, marginTop: 18 }}
        >
          ¿Tu organización aún no tiene cuenta?{"\n"}Pídela al administrador de
          tu empresa.
        </Text>
        <View style={{ marginTop: 24 }}>
          <Button variant="ghost" onPress={() => router.push("/demo")}>
            Demo aislada · T-M1
          </Button>
        </View>
      </PageScroll>
    </Screen>
  );
}
export function PasswordScreen({ purpose }: { purpose: "activate" | "reset" }) {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { redeem } = useSession();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState({ password: "", confirmation: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const submit = async () => {
    if (lock.current) return;
    const errors = validatePassword(password, confirm);
    setErrors(errors);
    setError("");
    if (errors.password || errors.confirmation) return;
    setBusy(true);
    lock.current = true;
    try {
      await redeem(token ?? "", password, purpose);
      router.replace("/(tabs)/inbox");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Screen keyboard>
      <AppBar
        title={
          purpose === "activate" ? "Activa tu cuenta" : "Restablecer contraseña"
        }
        onBack={() => router.replace("/login")}
      />
      <PageScroll>
        {purpose === "activate" && (
          <Text>
            Te invitaron a Joyería Cristal como Asesor. Elige tu contraseña para
            entrar.
          </Text>
        )}
        {!!error && <Banner type="danger">{error}</Banner>}
        <Field
          label="Contraseña nueva"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          hint="Mínimo 8 caracteres."
          error={errors.password}
          editable={!busy}
        />
        <Field
          label="Repite la contraseña"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoComplete="new-password"
          error={errors.confirmation}
          editable={!busy}
        />
        <Button loading={busy} onPress={() => void submit()}>
          {purpose === "activate" ? "Activar y entrar" : "Guardar y entrar"}
        </Button>
        <Text kind="meta">
          Enlace de demostración. No modifica ninguna cuenta real.
        </Text>
      </PageScroll>
    </Screen>
  );
}
export function RegisterScreen() {
  return (
    <Screen>
      <AppBar title="Crear cuenta" onBack={() => router.replace("/login")} />
      <PageScroll>
        <Banner type="warning">
          El registro está cerrado: esta instancia ya tiene su organización.
          Pide acceso al propietario.
        </Banner>
        <Field label="Nombre" placeholder="Tu nombre" editable={false} />
        <Field label="Correo" placeholder="tu@correo.com" editable={false} />
        <Field label="Contraseña" secureTextEntry editable={false} />
        <Button disabled>Crear cuenta</Button>
      </PageScroll>
    </Screen>
  );
}
