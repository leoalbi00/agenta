# Skill consigliate per agenta

Ricerca fatta il 2026-11-17 con la skill `find-skills` (installata in `.claude/skills/find-skills`).
Nota: `npx skills find` era bloccato dalla rete dell'ambiente cloud, quindi la ricerca è stata fatta sulle pagine di skills.sh. Prima di installare una skill, controlla installazioni, stelle e audit di sicurezza sulla sua pagina.

## Già installate
| Skill | A cosa serve |
|---|---|
| `find-skills` (vercel-labs/skills) | Cercare e installare altre skill |
| `graphify` | Grafo della conoscenza del repo (`graphify-out/`) |

## Dominio: calendario / agenda
| Skill | Perché | Install |
|---|---|---|
| [google-calendar — odyssey4me/agent-skills](https://www.skills.sh/odyssey4me/agent-skills/google-calendar) | Eventi, disponibilità, slot liberi con Google Calendar | `npx skills add odyssey4me/agent-skills --skill google-calendar` |
| [google-calendar — dotneet/claude-code-marketplace](https://www.skills.sh/dotneet/claude-code-marketplace/google-calendar) | Calendar + Google Tasks (OAuth desktop) | `npx skills add dotneet/claude-code-marketplace --skill google-calendar` |
| [google-calendar — sanjay3290/ai-skills](https://www.skills.sh/sanjay3290/ai-skills/google-calendar) | CRUD eventi + free time (solo account Workspace) | `npx skills add sanjay3290/ai-skills --skill google-calendar` |
| [googleworkspace/cli](https://www.skills.sh/googleworkspace/cli/recipe-find-free-time) | Ricette ufficiali: find-free-time, plan-weekly-schedule, calendar-insert, cancel-and-notify | `npx skills add googleworkspace/cli` |
| [calendar-automation — claude-office-skills](https://www.skills.sh/claude-office-skills/skills/calendar-automation) | Automazioni di calendario | `npx skills add claude-office-skills/skills --skill calendar-automation` |
| [syncfusion-react-scheduler](https://www.skills.sh/syncfusion/react-ui-components-skills/syncfusion-react-scheduler) | Se la UI usa il componente Scheduler Syncfusion (viste, ricorrenze) | `npx skills add syncfusion/react-ui-components-skills --skill syncfusion-react-scheduler` |

## Sviluppo app (stack probabile web/mobile)
| Skill | Perché | Install |
|---|---|---|
| [frontend-design — anthropics/skills](https://www.skills.sh/anthropics/skills) | UI curata (~1.1M installazioni) | `npx skills add anthropics/skills --skill frontend-design` |
| vercel-react-best-practices — vercel-labs/agent-skills | Best practice React/Next.js | `npx skills add vercel-labs/agent-skills --skill vercel-react-best-practices` |
| vercel-composition-patterns — vercel-labs/agent-skills | Pattern di composizione componenti (~458K) | `npx skills add vercel-labs/agent-skills --skill vercel-composition-patterns` |
| vercel-react-native-skills — vercel-labs/agent-skills | Se agenta diventa app mobile (~280K) | `npx skills add vercel-labs/agent-skills --skill vercel-react-native-skills` |
| supabase-postgres-best-practices — supabase/agent-skills | Backend/DB per eventi e utenti (~488K) | `npx skills add supabase/agent-skills --skill supabase-postgres-best-practices` |

## Opzionali
- [scheduler — jshchnz/claude-code-scheduler](https://www.skills.sh/jshchnz/claude-code-scheduler/scheduler): linguaggio naturale → cron. Utile come riferimento per il parsing di "ogni lunedì alle 9".

## Da scartare
- `content-calendar` (social media), `laravel-task-scheduling` (solo se il backend è Laravel), `xauusd-calendar-agent` (trading).
