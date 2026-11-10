import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { type Module, type Session, isSession } from "../domain/access";
import { DemoAuthRepository } from "../services/demo-auth";
import { sessionStorage } from "../services/storage";
const repository = new DemoAuthRepository(sessionStorage);
const Context = createContext<{
  session: Session | null;
  ready: boolean;
  notice: string;
  disabled: Module[];
  setDisabled: (modules: Module[]) => void;
  signIn: typeof repository.signIn;
  redeem: typeof repository.redeem;
  signOut: () => Promise<void>;
  expire: () => Promise<void>;
  restore: () => Promise<void>;
}>(null!);
export function SessionProvider({ children }: React.PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [disabled, setDisabled] = useState<Module[]>([]);
  const current = useRef(session);
  current.current = session;
  const restore = async () => {
    setReady(false);
    try {
      setSession(await repository.restore());
      setNotice(
        repository.lastRestoreExpired
          ? "Tu sesión caducó. Vuelve a iniciar sesión."
          : "",
      );
    } catch {
      setSession(null);
      setNotice("No se pudo leer la sesión local. Reintenta antes de entrar.");
    } finally {
      setReady(true);
    }
  };
  useEffect(() => {
    void restore();
  }, []);
  const expire = async () => {
    setSession(null);
    setDisabled([]);
    setNotice("Tu sesión caducó. Vuelve a iniciar sesión.");
    await repository.signOut();
  };
  useEffect(() => {
    const check = () => {
      if (current.current && !isSession(current.current))
        void expire().catch(() =>
          setNotice("Sesión caducada. No se pudo limpiar el almacenamiento."),
        );
    };
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    // setTimeout has a 32-bit limit; check at most once per minute, including at foreground resume.
    const timer = setInterval(check, 60_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, []);
  const signIn = async (email: string, password: string) => {
    const s = await repository.signIn(email, password);
    setSession(s);
    setNotice("");
    setDisabled([]);
    return s;
  };
  const redeem: typeof repository.redeem = async (...args) => {
    const s = await repository.redeem(...args);
    setSession(s);
    setNotice("");
    return s;
  };
  const signOut = async () => {
    await repository.signOut();
    setSession(null);
    setDisabled([]);
    setNotice("");
  };
  return (
    <Context.Provider
      value={{
        session,
        ready,
        notice,
        disabled,
        setDisabled,
        signIn,
        redeem,
        signOut,
        expire,
        restore,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useSession = () => useContext(Context);
