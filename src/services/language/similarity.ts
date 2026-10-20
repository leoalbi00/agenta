import { FUNCTION_WORDS, GENERIC_STEMS, conceptOf, stemOf, tokenize } from './lexicon';

/** Weights of the concepts named in a text */
export type ConceptBag = Map<string, number>;

const GENERIC_WEIGHT = 0.3;
const WORD_WEIGHT = 1;
/** Names ("Riccardo") identify a task better than common words */
const NAME_WEIGHT = 1.5;

/** Below this shared weight only generic verbs match, which says nothing ("andare" / "andare") */
const MIN_SHARED_WEIGHT = 0.5;
/** Share of a text's weight that must be found in the other for the two to name the same task */
const MIN_COVERAGE = 0.6;
/** A query may add at most one ordinary word to a title ("studiare per l'esame" / "Studiare"), not a name ("riunione con Paolo") */
const MAX_UNMATCHED_QUERY_WEIGHT = 1;

/** The concepts of a text, weighted by how much they identify a task */
export function conceptBag(text: string): ConceptBag {
  const bag: ConceptBag = new Map();
  tokenize(text).forEach((token, index) => {
    if (FUNCTION_WORDS.has(token.word) || /^\d+$/.test(token.word)) return;
    const isName = index > 0 && /^\p{Lu}/u.test(token.text);
    const weight = GENERIC_STEMS.has(stemOf(token.word)) ? GENERIC_WEIGHT : isName ? NAME_WEIGHT : WORD_WEIGHT;
    const concept = conceptOf(token.word);
    bag.set(concept, Math.max(bag.get(concept) ?? 0, weight));
  });
  return bag;
}

export function totalWeight(bag: ConceptBag): number {
  return [...bag.values()].reduce((sum, weight) => sum + weight, 0);
}

/** Concepts match if one is a prefix of the other ("studi" / "studio") */
function sameConcept(a: string, b: string): boolean {
  return a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));
}

export interface Similarity {
  /** Weight of the query's concepts found in the title */
  shared: number;
  /** Weight of the query's concepts not in the title */
  unmatched: number;
  /** Share of the query's weight found in the title */
  queryCoverage: number;
  /** Share of the title's weight found in the query */
  titleCoverage: number;
}

export function similarity(query: ConceptBag, title: ConceptBag): Similarity {
  let shared = 0;
  let titleShared = 0;
  for (const [concept, weight] of query) {
    if ([...title.keys()].some((other) => sameConcept(concept, other))) shared += weight;
  }
  for (const [concept, weight] of title) {
    if ([...query.keys()].some((other) => sameConcept(concept, other))) titleShared += weight;
  }
  return {
    shared,
    unmatched: totalWeight(query) - shared,
    queryCoverage: shared / (totalWeight(query) || 1),
    titleCoverage: titleShared / (totalWeight(title) || 1),
  };
}

/**
 * True if the two name the same task: they share more than generic verbs, and most of the query is
 * in the title, or the title is in the query with little added ("vado a mangiare" / "Andare a mangiare
 * a casa"; not "chiamare Marco" / "Chiamare la nonna", nor "riunione con Paolo" / "Riunione").
 */
export function isMatch({ shared, unmatched, queryCoverage, titleCoverage }: Similarity): boolean {
  if (shared < MIN_SHARED_WEIGHT) return false;
  return queryCoverage >= MIN_COVERAGE || (titleCoverage >= MIN_COVERAGE && unmatched <= MAX_UNMATCHED_QUERY_WEIGHT);
}

/** How well a match fits, to choose among several */
export function matchScore({ shared, queryCoverage, titleCoverage }: Similarity): number {
  return shared + queryCoverage + titleCoverage;
}
