import type { TaskCategory } from '../../types';

/** Lowercase, without accents and with plain apostrophes: the form all comparisons use */
export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'");
}

export interface Token {
  /** As written */
  text: string;
  /** normalizeWord(text) */
  word: string;
  start: number;
  end: number;
}

/** Words and numbers with their position; apostrophes split words ("l'agenda" -> "l", "agenda") */
export function tokenize(text: string): Token[] {
  return [...text.matchAll(/[\p{L}\d]+/gu)].map((match) => ({
    text: match[0],
    word: normalizeWord(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/** Pronouns attached to an infinitive ("andarci", "farlo", "spostarla") */
const CLITIC_SUFFIX = /(ar|er|ir)(ci|vi|lo|la|li|le|ne|mi|ti|si|gli|celo|cela|mela|melo)$/;

/** Forms that don't share their first letters with the infinitive */
const IRREGULAR_LEMMAS: Record<string, string> = {
  vado: 'andare', vai: 'andare', va: 'andare', andiamo: 'andare', vanno: 'andare', andro: 'andare', andrei: 'andare',
  faccio: 'fare', fai: 'fare', fa: 'fare', facciamo: 'fare', fanno: 'fare', faro: 'fare', farei: 'fare', far: 'fare',
  esco: 'uscire', esci: 'uscire', esce: 'uscire',
  devo: 'dovere', devi: 'dovere', deve: 'dovere', dovrei: 'dovere', dovro: 'dovere',
  posso: 'potere', puoi: 'potere', puo: 'potere', potrei: 'potere', potro: 'potere',
  voglio: 'volere', vuoi: 'volere', vorrei: 'volere',
  ho: 'avere', hai: 'avere', ha: 'avere', avro: 'avere',
  sono: 'essere', sei: 'essere', siamo: 'essere', saro: 'essere',
  sto: 'stare', stai: 'stare', sta: 'stare',
  bevo: 'bere', bevi: 'bere',
};

/** Endings removed to reach the stem, longest first */
const SUFFIXES = [
  'erebbe', 'arono', 'erono', 'irono', 'zioni', 'zione', 'iamo', 'ando', 'endo',
  'are', 'ere', 'ire', 'ato', 'ata', 'ati', 'ate', 'uto', 'uta', 'ito', 'ita', 'iti', 'ano', 'ono', 'avo', 'evo', 'ivo', 'ero',
  'o', 'a', 'i', 'e',
];

/** Root shared by the forms of a word: "parlo", "parlare", "parla" -> "parl" */
export function stemOf(word: string): string {
  let lemma = IRREGULAR_LEMMAS[word] ?? word;
  const clitic = CLITIC_SUFFIX.exec(lemma);
  if (clitic) {
    lemma = `${lemma.slice(0, clitic.index)}${clitic[1]}e`;
  }
  for (const suffix of SUFFIXES) {
    if (lemma.endsWith(suffix) && lemma.length - suffix.length >= 3) {
      return lemma.slice(0, -suffix.length);
    }
  }
  return lemma;
}

/** "andarci", "farlo": a verb pointing back to something already said */
export function hasClitic(word: string): boolean {
  return CLITIC_SUFFIX.test(word) && !FUNCTION_WORDS.has(word);
}

/** Stems naming the same activity are compared as one concept */
const CONCEPTS: Record<string, string> = {
  mangi: 'pasto', pranz: 'pasto', cen: 'pasto', colazion: 'pasto', merend: 'pasto', spuntin: 'pasto', aperitiv: 'pasto',
  studi: 'studio', ripass: 'studio',
  palestr: 'allenamento', allen: 'allenamento', allenament: 'allenamento',
  chiam: 'chiamata', telefon: 'chiamata',
  riunion: 'riunione', meeting: 'riunione', call: 'riunione',
  spes: 'spesa', supermercat: 'spesa',
};

export function conceptOf(word: string): string {
  const stem = stemOf(word);
  return CONCEPTS[stem] ?? stem;
}

/** Words that carry no meaning about which task is meant */
export const FUNCTION_WORDS = new Set([
  // articles and prepositions
  'il', 'lo', 'la', 'i', 'gli', 'le', 'l', 'un', 'uno', 'una',
  'di', 'a', 'ad', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra',
  'del', 'dello', 'della', 'dei', 'degli', 'delle', 'dell', 'al', 'allo', 'alla', 'ai', 'agli', 'alle', 'all',
  'dal', 'dallo', 'dalla', 'dai', 'dagli', 'dalle', 'dall', 'nel', 'nello', 'nella', 'nei', 'negli', 'nelle', 'nell',
  'col', 'coi', 'sul', 'sullo', 'sulla', 'sui', 'sugli', 'sulle', 'sull',
  // conjunctions, pronouns, adverbs
  'e', 'ed', 'o', 'ma', 'pero', 'poi', 'quindi', 'che', 'se', 'perche', 'anche', 'inoltre', 'cosi',
  'io', 'mi', 'ti', 'ci', 'vi', 'si', 'ne', 'me', 'te', 'c', 'mio', 'mia', 'miei', 'mie',
  'cio', 'quello', 'quella', 'quelli', 'quelle', 'riguarda', 'riguardano', 'relativo', 'relativa',
  'non', 'magari', 'forse', 'meglio', 'piuttosto', 'anzi', 'ora', 'adesso', 'gia', 'ancora', 'solo', 'sempre',
  'piu', 'molto', 'po', 'circa', 'verso', 'entro', 'oggi', 'domani', 'dopodomani', 'stasera', 'stamattina',
  // modal and auxiliary verbs
  'devo', 'devi', 'deve', 'dobbiamo', 'dovrei', 'dovro', 'posso', 'puoi', 'puo', 'possiamo', 'potrei', 'potro',
  'voglio', 'vuoi', 'vorrei', 'ho', 'hai', 'ha', 'abbiamo', 'avro', 'sono', 'sei', 'siamo', 'saro', 'sto', 'stai',
  'bisogna', 'tocca', 'penso', 'credo', 'riesco', 'riuscire', 'riusciro', 'facciamo', 'diciamo',
  'ricordami', 'ricordati', 'ricorda',
]);

/** Verbs too common to tell tasks apart ("andare a parlare con Riccardo" vs "andare in palestra") */
export const GENERIC_STEMS = new Set(
  ['andare', 'fare', 'dovere', 'potere', 'volere', 'avere', 'essere', 'stare', 'uscire', 'tornare', 'passare', 'prendere',
    'mettere', 'finire', 'iniziare', 'cominciare', 'cosa', 'tempo', 'vado'].map(stemOf),
);

/** Conjugated verbs of motion that open a sentence but aren't the task ("vado a mangiare" -> "Mangiare") */
export const LEADING_MOTION_VERBS = new Set(['vado', 'vai', 'va', 'andiamo', 'devo', 'passo', 'esco', 'faccio']);

/** Word prefixes per category, checked in order */
const CATEGORY_KEYWORDS: [TaskCategory, string[]][] = [
  ['health', ['palestra', 'medic', 'dottor', 'dentist', 'allenament', 'allenarm', 'corsa', 'correre', 'yoga', 'pilates', 'visita', 'farmacia', 'nuot', 'cammin', 'fisioterap']],
  ['study', ['studi', 'esame', 'lezion', 'ripass', 'compit', 'corso', 'universit', 'libro', 'legger', 'pagin', 'capitol', 'tesi']],
  ['work', ['lavor', 'riunion', 'meeting', 'call', 'mail', 'email', 'client', 'progett', 'ufficio', 'report', 'presentazion', 'colloqui']],
  ['chores', ['spesa', 'pulir', 'pulis', 'pulizi', 'lavatric', 'bucato', 'cucinar', 'stirar', 'bollett', 'piatti', 'aspirapolvere', 'riordin', 'supermercato']],
];

/** The category named by the words, if any */
export function findCategory(words: string[]): TaskCategory | undefined {
  return CATEGORY_KEYWORDS.find(([, prefixes]) =>
    words.some((word) => prefixes.some((prefix) => word.startsWith(prefix))),
  )?.[0];
}

/** Meals and trips: they last at least half an hour unless said otherwise */
const MEAL_OR_TRAVEL_PREFIXES = [
  'pranz', 'cena', 'cenare', 'colazion', 'aperitiv', 'merend', 'spuntin', 'brunch', 'mangia',
  'andare', 'tornare', 'rientrare', 'spostament', 'viaggi', 'tragitt', 'raggiunger', 'accompagnar', 'guidare',
];

export function isMealOrTravel(words: string[]): boolean {
  return words.some((word) => MEAL_OR_TRAVEL_PREFIXES.some((prefix) => word.startsWith(prefix)));
}

export interface Cues {
  /** "elimina tutto", "cancella la giornata", "reset" */
  clearAll: boolean;
  /** "elimina", "cancella", "togli" */
  remove: boolean;
  /** "tutti", "tutte": every matching task */
  everyMatch: boolean;
  /** "ci metto più tempo", "allunga", "mi servono altri 20 minuti" */
  extend: boolean;
  /** "posticipa", "sposta", "sono in ritardo" */
  delay: boolean;
  /** "non riesco", "non penso di riuscire", "non arrivo" */
  negatedAbility: boolean;
  /** "arrivo", "torno", "sono libero": with a time, it bounds when things can start */
  arrival: boolean;
  /** Words used only to express the intent: never part of a task name */
  cueWords: Set<string>;
}

const REMOVE_PREFIXES = ['elimin', 'cancell', 'rimuov', 'togli', 'svuot', 'reset', 'azzer'];
export const WHOLE_DAY_WORDS = new Set(['tutto', 'tutti', 'tutte', 'giornata', 'agenda', 'calendario', 'impegni', 'attivita', 'task', 'lista', 'programma']);
const EXTEND_VERBS = new Set(['metto', 'mettero', 'vuole', 'vorra', 'serve', 'servono', 'servira', 'occorre', 'bisogno', 'dura', 'durera', 'richiede', 'richiedera']);
const MORE_WORDS = new Set(['piu', 'altro', 'altri', 'altre', 'ancora']);
const DELAY_PREFIXES = ['posticip', 'rimand', 'ritard', 'slitt', 'spost', 'anticip'];
const ABILITY_WORDS = new Set(['riesco', 'riusciro', 'riuscire', 'posso', 'potro', 'potrei', 'arrivo', 'arrivero', 'arrivare', 'torno', 'tornero', 'rientro', 'farcela', 'ce', 'sono', 'saro']);
const ARRIVAL_WORDS = new Set(['arrivo', 'arrivero', 'torno', 'tornero', 'rientro', 'libero', 'libera']);

/** Reads what the words ask for, independently of their order */
export function detectCues(words: string[]): Cues {
  const cueWords = new Set<string>();
  const mark = (...marked: string[]) => marked.forEach((word) => cueWords.add(word));
  const has = (word: string) => words.includes(word);

  const removeWords = words.filter((word) => REMOVE_PREFIXES.some((prefix) => word.startsWith(prefix)));
  const remove = removeWords.length > 0;
  mark(...removeWords);
  const wholeDay = words.filter((word) => WHOLE_DAY_WORDS.has(word));
  const otherWords = words.filter(
    (word) => !FUNCTION_WORDS.has(word) && !removeWords.includes(word) && !WHOLE_DAY_WORDS.has(word),
  );
  // "reset", "svuota", or a removal of "tutto / la giornata" that names nothing else
  const clearAll =
    remove &&
    otherWords.length === 0 &&
    (wholeDay.length > 0 || removeWords.some((word) => /^(reset|svuot|azzer)/.test(word)));
  const everyMatch = remove && words.some((word) => word === 'tutti' || word === 'tutte' || word === 'tutto');
  if (remove) mark(...wholeDay);

  const extendWords = words.filter(
    (word, index) =>
      /^(allung|prolung|estend)/.test(word) ||
      (EXTEND_VERBS.has(word) && words.slice(index + 1, index + 5).some((next) => MORE_WORDS.has(next))) ||
      (word === 'piu' && words[index - 1] === 'in'),
  );
  const extend = extendWords.length > 0 || (has('altri') && has('minuti'));
  if (extend) mark(...extendWords, ...MORE_WORDS, 'tempo', 'bisogno', 'metto', 'serve', 'servono', 'altri');

  const negationIndex = words.indexOf('non');
  const afterNegation = negationIndex >= 0 ? words.slice(negationIndex + 1, negationIndex + 5) : [];
  const negatedAbility =
    afterNegation.some((word) => ABILITY_WORDS.has(word)) &&
    // "non prima delle 14" is a window, not an ability
    afterNegation[0] !== 'prima';
  if (negatedAbility) mark('non', ...afterNegation.filter((word) => ABILITY_WORDS.has(word) || word === 'tempo'));

  const delayWords = words.filter((word) => DELAY_PREFIXES.some((prefix) => word.startsWith(prefix)) || word === 'tardi');
  const delay = delayWords.length > 0;
  mark(...delayWords, 'avanti');

  const arrivalWords = words.filter((word) => ARRIVAL_WORDS.has(word));
  mark(...arrivalWords);

  return {
    clearAll,
    remove,
    everyMatch,
    extend,
    delay,
    negatedAbility,
    arrival: arrivalWords.length > 0,
    cueWords,
  };
}
