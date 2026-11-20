"""Static traceability, not a substitute for executing each screen's QA."""
import csv, hashlib, json, re, sys
from pathlib import Path
root=Path(__file__).resolve().parent.parent
rows=list(csv.DictReader((root/'docs/cobertura.csv').open()))
reference='docs/reference/dashfort-mobile-prototipo.html'
text=(root/reference).read_text()
defs={m.group(1):text[:m.start()].count('\n')+1 for m in re.finditer(r"def\('([^']+)'",text)}
assert len(rows)==158 and len({r['ID'] for r in rows})==158
assert {r['ID'] for r in rows}==set(defs)
assert all(r['Estado'].startswith('Implementada') for r in rows)

def group(i):
 p,n=i.split('-'); k=int(re.match(r'\d+',n).group())
 if p=='AUTH':return ('src/features/opening/OpeningScreen.tsx' if k==1 else 'src/screens/Access.tsx','app/index.tsx' if k==1 else 'app/login.tsx','tests/opening.test.ts' if k==1 else 'tests/foundation.test.ts')
 if p=='INB':
  if k<=10:return ('src/features/inbox/InboxScreen.tsx','app/(tabs)/inbox.tsx','tests/inbox.test.ts')
  if k in [19,20,21,22,23,24,25,26,30]:return ('src/features/contact/HistoryScreen.tsx' if k==20 else 'src/features/contact/DetailsScreen.tsx' if k==19 else 'src/features/contact/Sheets.tsx','app/contact/[id].tsx','tests/contact.test.ts')
  if k==27:return ('app/media/[id].tsx','app/media/[id].tsx','tests/chat.test.ts')
  return ('src/features/chat/ConversationScreen.tsx' if k in [11,12,29] else 'src/features/chat/Sheets.tsx','app/conversation/[id].tsx','tests/chat.test.ts')
 if p=='EQP':return ('src/features/team-chat/Screens.tsx','app/internal-chat/[id].tsx' if k in [2,5,6] else 'app/internal-info/[id].tsx' if k==4 else 'app/(tabs)/inbox.tsx','tests/team-chat.test.ts')
 if p=='NUM':return ('src/features/personal/Chats.tsx','app/(tabs)/inbox.tsx' if k in [1,4] else 'app/personal-chat.tsx','tests/personal.test.ts')
 if p=='CRM':
  if k>=40:return ('src/features/library/LibraryView.tsx','app/library/[id].tsx' if k==41 else 'app/(tabs)/crm.tsx','tests/library.test.ts')
  if k>=30:return ('src/features/work/WorkScreen.tsx','app/work.tsx','tests/work.test.ts')
  if k>=20:return ('src/features/agenda/AgendaScreen.tsx','app/agenda.tsx','tests/agenda.test.ts')
  return ('src/features/crm/CrmView.tsx' if k in [1,10] else 'src/features/crm/CrmOverlay.tsx','app/(tabs)/crm.tsx','tests/crm-offline.test.ts')
 if p=='LAB':
  if k>=30:return ('src/features/studio/Evaluations.tsx','app/studio-evaluation/[id].tsx' if k==31 else 'app/(tabs)/studio.tsx','tests/studio-evaluations.test.ts')
  if k>=20:return ('src/features/studio/Assignments.tsx','app/(tabs)/studio.tsx','tests/studio-assignments.test.ts')
  if k>=10:return ('src/features/knowledge/KnowledgeScreen.tsx','app/(tabs)/studio.tsx','tests/knowledge.test.ts')
  return ('src/features/studio/StudioScreen.tsx' if k==1 else 'src/features/studio/AgentScreens.tsx' if k in [2,3,4] else 'src/features/studio/overlays.tsx','app/(tabs)/studio.tsx','tests/studio-versions.test.ts' if k in [5,6,7] else 'tests/studio-agents.test.ts')
 if p=='MKT':return ('src/features/templates/Screens.tsx' if 20<=k<30 else 'src/features/marketing/Screens.tsx','app/(tabs)/marketing.tsx','tests/templates.test.ts' if 20<=k<30 else 'tests/marketing.test.ts')
 if p=='MORE':
  if k in [1,8]:return ('src/features/more/Screens.tsx','app/(tabs)/more.tsx','tests/final-screens.test.ts')
  if k==5:return ('src/features/notices/NoticeScreens.tsx','app/(tabs)/more.tsx','tests/notices.test.ts')
  return ('src/features/usage/UsageScreens.tsx','app/usage.tsx','tests/studio-usage.test.ts')
 if p=='RES':return ('src/features/results/ResultsScreen.tsx','app/results.tsx','tests/results.test.ts')
 if p=='AST':return ('src/features/studio/AssistantScreen.tsx','app/assistant.tsx','tests/studio-assistant.test.ts')
 if p=='PLT':return ('src/features/platform/Screens.tsx',f'app/platform-{["panel","organizations","detail"][k-1]}.tsx','tests/final-screens.test.ts')
 if p=='DS':return ('app/design/[id].tsx','app/design/[id].tsx','tests/foundation.test.ts')
 if p=='SET':
  if k==1:return ('src/features/more/Screens.tsx','app/settings.tsx','tests/final-screens.test.ts')
  if k in [2,4]:return ('src/features/channels/Screens.tsx','app/ads-settings.tsx' if k==4 else 'app/channel-settings.tsx','tests/channels.test.ts')
  if k==3:return ('src/features/team/TeamScreen.tsx','app/team.tsx','tests/team.test.ts')
  if k in [5,7]:return ('src/features/catalog/CatalogScreens.tsx','app/tags.tsx' if k==5 else 'app/loss-reasons.tsx','tests/catalog.test.ts')
  if k==6:return ('src/features/quick/QuickScreen.tsx','app/quick-replies.tsx','tests/quick.test.ts')
  if k==8:return ('src/features/calendar-settings/CalendarSettingsScreen.tsx','app/calendar-settings.tsx','tests/calendar-settings.test.ts')
  if k==9:return ('src/features/team-chat/Screens.tsx','app/internal-settings.tsx','tests/team-chat.test.ts')
  if k==10:return ('src/features/optout/Screen.tsx','app/optout.tsx','tests/optout.test.ts')
  if k in [11,12]:return ('src/features/ai-connector/Screens.tsx','app/my-ai.tsx' if k==11 else 'app/ai-connector-settings.tsx','tests/ai-connector.test.ts')
  if k==13:return ('src/features/personal/Settings.tsx','app/personal-settings.tsx','tests/personal.test.ts')
  if k==14:return ('src/features/notices/NoticeScreens.tsx','app/notification-settings.tsx','tests/notices.test.ts')
  if k>=15:return ('src/features/personalization/Screens.tsx',f'app/{["appearance","brand","navigation-settings"][k-15]}.tsx','tests/final-screens.test.ts')
 raise ValueError(i)
result=[]
new={'PLT-01','PLT-02','PLT-03','SET-01','SET-15','SET-16','SET-17','MORE-01'}
for r in rows:
 files=group(r['ID'])
 for f in files:assert (root/f).is_file(),(r['ID'],f)
 result.append({'id':r['ID'],'title':r['Pantalla'],'implemented':'local simulation','approvedDefinition':{'file':reference,'line':defs[r['ID']]},'implementation':files[0],'entryFile':files[1],'logicTests':files[2],'webQA':'final-screens:46 checks' if r['ID'] in new else r['Estado'],'webEvidence':'docs/refinement-b/evidence/final-screens/comparacion.html' if r['ID'] in new else 'Historical evidence in docs/tm2, docs/tm3, docs/tm4 and docs/refinement-b; current regression summary in CHECKPOINT-158.md','nativeQA':'pending for 0.1.3','realIntegration':'pending; never authorized by coverage'})
report={'total':158,'implemented':158,'pending':[],'definitionSetMatches':True,'scope':'Design IDs include states, sheets and dialogs, not 158 independent routes. This verifier checks traceability, not runtime completeness. Prior 150 accepted at 9e50c40; final 8 executed in this lot.','sourceInventorySha256':hashlib.sha256((root/'docs/cobertura.csv').read_bytes()).hexdigest(),'screens':result}
destination=root/'docs/refinement-b/INVENTARIO-158.json'
if '--write' in sys.argv:destination.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
else:assert json.loads(destination.read_text())==report,'Regenerate traceability after reviewed inventory change.'
print(json.dumps({k:v for k,v in report.items() if k!='screens'},ensure_ascii=False))
