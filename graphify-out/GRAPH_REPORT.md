# Graph Report - agenta  (2026-11-17)

## Corpus Check
- 4 files · ~1,540 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 1 file(s) not represented in the graph (top: (none) 1)

## Summary
- 23 nodes · 20 edges · 4 communities (3 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `085e1c21`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- README.md
- Find Skills
- How to Help Users Find Skills
- Skill consigliate per agenta

## God Nodes (most connected - your core abstractions)
1. `Find Skills` - 7 edges
2. `How to Help Users Find Skills` - 7 edges
3. `Skill consigliate per agenta` - 6 edges
4. `When to Use This Skill` - 1 edges
5. `What is the Skills CLI?` - 1 edges
6. `Step 1: Understand What They Need` - 1 edges
7. `Step 2: Check the Leaderboard First` - 1 edges
8. `Step 3: Search for Skills` - 1 edges
9. `Step 4: Verify Quality Before Recommending` - 1 edges
10. `Step 5: Present Options to the User` - 1 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities (4 total, 1 thin omitted)

### Community 1 - "Find Skills"
Cohesion: 0.29
Nodes (6): Common Skill Categories, Find Skills, Tips for Effective Searches, What is the Skills CLI?, When No Skills Are Found, When to Use This Skill

### Community 2 - "How to Help Users Find Skills"
Cohesion: 0.29
Nodes (7): How to Help Users Find Skills, Step 1: Understand What They Need, Step 2: Check the Leaderboard First, Step 3: Search for Skills, Step 4: Verify Quality Before Recommending, Step 5: Present Options to the User, Step 6: Offer to Install

### Community 3 - "Skill consigliate per agenta"
Cohesion: 0.29
Nodes (6): Da scartare, Dominio: calendario / agenda, Già installate, Opzionali, Skill consigliate per agenta, Sviluppo app (stack probabile web/mobile)

## Knowledge Gaps
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Find Skills` connect `Find Skills` to `How to Help Users Find Skills`?**
  _High betweenness centrality (0.247) - this node is a cross-community bridge._
- **Why does `How to Help Users Find Skills` connect `How to Help Users Find Skills` to `Find Skills`?**
  _High betweenness centrality (0.247) - this node is a cross-community bridge._