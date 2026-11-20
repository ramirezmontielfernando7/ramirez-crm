/** Production mobile components + providers, in offline Chromium. No HTTP listener. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
const root = process.cwd(),
  out =
    process.env.DASHFORT_QA_OUTPUT ?? path.join(root, "artifacts/refinement-b");
fs.mkdirSync(out, { recursive: true });
const baseline = "7f068daf10e8e2b78f81bdc4c953887352d39587";
const changedSources = [
  "components/ui.tsx",
  "features/inbox/InboxScreen.tsx",
  "features/crm/CrmView.tsx",
  "features/crm/CrmScreen.tsx",
  "features/chat/ConversationScreen.tsx",
];
const mocks = {
  theme: `import {dark,light} from '${root}/src/theme/tokens';export const useTheme=()=>({colors:window.qaTheme==='dark'?dark:light,dark:window.qaTheme==='dark',mode:window.qaTheme,reducedMotion:true,error:'',setMode:async()=>{}});`,
  session: `export const useSession=()=>({session:window.qaActor,disabled:[],ready:true});`,
  safe: `import {View} from 'react-native';export const SafeAreaView=View;export const SafeAreaProvider=View;export const useSafeAreaInsets=()=>({top:0,bottom:0,left:0,right:0});`,
  sound: `export default {playTouchSound(){}};`,
  storage: `const m=new Map;window.qaResetStorage=()=>m.clear();export const preferencesStorage={get:async k=>{if(window.qaFailRead)throw Error("Lectura local simulada");return m.get(k)??null},set:async(k,v)=>{if(window.qaFailWrite)throw Error("Escritura local simulada");m.set(k,v)},remove:async k=>{m.delete(k)},keys:async prefix=>[...m.keys()].filter(k=>k.startsWith(prefix))};`,
  router: `import {useEffect} from 'react';export const useFocusEffect=fn=>useEffect(fn,[fn]);export const useLocalSearchParams=()=>window.qaParams;export const router={push:p=>window.qaNavigate(p),replace:p=>window.qaNavigate(p,true),back:()=>window.qaGoBack(),canGoBack:()=>window.qaCanGoBack()};`,
};
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {View} from 'react-native';
import InboxScreen from './src/features/inbox/InboxScreen';import {CrmScreen,qaInspect,qaInspectLibrary} from './src/features/crm/CrmScreen';
import {ConversationScreen} from './src/features/chat/ConversationScreen';import {LayerProvider} from './src/components/Layers';
import {InboxProvider,useInbox} from './src/features/inbox/store';import {ChatProvider,useChatDirectory} from './src/features/chat/context';import {ContactProvider,useContactDirectory} from './src/features/contact/context';import {TabBar} from './src/components/TabBar';
import {AgendaScreen,qaInspectAgenda} from './src/features/agenda/AgendaScreen';import {LibraryEntryScreen} from './src/features/library/LibraryEntryScreen';import {ModuleScreen} from './src/screens/ModuleScreen';
import {TeamScreen} from './src/features/team/TeamScreen';import {CalendarSettingsScreen} from './src/features/calendar-settings/CalendarSettingsScreen';import {connectorsFor} from './src/features/calendar-settings/state';import {TagsScreen,LossReasonsScreen} from './src/features/catalog/CatalogScreens';import {OpeningScreen} from './src/features/opening/OpeningScreen';import {QuickScreen} from './src/features/quick/QuickScreen';import {quickFor} from './src/features/quick/state';import {NotificationSettingsScreen,NoticeSheet,noticesFor} from './src/features/notices/NoticeScreens';import {UsageScreen,PlansScreen,UsageLabScreen} from './src/features/usage/UsageScreens';import {EvaluationScreen} from './src/features/studio/Evaluations';import {AssistantScreen} from './src/features/studio/AssistantScreen';import {StudioScreen} from './src/features/studio/StudioScreen';import {studioFor} from './src/features/studio/state';import {AgentEditorScreen,CreatorScreen} from './src/features/studio/AgentScreens';import {ResultsScreen,resultsFor} from './src/features/results/ResultsScreen';import {WorkScreen} from './src/features/work/WorkScreen';import ContactPage from './src/features/contact/DetailsScreen';
window.qaTheme='light';window.qaActor={id:'demo-owner',name:'Fer Ramírez',role:'owner',source:'demo',expiresAt:Date.now()+86400000};window.qaChatId='demo-conv-1';window.qaParams={id:window.qaChatId};let screen='inbox',render,epoch=0,history=[];
window.qaNavigate=(p,replace=false)=>{window.qaLastRoute=p;if(!replace)history.push({screen,params:window.qaParams,chatId:window.qaChatId});if(p.startsWith('/conversation/')){window.qaChatId=p.split('/').pop();window.qaParams={id:window.qaChatId};screen='chat'}else if(p.startsWith('/library/')){window.qaParams={id:p.split('/').pop()};screen='library'}else if(p==='/results')screen='results';else if(p.startsWith('/work')){screen='work';window.qaParams=Object.fromEntries(new URLSearchParams(p.split('?')[1]))}else if(p.startsWith('/contact/')){screen='contact';window.qaParams={id:p.split('/').pop()}}else if(p.startsWith('/agenda')){screen='agenda';window.qaParams=Object.fromEntries(new URLSearchParams(p.split('?')[1]))}else if(p==='/notification-settings')screen='notification-settings';else if(p.startsWith('/studio-evaluation/')){screen='evaluation';window.qaParams={id:p.split('/').pop().split('?')[0],run:new URLSearchParams(p.split('?')[1]).get('run')}}else if(p==='/team')screen='team';else if(p==='/calendar-settings')screen='calendar-settings';else if(p==='/tags')screen='tags';else if(p==='/loss-reasons')screen='loss-reasons';else if(p==='/quick-replies')screen='quick-replies';else if(p==='/usage')screen='usage';else if(p==='/plans')screen='plans';else if(p==='/demo-usage')screen='usage-lab';else if(p==='/assistant'){screen='assistant';window.qaParams={}}else if(p.startsWith('/studio-agent/')){screen='agent-editor';window.qaParams={id:p.split('/').pop()}}else if(p==='/studio-create'){screen='creator';window.qaParams={}}else if(p.includes('studio')){screen='agents';window.qaParams={section:p.includes('section=knowledge')?'knowledge':p.includes('section=tests')?'tests':undefined}}else if(p.includes('inbox'))screen='inbox';else if(p.includes('more'))screen='more';else if(p.includes('crm')){screen='crm';window.qaParams={section:p.includes('section=library')?'library':undefined};}render(v=>v+1);};
window.qaCanGoBack=()=>history.length>0;window.qaGoBack=()=>{const old=history.pop();screen=old?.screen??'inbox';window.qaParams=old?.params??{};window.qaChatId=old?.chatId??window.qaChatId;render(v=>v+1);};
window.mountRefinement=(s,t,role='owner')=>{screen=s;window.qaTheme=t;window.qaActor={...window.qaActor,id:'demo-'+role,role};window.qaParams={id:window.qaChatId};history=[];epoch++;render(v=>v+1);};
function Body(){const inbox=useInbox(),chats=useChatDirectory(),directory=useContactDirectory();window.qaStudio=()=>studioFor(inbox);window.qaCatalog=()=>inbox.repository.catalog;window.qaConnectors=()=>connectorsFor(inbox);window.qaQuick=()=>quickFor(inbox);window.qaNotices=()=>noticesFor(inbox);window.qaResults=()=>resultsFor(inbox);window.qaDirectory=directory;window.qaWork=()=>directory.workRepo;window.qaInbox=inbox;window.qaModel=()=>qaInspect(inbox);window.qaLibrary=()=>qaInspectLibrary(inbox);window.qaAgenda=()=>qaInspectAgenda(inbox);const routes=['inbox','crm','studio','marketing','more'].map(name=>({key:name,name}));const crmRoot=['crm','contacts','library'].includes(screen);return <View style={{flex:1}}>{crmRoot?<><View style={{flex:1,display:screen==='library'?'none':'flex'}}><CrmScreen/></View>{screen==='library'&&<LibraryEntryScreen/>}</>:screen==='studio'?<StudioScreen initialSection='Conocimiento'/>:screen==='agents'?<StudioScreen/>:screen==='evaluation'?<EvaluationScreen/>:screen==='team'?<TeamScreen/>:screen==='calendar-settings'?<CalendarSettingsScreen/>:screen==='tags'?<TagsScreen/>:screen==='loss-reasons'?<LossReasonsScreen/>:screen==='opening'?<OpeningScreen/>:screen==='quick-replies'?<QuickScreen/>:screen==='notification-settings'?<NotificationSettingsScreen/>:screen==='usage'?<UsageScreen/>:screen==='plans'?<PlansScreen/>:screen==='usage-lab'?<UsageLabScreen/>:screen==='assistant'?<AssistantScreen/>:screen==='agent-editor'?<AgentEditorScreen/>:screen==='creator'?<CreatorScreen/>:screen==='results'?<ResultsScreen/>:screen==='work'?<WorkScreen/>:screen==='contact'?<ContactPage/>:screen==='agenda'?<AgendaScreen/>:screen==='more'?<ModuleScreen module='more' title='Más' task='T-M8'/>:screen==='chat'?<ConversationScreen chat={chats.get(window.qaChatId)}/>:<InboxScreen/>}{!['chat','agenda','library','work','contact','results','creator','agent-editor','evaluation','assistant','usage','plans','usage-lab','notification-settings','quick-replies','opening','tags','loss-reasons','calendar-settings','team'].includes(screen)&&<TabBar state={{index:screen==='inbox'?0:['studio','agents'].includes(screen)?2:screen==='more'?4:1,routes}} emitter={{emit:()=>({defaultPrevented:false})}} navigateToTab={()=>{}}/>}</View>}
function App(){const [v,setV]=useState(0);render=setV;return <InboxProvider key={epoch}><ChatProvider><ContactProvider><LayerProvider><Body/></LayerProvider></ContactProvider></ChatProvider></InboxProvider>};createRoot(document.getElementById('root')).render(<App/>);`;

const fonts = [
  ["400Regular", "Inter_400Regular"],
  ["500Medium", "Inter_500Medium"],
  ["600SemiBold", "Inter_600SemiBold"],
]
  .map(
    ([d, n]) =>
      `@font-face{font-family:${n};src:url(data:font/ttf;base64,${fs.readFileSync(path.join(root, "node_modules/@expo-google-fonts/inter", d, n + ".ttf")).toString("base64")})}`,
  )
  .join("");
async function compile(before) {
  const result = await build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
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
        name: "offline-fixtures",
        setup(b) {
          const bind = (f, k) =>
            b.onResolve({ filter: f }, () => ({
              path: k,
              namespace: "fixture",
            }));
          bind(/theme\/ThemeProvider$/, "theme");
          bind(/state\/SessionProvider$/, "session");
          bind(/services\/storage$/, "storage");
          bind(/^react-native-safe-area-context$/, "safe");
          bind(/^expo-router$/, "router");
          bind(/NativeSvgSoundModule$/, "sound");
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
            contents: mocks[a.path],
            loader: "tsx",
            resolveDir: root,
          }));
          b.onLoad({ filter: /src\/.*\.[jt]sx?$/ }, (a) => {
            const rel = path
              .relative(path.join(root, "src"), a.path)
              .replaceAll("\\", "/");
            let text;
            if (before && changedSources.includes(rel))
              text = execFileSync(
                "git",
                ["show", baseline + ":apps/mobile/src/" + rel],
                { cwd: root, encoding: "utf8" },
              );
            else if (
              rel === "features/crm/CrmScreen.tsx" ||
              rel === "features/agenda/AgendaScreen.tsx"
            )
              text = fs.readFileSync(a.path, "utf8");
            else return;
            if (rel === "features/crm/CrmScreen.tsx")
              text =
                text.replace(
                  "if (!session ||",
                  "window.qaActions = actions;\n  if (!session ||",
                ) +
                "\nexport const qaInspect = inbox => models.get(inbox); export const qaInspectLibrary = inbox => " +
                (text.includes("libraryFor(")
                  ? "libraryFor(inbox);"
                  : "libraries.get(inbox);");
            if (rel === "features/agenda/AgendaScreen.tsx")
              text +=
                "\nexport const qaInspectAgenda = inbox => agendaFor(inbox);";
            return { contents: text, loader: "tsx" };
          });
        },
      },
    ],
  });
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}html,body,#root{height:100%;margin:0;overflow:hidden}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style></head><body><div id="root"></div><script>${result.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
}
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  offline: true,
  viewport: { width: 390, height: 844 },
});
let requests = 0;
const errors = [];
await context.route("**/*", (r) => {
  requests++;
  return r.abort();
});
context.setDefaultTimeout(8000);
const checks = [];
async function mount(page, screen, theme = "light", role = "owner") {
  await page.evaluate(
    ({ screen, theme, role }) => window.mountRefinement(screen, theme, role),
    { screen, theme, role },
  );
  await page.waitForTimeout(100);
  if (screen === "contacts")
    await page.getByRole("tab", { name: "Contactos", exact: true }).click();
  await page.waitForTimeout(100);
}
try {
  if (process.argv.includes("--team")) {
    const { runTeam } = await import("./team-qa.mjs");
    await runTeam(context, await compile(false), root, () => requests);
  } else if (process.argv.includes("--calendar-settings")) {
    const { runCalendarSettings } = await import("./calendar-settings-qa.mjs");
    await runCalendarSettings(
      context,
      await compile(false),
      root,
      () => requests,
    );
  } else if (process.argv.includes("--catalog")) {
    const { runCatalog } = await import("./catalog-qa.mjs");
    await runCatalog(context, await compile(false), root, () => requests);
  } else if (process.argv.includes("--opening")) {
    const { runOpening } = await import("./opening-qa.mjs");
    await runOpening(context, await compile(false), root, () => requests);
  } else if (process.argv.includes("--quick")) {
    const { runQuick } = await import("./quick-qa.mjs");
    await runQuick(context, await compile(false), root, () => requests);
  } else if (process.argv.includes("--notices")) {
    const { runNotices } = await import("./notices-qa.mjs");
    await runNotices(context, await compile(false), root, () => requests);
  } else if (process.argv.includes("--usage")) {
    const { runUsage } = await import("./usage-qa.mjs");
    await runUsage(context, await compile(false), root, () => requests);
  } else if (process.argv.includes("--assistant")) {
    const { runAssistant } = await import("./assistant-qa.mjs");
    await runAssistant(context, await compile(false), root, () => requests);
  } else if (process.argv.includes("--evaluations")) {
    const { runEvaluations } = await import("./evaluations-qa.mjs");
    await runEvaluations(context, await compile(false), root, () => requests);
  } else if (process.argv.includes("--assignments")) {
    const { runAssignments } = await import("./assignments-qa.mjs");
    await runAssignments(context, await compile(false), root, () => requests);
  } else if (process.argv.includes("--versions")) {
    const { runVersions } = await import("./versions-qa.mjs");
    await runVersions(context, await compile(false), root, () => requests);
  } else if (process.argv.includes("--agents")) {
    const { runAgents } = await import("./agents-qa.mjs");
    await runAgents(context, await compile(false), root, () => requests);
  } else if (process.argv.includes("--knowledge")) {
    const { runKnowledge } = await import("./knowledge-qa.mjs");
    await runKnowledge(context, await compile(false), root, () => requests);
  } else if (process.argv.includes("--results")) {
    const { runResults } = await import("./results-qa.mjs");
    await runResults(context, await compile(false), root, () => requests);
  } else if (process.argv.includes("--work")) {
    const { runWork } = await import("./work-qa.mjs");
    await runWork(context, await compile(false), root, () => requests);
  } else if (process.argv.includes("--library")) {
    const { runLibrary } = await import("./library-qa.mjs");
    await runLibrary(context, await compile(false), root, () => requests);
  } else if (process.argv.includes("--agenda")) {
    const { runAgenda } = await import("./agenda-qa.mjs");
    await runAgenda(context, await compile(false), root, () => requests);
  } else {
    let after;
    for (const mode of ["before", "implemented"]) {
      const page = await context.newPage();
      page.on("pageerror", (e) => {
        errors.push(e.message);
        console.log("PAGE_ERROR", e.message);
      });
      await page.setContent(await compile(mode === "before"));
      await page.waitForFunction(() => window.mountRefinement);
      await page.evaluate(() => document.fonts.ready);
      for (const [w, h] of [
        [390, 844],
        [360, 640],
      ])
        for (const theme of ["light", "dark"])
          for (const screen of ["inbox", "contacts", "crm", "chat"]) {
            await page.setViewportSize({ width: w, height: h });
            await mount(page, screen, theme);
            await page.screenshot({
              path: path.join(out, `${mode}-${screen}-${theme}-${w}x${h}.png`),
            });
          }
      console.log("captured", mode);
      if (mode === "implemented") after = page;
      else await page.close();
    }
    const p = after;
    await p.setViewportSize({ width: 390, height: 844 });
    // Screen + layer + store integration, no handwritten layer host.
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
        await mount(p, "crm", theme);
        await p.evaluate((id) => {
          const m = window.qaModel();
          const first = m.list()[0].id;
          m.patch({ contactId: first });
          if (["CRM-01", "CRM-07", "CRM-10", "CRM-11", "CRM-17"].includes(id))
            m.navigate(id, first);
          else
            window.qaActions.onLayer(
              id,
              id === "CRM-07C" || id === "CRM-07D" ? "Nuevo" : undefined,
            );
        }, id);
        await p.waitForTimeout(80);
        await p.screenshot({
          path: path.join(out, `integrated-${id}-${theme}.png`),
        });
      }
    checks.push(
      "19 CRM IDs through real CrmScreen, providers and LayerProvider in both themes",
    );
    await mount(p, "inbox");
    await p.getByRole("button", { name: "Buscar", exact: true }).click();
    await p.getByRole("textbox", { name: "Buscar chats" }).fill("Karla");
    await p.getByRole("button", { name: /Karla Méndez,/ }).click();
    await p.getByRole("textbox", { name: "Mensaje", exact: true }).waitFor();
    checks.push("Inbox search opens real ConversationScreen with same stores");
    await mount(p, "contacts");
    await p
      .getByRole("textbox", { name: "Buscar nombre o teléfono" })
      .fill("Karla");
    await p.getByRole("button", { name: /Karla Méndez,/ }).click();
    await p.getByRole("button", { name: "Editar contacto" }).click();
    await p
      .getByRole("textbox", { name: "Nombre", exact: true })
      .fill("Karla Demo Editada");
    await p.getByRole("button", { name: "Guardar", exact: true }).click();
    await p.getByText("Karla Demo Editada", { exact: true }).waitFor();
    checks.push(
      "Contacts search-detail-edit through actual navigation and modal",
    );
    await mount(p, "crm", "light", "advisor");
    await p.getByRole("tab", { name: "Contactos", exact: true }).click();
    if (await p.getByRole("button", { name: /Karla Méndez,/ }).count())
      throw Error("Advisor saw foreign contact");
    checks.push("Advisor cannot see foreign contact");
    await mount(p, "inbox");
    const boxes = await p.getByRole("tab").evaluateAll((n) =>
      n
        .filter((x) =>
          ["Clientes", "Equipo", "Mi número"].includes(x.textContent),
        )
        .map((x) => ({
          text: x.textContent,
          width: x.getBoundingClientRect().width,
          height: x.getBoundingClientRect().height,
        })),
    );
    if (boxes.length !== 3 || boxes.some((b) => b.height < 48))
      throw Error("Selector touch targets");
    checks.push("Inbox selector targets >=48");
    if (errors.length || requests)
      throw Error(JSON.stringify({ errors, requests }));
    fs.writeFileSync(
      path.join(out, "results.json"),
      JSON.stringify(
        {
          baseline,
          implementedCaptures: 16,
          beforeCaptures: 16,
          integratedCrmCaptures: 38,
          checks,
          boxes,
          errors,
          networkRequests: requests,
          httpServerStarted: false,
          native: false,
          limitations: [
            "RN Web offline Chromium",
            "fixture session/theme/storage/router; actual UI/store/layers",
            "no full Expo Router or native keyboard validation",
          ],
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ captures: 70, checks, errors, requests }));
  }
} finally {
  await browser.close();
}
