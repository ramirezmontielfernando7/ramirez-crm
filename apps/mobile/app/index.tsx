import { Redirect } from "expo-router";
import { useSession } from "../src/state/SessionProvider";
export default function Index() {
  const { session } = useSession();
  return <Redirect href={session ? "/(tabs)/inbox" : "/login"} />;
}
