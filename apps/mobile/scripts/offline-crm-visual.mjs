/** Component/browser QA with setContent only: no HTTP server, listener or provider connection. */
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const dir = process.cwd(),
  out = path.join(dir, "artifacts/offline-integral");
fs.mkdirSync(out, { recursive: true });
const mocks = {
  sound: "export default {playTouchSound(){}};",
  theme: `import {dark,light} from '${dir}/src/theme/tokens';export const useTheme=()=>({colors:window.previewTheme==='dark'?dark:light,dark:window.previewTheme==='dark',mode:window.previewTheme,reducedMotion:true,error:'',setMode:async()=>{}});`,
  layers: `export const useLayers=()=>window.previewLayers;`,
};
const source = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {CrmView} from './src/features/crm/CrmView';import {CrmOverlay,layerTitles} from './src/features/crm/CrmOverlay';import {CrmModel} from './src/features/crm/core';import {DemoConversationRepository,seedConversations} from './src/features/inbox/model';
let mount;function App(){const [layer,setLayer]=useState(null),[model,setModel]=useState(()=>new CrmModel({id:'demo-owner',role:'owner'},new DemoConversationRepository(seedConversations(100)))) , [key,setKey]=useState(0);const actions={model,onChat:id=>window.lastDestination='chat/'+id,onHistory:id=>window.lastDestination='history/'+id,onTask:id=>window.lastDestination='task/'+id,onLayer:(id,arg)=>{if(id==='CRM-02'||id==='CRM-12')model.patch({contactId:arg??model.state.contactId});setLayer({id,arg});}};window.previewLayers={close:()=>setLayer(null),toast:message=>window.lastToast=message};mount=(id,theme,role='owner')=>{window.previewTheme=theme;const m=new CrmModel({id:role==='advisor'?'demo-advisor':'demo-owner',role},new DemoConversationRepository(seedConversations(100)));const roots=['CRM-01','CRM-10','CRM-11','CRM-07','CRM-17'];m.patch({screen:roots.includes(id)?id:'CRM-01',contactId:m.list()[0].id});setModel(m);setLayer(roots.includes(id)?null:{id,arg:id==='CRM-07D'?'Nuevo':id==='CRM-07C'?'Nuevo':undefined});setKey(k=>k+1);};window.mountCrm=(...args)=>mount(...args);return <div key={key} style={{height:'100vh',display:'flex',flexDirection:'column',background:window.previewTheme==='dark'?'#1c263c':'white'}}><CrmView {...actions}/>{layer&&<div role="dialog" aria-label={layerTitles[layer.id]} style={{position:'absolute',inset:0,background:'rgba(16,23,42,.42)',display:'flex',alignItems:'flex-end'}}><div style={{width:'100%',maxHeight:'88vh',overflow:'auto',borderRadius:'22px 22px 0 0',padding:20,boxSizing:'border-box',background:window.previewTheme==='dark'?'#1c263c':'white'}}><div style={{fontFamily:'Inter_600SemiBold',color:window.previewTheme==='dark'?'#e8eefc':'#1d1d1f',fontSize:17,marginBottom:12}}>{layerTitles[layer.id]}</div><CrmOverlay {...actions} id={layer.id} arg={layer.arg}/></div></div>}</div>;}window.previewTheme='light';createRoot(document.getElementById('root')).render(<App/>);`;
const compiled = await build({
  stdin: { contents: source, resolveDir: dir, loader: "tsx" },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  define: { "process.env.NODE_ENV": '"production"' },
  alias: {
    "@react-native/assets-registry/registry": path.join(
      dir,
      "node_modules/react-native-web/dist/modules/AssetRegistry/index.js",
    ),
    "react-native": "react-native-web",
    "react-native-svg": path.join(
      dir,
      "node_modules/react-native-svg/lib/module/ReactNativeSVG.web.js",
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
      name: "offline-provider-fixtures",
      setup(b) {
        b.onResolve({ filter: /NativeSvgSoundModule$/ }, () => ({
          path: "sound",
          namespace: "preview",
        }));
        b.onResolve({ filter: /theme\/ThemeProvider$/ }, () => ({
          path: "theme",
          namespace: "preview",
        }));
        b.onResolve({ filter: /components\/Layers$/ }, () => ({
          path: "layers",
          namespace: "preview",
        }));
        b.onLoad({ filter: /.*/, namespace: "preview" }, (args) => ({
          contents: mocks[args.path],
          loader: "ts",
          resolveDir: dir,
        }));
      },
    },
  ],
});
const css = [
  ["400Regular", "Inter_400Regular"],
  ["500Medium", "Inter_500Medium"],
  ["600SemiBold", "Inter_600SemiBold"],
]
  .map(
    ([folder, name]) =>
      `@font-face{font-family:${name};src:url(data:font/ttf;base64,${fs.readFileSync(path.join(dir, "node_modules/@expo-google-fonts/inter", folder, name + ".ttf")).toString("base64")})}`,
  )
  .join("");
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
await context.route("**/*", (route) => {
  blocked++;
  return route.abort();
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.setContent(
  "<html><head><style>" +
    css +
    'html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div></body></html>',
);
await page.addScriptTag({ content: compiled.outputFiles[0].text });
await page.waitForFunction(() => window.mountCrm);
const ids = [
  "CRM-01",
  "CRM-02",
  "CRM-03",
  "CRM-04",
  "CRM-05",
  "CRM-06",
  "CRM-07",
  "CRM-07C",
  "CRM-07D",
  "CRM-08",
  "CRM-09",
  "CRM-10",
  "CRM-11",
  "CRM-12",
  "CRM-13",
  "CRM-14",
  "CRM-15",
  "CRM-16",
  "CRM-17",
];
for (const theme of ["light", "dark"])
  for (const id of ids) {
    await page.evaluate(({ id, theme }) => window.mountCrm(id, theme), {
      id,
      theme,
    });
    await page.waitForTimeout(75);
    await page.screenshot({ path: path.join(out, `${id}-${theme}.png`) });
  }
await page.evaluate(() => window.mountCrm("CRM-10", "light"));
await page
  .getByRole("textbox", { name: "Buscar nombre o teléfono" })
  .fill("Karla");
await page.getByRole("button", { name: /Karla Méndez,/ }).click();
await page.getByRole("button", { name: "Editar contacto" }).click();
await page
  .getByRole("textbox", { name: "Nombre", exact: true })
  .fill("Karla Demo Editada");
await page.getByRole("button", { name: "Guardar", exact: true }).click();
await page.getByText("Karla Demo Editada", { exact: true }).waitFor();
await page.evaluate(() => window.mountCrm("CRM-10", "light", "advisor"));
if (await page.getByRole("button", { name: /Karla Méndez,/ }).count())
  throw Error("advisor scope leaked");
const reference = await context.newPage();
await reference.setContent(
  fs.readFileSync(
    path.join(dir, "docs/reference/dashfort-mobile-prototipo.html"),
    "utf8",
  ),
);
await reference.waitForFunction(() => typeof go === "function");
for (const theme of ["light", "dark"])
  for (const id of ids) {
    await reference.evaluate(
      ({ id, theme }) => {
        S.theme = theme;
        go(id);
      },
      { id, theme },
    );
    await reference.waitForTimeout(30);
    await reference
      .locator("#ph")
      .screenshot({ path: path.join(out, `reference-${id}-${theme}.png`) });
  }
await browser.close();
if (errors.length) throw Error(JSON.stringify(errors));
fs.writeFileSync(
  path.join(out, "results.json"),
  JSON.stringify(
    {
      componentPreviews: 38,
      officialReferenceCaptures: 38,
      behaviorChecks: ["search to contact", "edit identity", "advisor scope"],
      errors,
      blockedNetworkRequests: blocked,
      httpServerStarted: false,
      native: false,
      limitations: [
        "fixture theme/layer host",
        "100 fake rows",
        "not full Expo runtime or native keyboard/scroll QA",
      ],
    },
    null,
    2,
  ),
);
console.log(
  "38 component previews, 38 official references, 3 browser behaviors; no HTTP server.",
);
