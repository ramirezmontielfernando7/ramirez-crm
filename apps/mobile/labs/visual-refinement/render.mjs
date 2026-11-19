import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
const root = process.cwd(),
  lab = path.join(root, "labs/visual-refinement"),
  out = path.join(lab, "output");
fs.mkdirSync(out, { recursive: true });
const mocks = {
  theme: `import {dark,light} from '${root}/src/theme/tokens';import {labState} from '${lab}/profiles';export const useTheme=()=>({colors:labState().theme==='dark'?dark:light,dark:labState().theme==='dark',mode:labState().theme,reducedMotion:true,setMode:async()=>{},error:''});`,
  layers: `export const useLayers=()=>window.labLayers;`,
  safe: `import {View} from 'react-native';export const SafeAreaView=View;export const SafeAreaProvider=View;export const useSafeAreaInsets=()=>({top:0,bottom:0,left:0,right:0});`,
  session: `import {fixtureSession} from '${lab}/entry';export const useSession=()=>({session:fixtureSession,disabled:[],ready:true});`,
  store: `import {useSyncExternalStore} from 'react';import {store} from '${lab}/entry';export const useInbox=()=>store;export const useOptionalInbox=()=>store;export const useInboxState=()=>useSyncExternalStore(store.subscribe,store.snapshot,store.snapshot);export const useInboxUnread=()=>useInboxState().data.filter(c=>!c.archived&&!c.campaign&&c.unread>0).length;`,
  route: `import {useEffect} from 'react';export const useFocusEffect=(fn)=>useEffect(fn,[fn]);export const router={push:id=>window.labEvents.push({route:id})};`,
  sound: `export default {playTouchSound(){}};`,
};
const compile = async () =>
  build({
    entryPoints: [path.join(lab, "entry.tsx")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    minify: true,
    define: {
      "process.env.NODE_ENV": '"production"',
      __DEV__: "false",
      global: "globalThis",
    },
    alias: {
      "react-native": "react-native-web",
      "react-native-svg": path.join(
        root,
        "node_modules/react-native-svg/lib/module/ReactNativeSVG.web.js",
      ),
      "@react-native/assets-registry/registry": path.join(
        root,
        "node_modules/react-native-web/dist/modules/AssetRegistry/index.js",
      ),
    },
    resolveExtensions: [
      ".web.tsx",
      ".tsx",
      ".web.ts",
      ".ts",
      ".web.js",
      ".js",
      ".json",
    ],
    plugins: [
      {
        name: "lab-only-bindings",
        setup(b) {
          const bind = (filter, key) =>
            b.onResolve({ filter }, () => ({
              path: key,
              namespace: "fixture",
            }));
          bind(/theme\/ThemeProvider$/, "theme");
          bind(/components\/Layers$/, "layers");
          bind(/react-native-safe-area-context$/, "safe");
          bind(/state\/SessionProvider$/, "session");
          bind(/inbox\/store$|^\.\/store$/, "store");
          bind(/^expo-router$/, "route");
          bind(/NativeSvgSoundModule$/, "sound");
          b.onResolve({ filter: /components\/ui$/ }, (args) =>
            args.importer === path.join(lab, "ui.tsx")
              ? undefined
              : { path: path.join(lab, "ui.tsx") },
          );
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: mocks[args.path],
            loader: "tsx",
            resolveDir: root,
          }));
        },
      },
    ],
  });
const compiled = await compile();
const fonts = [
  ["400Regular", "Inter_400Regular"],
  ["500Medium", "Inter_500Medium"],
  ["600SemiBold", "Inter_600SemiBold"],
]
  .map(
    ([folder, name]) =>
      `@font-face{font-family:${name};src:url(data:font/ttf;base64,${fs.readFileSync(path.join(root, "node_modules/@expo-google-fonts/inter", folder, name + ".ttf")).toString("base64")})}`,
  )
  .join("");
const document = `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}html,body,#root{margin:0;height:100%;overflow:hidden}*{box-sizing:border-box}</style></head><body><div id="root"></div><script>${compiled.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
fs.writeFileSync(path.join(out, "preview-frame.html"), document);
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  offline: true,
});
let blocked = 0;
await context.route("**/*", (r) => {
  blocked++;
  return r.abort();
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => {
  errors.push(e.message);
  console.log("BROWSER_ERROR", e.message);
});
try {
  await page.setContent(document);
  await page
    .getByRole("heading", { name: "Bandeja", exact: true })
    .waitFor({ timeout: 7000 });
  await page.evaluate(() => document.fonts.ready);
  const metrics = [];
  for (const size of [
    [390, 844],
    [360, 640],
  ])
    for (const theme of ["light", "dark"])
      for (const variant of ["actual", "A", "B", "C"]) {
        await page.setViewportSize({ width: size[0], height: size[1] });
        await page.evaluate(
          ({ variant, theme }) => window.renderLab(variant, theme),
          { variant, theme },
        );
        await page
          .getByRole("heading", { name: "Bandeja", exact: true })
          .waitFor();
        await page.waitForTimeout(180);
        const filename = `bandeja-${variant}-${theme}-${size.join("x")}.png`;
        await page.screenshot({ path: path.join(out, filename) });
        const boxes = await page
          .getByRole("tab")
          .filter({ hasText: /^(Clientes|Equipo|Mi número)$/ })
          .evaluateAll((nodes) =>
            nodes.map((n) => ({
              label: n.textContent,
              width: n.getBoundingClientRect().width,
              height: n.getBoundingClientRect().height,
            })),
          );
        if (
          boxes.length !== 3 ||
          boxes.some((b) => b.height < 48 || b.width < 48)
        )
          throw Error(
            "Selector hit targets below 48dp: " + JSON.stringify(boxes),
          );
        metrics.push({
          filename,
          variant,
          theme,
          width: size[0],
          height: size[1],
          selectorTargets: boxes,
        });
      }
  // Actual source interactions remain usable under each proposal.
  for (const variant of ["actual", "A", "B", "C"]) {
    await page.evaluate((v) => window.renderLab(v, "light"), variant);
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await page.getByRole("textbox", { name: "Buscar chats" }).fill("Karla");
    await page.getByRole("button", { name: /Karla Méndez,/ }).waitFor();
    await page.getByRole("button", { name: "Cerrar búsqueda" }).click();
    await page.getByRole("tab", { name: "Equipo", exact: true }).click();
  }
  for (const screen of ["crm", "contacts"])
    for (const theme of ["light", "dark"])
      for (const variant of ["actual", "A", "B", "C"]) {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(
          ({ variant, theme, screen }) =>
            window.renderLab(variant, theme, screen),
          { variant, theme, screen },
        );
        await page.waitForTimeout(120);
        await page.screenshot({
          path: path.join(out, `${screen}-${variant}-${theme}-390x844.png`),
        });
      }
  fs.writeFileSync(
    path.join(out, "metrics.json"),
    JSON.stringify(
      {
        source:
          "actual InboxScreen/ConversationRow/ui/TabBar; isolated providers",
        listImplementation: "actual FlashList",
        screenshots: metrics.length + 16,
        metrics,
        networkRequestsBlocked: blocked,
        errors,
        native: false,
      },
      null,
      2,
    ),
  );
  if (errors.length) throw Error(JSON.stringify(errors));
  console.log(
    "32 frames rendered; actual FlashList; all selector targets >=48px; 4 search/selector checks; zero page errors.",
  );
} catch (error) {
  console.log("PAGE_ERRORS", JSON.stringify(errors));
  console.log(
    "BODY_TEXT",
    (await page.locator("body").innerText()).slice(0, 500),
  );
  throw error;
} finally {
  await browser.close();
}
