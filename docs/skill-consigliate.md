# Skill consigliate per agenta

Ricerca fatta il 2026-11-17 con `npx skills find` (skill `find-skills`, in `.claude/skills/find-skills`).
Le installazioni sono quelle di skills.sh in quella data. Prima di installare, controlla la pagina su https://skills.sh/<owner>/<repo>/<skill>.

> Negli ambienti cloud Claude, la CLI `skills` di Node non usa il proxy da sola. Lanciala con:
> `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt npx skills find <query>`

## Già installate
| Skill | A cosa serve |
|---|---|
| `vercel-labs/skills@find-skills` | Cercare e installare altre skill |
| `graphify` | Grafo della conoscenza del repo (`graphify-out/`) |

## Consigliate subito (indipendenti dallo stack)
| Skill | Installazioni | Perché |
|---|---|---|
| `anthropics/skills@frontend-design` | 1.1M | Interfaccia curata, non "generica" |
| `nextlevelbuilder/ui-ux-pro-max-skill@ui-ux-pro-max` | 456K | Linee guida UI/UX (palette, tipografia, componenti) |
| `anthropics/skills@webapp-testing` | 207K | Test dell'app web con Playwright |

## Dominio: calendario, agenda, promemoria
| Skill | Installazioni | Perché |
|---|---|---|
| `googleworkspace/cli@gws-calendar` | 64K | Integrazione ufficiale Google Calendar |
| `googleworkspace/cli@gws-calendar-agenda` | 51.6K | Leggere l'agenda (eventi di oggi/settimana) |
| `googleworkspace/cli@gws-calendar-insert` | 50.1K | Creare eventi con invitati e link Meet |
| `caffeinelabs/skills@connector-googlecalendar` | 26.1K | Connettore Google Calendar alternativo |
| `claude-office-skills/skills@calendar-automation` | 6.3K | Automazioni di calendario |
| `anthropics/knowledge-work-plugins@task-management` | 7.4K | Gestione attività/to-do |
| `odyssey4me/agent-skills@google-calendar` | 1.2K | Disponibilità e slot liberi (Python) |

Outlook, meeting scheduler, time blocking: solo skill con meno di 150 installazioni, da evitare per ora.

## Se lo stack è Next.js / React (web)
| Skill | Installazioni | Perché |
|---|---|---|
| `vercel-labs/agent-skills@vercel-react-best-practices` | 906K | Best practice React/Next.js |
| `wshobson/agents@nextjs-app-router-patterns` | 34.2K | Pattern App Router |
| `vercel/ai@ai-sdk` | 73.3K | Parte "intelligente": LLM, tool calling, streaming |
| `clerk/skills@clerk-nextjs-patterns` | 56.3K | Solo se usate Clerk per il login |

## Backend / database
| Skill | Installazioni | Perché |
|---|---|---|
| `supabase/agent-skills@supabase-postgres-best-practices` | 488.6K | Schema e query Postgres su Supabase |
| `supabase/agent-skills@supabase` | 367.9K | Auth, storage, realtime Supabase |
| `prisma/skills@prisma-postgres` | 422.3K | Alternativa: Prisma + Postgres |
| `neondatabase/agent-skills@neon-postgres` | 313.4K | Alternativa: Neon |

Scegline uno solo, in base al backend.

## Se agenta diventa app mobile
| Skill | Installazioni | Perché |
|---|---|---|
| `vercel-labs/agent-skills@vercel-react-native-skills` | 279.9K | React Native |
| `callstackincubator/agent-skills@react-native-best-practices` | 32.7K | Performance React Native |
| `expo/skills@expo-dev-client`, `expo-deployment` | 76.6K / 40.2K | Se usate Expo |
| `dpearson2699/swift-ios-skills@push-notifications` | 4.5K | Promemoria push (iOS nativo) |
| `capawesome-team/skills@capacitor-push-notifications` | 1.6K | Promemoria push (Capacitor) |

## Test
| Skill | Installazioni | Perché |
|---|---|---|
| `microsoft/playwright-cli@playwright-cli` | 218.9K | Playwright ufficiale |
| `currents-dev/playwright-best-practices-skill@playwright-best-practices` | 108K | Best practice test E2E |

## Installazione
```bash
npx skills add anthropics/skills --skill frontend-design -a claude-code -y
```
Con `-a claude-code` la skill finisce in `.claude/skills/` del progetto e viene registrata in `skills-lock.json`.
