import React, { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { useSession } from "../src/state/SessionProvider";
import { useTheme } from "../src/theme/ThemeProvider";
import { preferencesStorage } from "../src/services/storage";
import { Screen } from "../src/components/Screen";
import { OpeningScreen } from "../src/features/opening/OpeningScreen";
import { startOpening } from "../src/features/opening/core";
export default function Index() {
  const { session } = useSession(),
    { reducedMotion } = useTheme(),
    [visible, setVisible] = useState(false),
    [finished, setFinished] = useState(false);
  useEffect(
    () =>
      startOpening(preferencesStorage, reducedMotion, setVisible, () =>
        setFinished(true),
      ),
    [reducedMotion],
  );
  if (!finished) return visible ? <OpeningScreen /> : <Screen />;
  return <Redirect href={session ? "/(tabs)/inbox" : "/login"} />;
}
