/**
 * Article classification based on infobox types and content analysis
 *
 * Maps 100+ infobox types to 6 primary categories
 */

import type { Article, ArticleType, ClassifiedArticle } from './types.js';

/**
 * Infobox type mappings to article categories
 *
 * Each category has primary patterns (exact matches) and secondary patterns (partial matches)
 */
const INFOBOX_MAPPINGS: Record<ArticleType, { primary: string[]; patterns: RegExp[] }> = {
  person: {
    primary: [
      // General person types
      'person',
      'biography',
      'individual',

      // Professions
      'actor',
      'actress',
      'artist',
      'astronaut',
      'athlete',
      'author',
      'aviator',
      'boxer',
      'chef',
      'chess player',
      'comedian',
      'comics creator',
      'criminal',
      'cyclist',
      'dancer',
      'director',
      'dj',
      'economist',
      'engineer',
      'entrepreneur',
      'fashion designer',
      'figure skater',
      'football biography',
      'football player',
      'golfer',
      'gymnast',
      'hockey player',
      'ice hockey player',
      'journalist',
      'judge',
      'martial artist',
      'medical person',
      'military person',
      'model',
      'monarch',
      'musical artist',
      'musician',
      'nfl biography',
      'nba biography',
      'nobility',
      'philosopher',
      'photographer',
      'physicist',
      'pilot',
      'playwright',
      'poet',
      'poker player',
      'politician',
      'presenter',
      'president',
      'prime minister',
      'professional wrestler',
      'racing driver',
      'religious biography',
      'royalty',
      'rugby biography',
      'rugby league biography',
      'saint',
      'scholar',
      'scientist',
      'singer',
      'skier',
      'soldier',
      'sportsperson',
      'swimmer',
      'tennis biography',
      'tennis player',
      'volleyball biography',
      'writer',
      'youtube personality',

      // Historical figures
      'pharaoh',
      'pope',
      'emperor',
      'samurai',
    ],
    patterns: [
      /^(basketball|baseball|football|hockey|soccer|cricket|rugby)\s+(player|biography)/i,
      /^(nfl|nba|mlb|nhl|mls)\s+/i,
      /player$/i,
      /biography$/i,
      /^(office ?holder|officeholder)$/i,
      /^(governor|senator|representative|congressman|minister)$/i,
    ],
  },

  place: {
    primary: [
      // Geographic entities
      'country',
      'city',
      'town',
      'village',
      'settlement',
      'municipality',
      'county',
      'state',
      'province',
      'region',
      'territory',
      'district',
      'prefecture',
      'borough',
      'commune',
      'parish',

      // Physical geography
      'mountain',
      'river',
      'lake',
      'island',
      'ocean',
      'sea',
      'bay',
      'peninsula',
      'desert',
      'forest',
      'national park',
      'park',
      'volcano',
      'glacier',
      'valley',
      'canyon',
      'cave',
      'waterfall',
      'beach',
      'reef',

      // Built environment
      'building',
      'skyscraper',
      'tower',
      'bridge',
      'dam',
      'lighthouse',
      'stadium',
      'arena',
      'airport',
      'station',
      'hospital',
      'prison',
      'castle',
      'palace',
      'monument',
      'cemetery',
      'zoo',
      'aquarium',
      'museum',

      // Religious buildings
      'church',
      'cathedral',
      'mosque',
      'temple',
      'synagogue',
      'monastery',

      // Transportation
      'road',
      'highway',
      'motorway',
      'railway',
      'rail line',
      'metro',
      'tram',
      'port',
      'harbor',

      // Administrative
      'protected area',
      'world heritage site',
      'historic site',
    ],
    patterns: [
      /^(us|uk|australian|canadian|french|german|indian|chinese|japanese)\s+(city|state|county|town)/i,
      /\s+(city|town|village|county|district|station|airport|park)$/i,
      /^(settlement|place)/i,
      /^(nrhp|historic)/i,
    ],
  },

  org: {
    primary: [
      // Business
      'company',
      'corporation',
      'business',
      'startup',
      'bank',
      'airline',
      'publisher',
      'record label',
      'software',

      // Government
      'government agency',
      'legislature',
      'political party',
      'ministry',
      'department',
      'court',
      'parliament',

      // Education
      'university',
      'college',
      'school',
      'institute',
      'academy',
      'library',

      // Sports
      'football club',
      'basketball team',
      'baseball team',
      'hockey team',
      'sports team',
      'sports league',

      // Non-profit
      'non-profit',
      'charity',
      'foundation',
      'ngo',
      'think tank',

      // Military
      'military unit',
      'military formation',
      'air force',
      'navy',
      'army',

      // Religious
      'religious organization',
      'religious order',
      'diocese',

      // Other organizations
      'organization',
      'institution',
      'association',
      'club',
      'union',
      'cooperative',
      'band',
      'orchestra',
      'choir',
    ],
    patterns: [
      /^(sports?\s*)?(team|club|franchise)$/i,
      /^(football|basketball|baseball|hockey|soccer)\s+(club|team)$/i,
      /\s+(fc|united|city|rovers)$/i,
      /(company|corporation|inc|ltd|llc)$/i,
    ],
  },

  work: {
    primary: [
      // Literature
      'book',
      'novel',
      'short story',
      'poem',
      'play',
      'comic book',
      'manga',
      'graphic novel',

      // Music
      'album',
      'single',
      'song',
      'ep',
      'musical',
      'opera',
      'symphony',
      'concerto',

      // Film & TV
      'film',
      'movie',
      'television',
      'tv series',
      'television series',
      'television episode',
      'tv show',
      'animated series',
      'documentary',
      'web series',

      // Visual art
      'painting',
      'sculpture',
      'artwork',
      'photograph',

      // Games
      'video game',
      'computer game',
      'mobile game',
      'board game',
      'card game',
      'tabletop game',

      // Software
      'software',
      'application',
      'website',
      'operating system',

      // Other creative works
      'award',
      'magazine',
      'newspaper',
      'journal',
      'podcast',
      'radio show',
      'comic strip',

      // Vehicles/products
      'automobile',
      'car',
      'aircraft',
      'ship',
      'spacecraft',
      'weapon',
      'firearm',
    ],
    patterns: [
      /^(album|single|song|film|movie|book|novel|game)$/i,
      /\s+(album|single|film|movie|series|show)$/i,
      /^(korean|japanese|chinese|indian|british|american)\s+(film|drama|series)/i,
      /^(video|computer|mobile)\s*game$/i,
    ],
  },

  event: {
    primary: [
      // Conflicts
      'war',
      'battle',
      'military conflict',
      'civil war',
      'revolution',
      'uprising',
      'rebellion',
      'coup',
      'siege',

      // Disasters
      'earthquake',
      'hurricane',
      'tornado',
      'flood',
      'fire',
      'disaster',
      'accident',
      'explosion',
      'shipwreck',

      // Sports events
      'olympics',
      'world cup',
      'championship',
      'tournament',
      'grand prix',
      'super bowl',

      // Political events
      'election',
      'referendum',
      'protest',
      'demonstration',
      'summit',
      'treaty',

      // Cultural events
      'festival',
      'concert',
      'ceremony',
      'exhibition',
      'fair',
      'convention',
      'conference',

      // Historical events
      'historical event',
      'event',
    ],
    patterns: [
      /\s+(war|battle|conflict|disaster|election|championship)$/i,
      /^(\d{4})\s+(olympics|world cup|election)/i,
      /^(summer|winter)\s+(olympics|games)/i,
    ],
  },

  other: {
    primary: [
      // Scientific concepts
      'element',
      'chemical compound',
      'mineral',
      'species',
      'taxon',
      'anatomy',
      'disease',
      'medical condition',
      'drug',
      'gene',
      'protein',

      // Languages and culture
      'language',
      'ethnic group',
      'religion',
      'mythology',

      // Abstract concepts
      'law',
      'legal',
      'philosophy',
      'theorem',
      'algorithm',

      // Food
      'food',
      'drink',
      'beverage',
      'cuisine',

      // Nature
      'animal',
      'plant',
      'fungus',
      'bacteria',
      'virus',

      // Miscellaneous
      'currency',
      'flag',
      'coat of arms',
      'symbol',
    ],
    patterns: [
      /^(species|taxon|genus|family|order|phylum|kingdom)/i,
      /^(dog|cat|horse|bird|fish|insect)\s+breed$/i,
    ],
  },
};

/**
 * Category keywords for fallback classification from content/categories
 */
const CATEGORY_KEYWORDS: Record<ArticleType, RegExp[]> = {
  person: [
    /\b(born|died|living people|deaths|births)\b/i,
    /\b(actors|actresses|musicians|politicians|athletes|writers|scientists)\b/i,
    /\b(people from|alumni of|graduates of)\b/i,
  ],
  place: [
    /\b(cities|towns|villages|counties|districts|geography|populated places)\b/i,
    /\b(buildings|structures|landmarks|national parks|protected areas)\b/i,
    /\b(located in|in .* county)\b/i,
  ],
  org: [
    /\b(companies|organizations|institutions|universities|schools|teams)\b/i,
    /\b(founded in|established in|nonprofit|corporation)\b/i,
  ],
  work: [
    /\b(albums|films|books|novels|video games|television series)\b/i,
    /\b(released in|published in|directed by)\b/i,
  ],
  event: [
    /\b(wars|battles|conflicts|disasters|elections|championships)\b/i,
    /\b(\d{4} in |events of)\b/i,
  ],
  other: [],
};

/**
 * Classify an article based on its infobox type and content.
 *
 * @param article - The article to classify
 * @returns The article type classification
 *
 * @example
 * ```typescript
 * const type = classifyArticle(article);
 * console.log(type); // 'person', 'place', 'org', 'work', 'event', or 'other'
 * ```
 */
export function classifyArticle(article: Article): ArticleType {
  // Primary signal: infobox type
  const firstInfobox = article.infoboxes[0];
  if (firstInfobox) {
    const infoboxType = firstInfobox.type.toLowerCase();

    for (const [category, { primary, patterns }] of Object.entries(INFOBOX_MAPPINGS)) {
      // Check exact matches first
      if (primary.includes(infoboxType)) {
        return category as ArticleType;
      }

      // Check regex patterns
      for (const pattern of patterns) {
        if (pattern.test(infoboxType)) {
          return category as ArticleType;
        }
      }
    }
  }

  // Secondary signal: categories
  const categoryText = article.categories.join(' ');

  for (const [category, patterns] of Object.entries(CATEGORY_KEYWORDS)) {
    if (category === 'other') continue;

    for (const pattern of patterns) {
      if (pattern.test(categoryText)) {
        return category as ArticleType;
      }
    }
  }

  // Tertiary signal: content analysis for person detection
  if (isProbablyPerson(article)) {
    return 'person';
  }

  return 'other';
}

/**
 * Heuristic check if article is about a person based on content
 */
function isProbablyPerson(article: Article): boolean {
  const text = article.plaintext.substring(0, 1000);

  // Check for birth/death patterns
  if (/\b(born|b\.|d\.).*\d{4}\b/i.test(text)) {
    return true;
  }

  // Check for "is a/an [profession]" pattern
  if (/\b(is|was)\s+an?\s+(american|british|french|german|japanese|chinese|indian|canadian|australian)?\s*(actor|actress|singer|musician|politician|writer|author|scientist|athlete|player|director|artist|businessman|entrepreneur|activist|journalist|philosopher|historian)/i.test(text)) {
    return true;
  }

  // Check for pronouns in first paragraph indicating biographical content
  const firstPara = text.split('\n')[0] ?? '';
  const pronounCount = (firstPara.match(/\b(he|she|his|her|him|they|their)\b/gi) || []).length;

  return pronounCount >= 3;
}

/**
 * Create a TransformStream that classifies articles
 *
 * @returns TransformStream for the pipeline
 */
export function createClassifier(): TransformStream<Article, ClassifiedArticle> {
  return new TransformStream<Article, ClassifiedArticle>(
    {
      transform(article, controller) {
        const type = classifyArticle(article);
        controller.enqueue({ ...article, type });
      },
    },
    { highWaterMark: 100 },
    { highWaterMark: 100 }
  );
}

/**
 * Get classification confidence based on signals
 */
export function getClassificationConfidence(article: Article): 'high' | 'medium' | 'low' {
  // High confidence if infobox directly matches
  const firstInfobox = article.infoboxes[0];
  if (firstInfobox) {
    const infoboxType = firstInfobox.type.toLowerCase();

    for (const { primary } of Object.values(INFOBOX_MAPPINGS)) {
      if (primary.includes(infoboxType)) {
        return 'high';
      }
    }

    // Medium confidence for pattern matches
    for (const { patterns } of Object.values(INFOBOX_MAPPINGS)) {
      for (const pattern of patterns) {
        if (pattern.test(infoboxType)) {
          return 'medium';
        }
      }
    }
  }

  // Low confidence for category/content-based classification
  return 'low';
}

/**
 * Get all possible classifications with scores
 */
export function getClassificationScores(article: Article): Record<ArticleType, number> {
  const scores: Record<ArticleType, number> = {
    person: 0,
    place: 0,
    org: 0,
    work: 0,
    event: 0,
    other: 0,
  };

  // Score from infobox (strongest signal)
  const firstInfobox = article.infoboxes[0];
  if (firstInfobox) {
    const infoboxType = firstInfobox.type.toLowerCase();

    for (const [category, { primary, patterns }] of Object.entries(INFOBOX_MAPPINGS)) {
      if (primary.includes(infoboxType)) {
        scores[category as ArticleType] += 100;
      }

      for (const pattern of patterns) {
        if (pattern.test(infoboxType)) {
          scores[category as ArticleType] += 80;
        }
      }
    }
  }

  // Score from categories (medium signal)
  const categoryText = article.categories.join(' ');

  for (const [category, patterns] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const pattern of patterns) {
      if (pattern.test(categoryText)) {
        scores[category as ArticleType] += 30;
      }
    }
  }

  // Person detection from content (weak signal)
  if (isProbablyPerson(article)) {
    scores.person += 20;
  }

  // Default score for 'other'
  if (Object.values(scores).every(s => s === 0)) {
    scores.other = 1;
  }

  return scores;
}
