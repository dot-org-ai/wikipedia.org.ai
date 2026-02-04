/**
 * Constants for wtf-lite Wikipedia parser
 */

import type { WtfData } from './types'

// CDN URL for loading additional data
export const CDN_URL = 'https://cdn.workers.do/wtf-data.json'

// CDN data (loaded at init)
export let DATA: WtfData | null = null

export function setData(data: WtfData | null): void {
  DATA = data
}

// Inline minimal data for sync operation (i18n essentials only)
export const CATEGORIES = ['category', 'categoria', 'categoría', 'catégorie', 'kategorie', 'kategori', 'категория', 'تصنيف', '分类']
export const INFOBOXES = ['infobox', 'ficha', 'info', 'карточка', 'bilgi kutusu', 'kotak info', 'תבנית', 'بطاقة', '정보상자']
export const REDIRECTS = ['redirect', 'weiterleitung', 'redirection', 'redirección', 'перенаправление', 'تحويل', '重定向']
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Currency codes (inline for sync operation)
// Maps template names (lowercase) to currency symbols
export const CURRENCY: Record<string, string> = {
  // Symbol templates
  '£': 'GB£', '¥': '¥', '€': '€', '₹': '₹', '₽': '₽', '₩': '₩', '₱': '₱',
  // ISO code templates
  'usd': 'US$', 'us$': 'US$', 'gbp': 'GB£', 'eur': '€', 'jpy': '¥', 'cny': 'CN¥',
  'inr': '₹', 'rub': '₽', 'aud': 'A$', 'cad': 'CA$', 'chf': 'CHF', 'hkd': 'HK$',
  'sgd': 'S$', 'nzd': 'NZ$', 'krw': '₩', 'mxn': 'MX$', 'brl': 'R$', 'zar': 'R',
  // Named currency templates (template names are lowercased during lookup)
  'us dollar': 'US$', 'us dollar link': 'US$', 'usdollar': 'US$',
  'pound sterling': 'GB£', 'gbp link': 'GB£', 'uk pound': 'GB£',
  'euro': '€', 'eur link': '€',
  'japanese yen': '¥', 'jpy link': '¥', 'yen': '¥',
  'chinese yuan': 'CN¥', 'cny link': 'CN¥', 'rmb': 'CN¥', 'yuan': 'CN¥',
  'indian rupee': '₹', 'inr link': '₹', 'rupee': '₹',
  'russian ruble': '₽', 'rub link': '₽', 'ruble': '₽',
  'australian dollar': 'A$', 'aud link': 'A$',
  'canadian dollar': 'CA$', 'cad link': 'CA$',
  'swiss franc': 'CHF', 'chf link': 'CHF', 'franc': 'CHF',
  'hong kong dollar': 'HK$', 'hkd link': 'HK$',
  'singapore dollar': 'S$', 'sgd link': 'S$',
  'new zealand dollar': 'NZ$', 'nzd link': 'NZ$',
  'south korean won': '₩', 'krw link': '₩', 'won': '₩',
  'mexican peso': 'MX$', 'mxn link': 'MX$', 'peso': 'MX$',
  'brazilian real': 'R$', 'brl link': 'R$', 'real': 'R$',
  'south african rand': 'R', 'zar link': 'R', 'rand': 'R'
}

// Flags (inline for sports player template)
export const FLAGS: [string, string, string][] = [
  ['🇺🇸', 'usa', 'united states'], ['🇬🇧', 'gbr', 'united kingdom'], ['🇩🇪', 'ger', 'germany'],
  ['🇫🇷', 'fra', 'france'], ['🇮🇹', 'ita', 'italy'], ['🇪🇸', 'esp', 'spain'],
  ['🇧🇷', 'bra', 'brazil'], ['🇦🇷', 'arg', 'argentina'], ['🇯🇵', 'jpn', 'japan'],
  ['🇨🇳', 'chn', 'china'], ['🇰🇷', 'kor', 'south korea'], ['🇦🇺', 'aus', 'australia'],
  ['🇨🇦', 'can', 'canada'], ['🇳🇱', 'ned', 'netherlands'], ['🇧🇪', 'bel', 'belgium'],
  ['🇵🇹', 'por', 'portugal'], ['🇷🇺', 'rus', 'russia'], ['🇵🇱', 'pol', 'poland'],
  ['🇲🇽', 'mex', 'mexico'], ['🇮🇳', 'ind', 'india']
]

// File namespace prefixes for stripping images
export const FILE_NS_PREFIXES = ['file', 'image', 'fichier', 'archivo', 'datei', 'bestand', 'bild', 'plik', 'файл', 'ファイル', '文件', '檔案', 'תמונה', 'ملف', 'تصویر']

// Tags to ignore (strip from content)
export const IGNORE_TAGS = ['table', 'code', 'score', 'data', 'categorytree', 'charinsert', 'hiero', 'imagemap', 'inputbox', 'references', 'source', 'syntaxhighlight', 'timeline', 'maplink']

// Reference section names (i18n)
export const REF_SECTION_NAMES = ['references', 'reference', 'einzelnachweise', 'referencias', 'références', '脚注']

// Disambiguation templates (i18n)
export const DISAMBIG_TEMPLATES = [
  // English
  'disambiguation', 'disambig', 'disamb', 'dab', 'dp', 'geodis', 'hndis', 'hospitaldis', 'numberdis',
  'schooldis', 'mathdab', 'roaddis', 'set index', 'setindex', 'shipindex', 'mountainindex',
  // German
  'begriffsklärung',
  // French
  'homonymie',
  // Spanish
  'desambiguación',
  // Portuguese
  'desambiguação',
  // Italian
  'disambigua',
  // Russian
  'многозначность', 'неоднозначность',
  // Arabic
  'توضيح',
  // Chinese
  '消歧义', '消歧義',
  // Japanese
  '曖昧さ回避',
  // Other i18n
  'bisongidila'  // Lingala
]

// Disambiguation title suffixes (i18n)
export const DISAMBIG_TITLE_SUFFIXES = [
  '(disambiguation)',
  '(begriffsklärung)',
  '(homonymie)',
  '(desambiguación)',
  '(desambiguação)',
  '(disambigua)',
  '(многозначность)',
  '(توضيح)',
  '(消歧义)',
  '(曖昧さ回避)'
]

// Abbreviations for sentence splitting
export const ABBREVIATIONS = ['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'etc', 'esp', 'eg', 'ie', 'inc', 'ltd', 'co', 'corp', 'st', 'mt', 'ft', 'gen', 'gov', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'no', 'vol', 'pp', 'ca']

// ============================================================================
// PRE-COMPILED REGEX PATTERNS
// ============================================================================
// All regex patterns pre-compiled for performance
// Using non-capturing groups (?:...) where possible

export const PATTERNS = {
  // -------------------------------------------------------------------------
  // UTILS PATTERNS
  // -------------------------------------------------------------------------
  /** Trim leading/trailing whitespace */
  TRIM_WHITESPACE: /^\s+|\s+$/g,
  /** Collapse multiple spaces to single */
  COLLAPSE_SPACES: / {2,}/g,
  /** HTML comments: <!-- ... --> */
  HTML_COMMENT: /<!--(?:[^-]|-(?!->)){0,3000}-->/g,
  /** Magic words: __NOTOC__, __FORCETOC__, etc. */
  MAGIC_WORDS: /__(?:NOTOC|NOEDITSECTION|FORCETOC|TOC)__/gi,
  /** Signatures and horizontal rules */
  SIGNATURES_HR: /~{2,3}|\r|----/g,
  /** CJK period */
  CJK_PERIOD: /\u3002/g,
  /** HTML entities (common) */
  ENTITY_NBSP: /&nbsp;/g,
  ENTITY_NDASH: /&ndash;/g,
  ENTITY_MDASH: /&mdash;/g,
  ENTITY_AMP: /&amp;/g,
  ENTITY_QUOT: /&quot;/g,
  ENTITY_APOS: /&apos;/g,
  /** All HTML entities (generic) */
  HTML_ENTITIES: /&[a-z]+;/gi,
  /** Template name extraction patterns */
  TEMPLATE_WITH_PIPE: /^\{\{[^\n]+\|/,
  TEMPLATE_NAME_PIPE: /^\{\{(.+?)\|/,
  TEMPLATE_NAME_NEWLINE: /^\{\{(.+)\n/,
  TEMPLATE_NAME_SIMPLE: /^\{\{(.+?)\}\}$/,
  /** Template open/close for validation */
  TEMPLATE_OPEN: /\{\{/,
  TEMPLATE_CLOSE: /\}\}/,
  /** Template prefix/suffix removal */
  TEMPLATE_PREFIX: /^\{\{/,
  TEMPLATE_SUFFIX: /\}\}$/,

  // -------------------------------------------------------------------------
  // LINK PATTERNS
  // -------------------------------------------------------------------------
  /** Ignore link namespaces (category, file, etc.) */
  IGNORE_LINK_NS: /^(?:category|catégorie|kategorie|categoría|categoria|categorie|image|file|fichier|datei|media):/i,
  /** External links: [http://...] or [mailto:...] etc. */
  EXTERNAL_LINK: /\[(?:https?|news|ftp|mailto|gopher|irc)(:\/\/[^\]| ]{4,1500})(?:[| ][^\]]{0,500})?\]/g,
  /** Wiki links: [[Page]] or [[Page|text]] */
  WIKI_LINK: /\[\[([^\]]{0,1600}?)\]\]([a-z]+)?/gi,
  /** Link with pipe (for splitting) */
  LINK_PIPE: /\|/,
  /** Link text extraction (before pipe) */
  LINK_BEFORE_PIPE: /([^|]{2,1000})\|[^|]{0,2000}/,
  /** Link text extraction (after pipe) */
  LINK_AFTER_PIPE: /[^|]{2,1000}?\|/,

  // -------------------------------------------------------------------------
  // SENTENCE PATTERNS
  // -------------------------------------------------------------------------
  /** Decimal number at end (for sentence splitting) */
  DECIMAL_END: /\d\s*$/,
  /** Sentence ending with initial (A. B. etc.) */
  INITIAL_END: /[ .'][A-Z].? *$/i,
  /** Ellipsis at end */
  ELLIPSIS_END: /\.{3,} +$/,
  /** Sentence split pattern */
  SENTENCE_SPLIT: /(\S[^\n.!?]*[.!?]"?)(?=\s|$)/g,
  /** Newline split for sentences */
  NEWLINE_SPLIT: /\n+/,
  /** Non-whitespace check */
  HAS_CONTENT: /\S/,
  /** Empty parentheses cleanup */
  EMPTY_PARENS: /\([,;: ]*\)/g,
  /** Trailing period with spaces */
  TRAILING_PERIOD: / +\.$/,

  // -------------------------------------------------------------------------
  // BOLD/ITALIC PATTERNS
  // -------------------------------------------------------------------------
  /** Bold+italic: '''''text''''' */
  BOLD_ITALIC: /'''''([^']{0,2500}|'(?!')){0,2500}'''''/g,
  /** Bold: '''text''' */
  BOLD: /'''([^']{0,2500}|'(?!')|''(?!')){0,2500}'''/g,
  /** Italic: ''text'' */
  ITALIC: /''([^']{0,2500}|'(?!')){0,2500}''/g,
  /** Bold/italic marker cleanup */
  BOLD_ITALIC_MARKERS: /''+/g,

  // -------------------------------------------------------------------------
  // LIST PATTERNS
  // -------------------------------------------------------------------------
  /** List item start: #, *, :, ;, | */
  LIST_ITEM: /^[#*:;|]+/,
  /** Bullet list */
  BULLET_LIST: /^\*+[^:,|]{4}/,
  /** Numbered list */
  NUMBER_LIST: /^ ?#[^:,|]{4}/,
  /** Numbered list prefix for replacement */
  NUMBER_PREFIX: /^ ?#*/,

  // -------------------------------------------------------------------------
  // SECTION PATTERNS
  // -------------------------------------------------------------------------
  /** Section heading (for split) */
  SECTION_SPLIT: /(?:\n|^)(={2,6}[^=\n]{1,200}?={2,6})/g,
  /** Heading extraction */
  HEADING_EXTRACT: /^(={1,6})([^=\n]{1,200}?)={1,6}$/,
  /** Simple heading check (no capture) */
  HEADING_CHECK: /^={2,6}[^=\n]+={2,6}$/,

  // -------------------------------------------------------------------------
  // TABLE PATTERNS
  // -------------------------------------------------------------------------
  /** Rowspan attribute */
  ROWSPAN: /.*rowspan *= *["']?([0-9]+)["']?[ |]*/i,
  /** Colspan attribute */
  COLSPAN: /.*colspan *= *["']?([0-9]+)["']?[ |]*/i,
  /** Table heading cell (starts with !) */
  TABLE_HEADING: /^!/,
  /** Table open */
  TABLE_OPEN: /^\s*\{\|/,
  /** Table close */
  TABLE_CLOSE: /^\s*\|\}/,
  /** Table caption */
  TABLE_CAPTION: /^\|\+/,
  /** Row separator */
  ROW_SEPARATOR: /^\|-/,
  /** Cell separator (|| or !!) */
  CELL_SEPARATOR: /(?:\|\||!!)/,
  /** Cell style (before single pipe) */
  CELL_STYLE: /.*?\| ?/,
  /** Style attribute cleanup */
  STYLE_ATTR: /style=['"].*?['"]/,

  // -------------------------------------------------------------------------
  // IMAGE PATTERNS
  // -------------------------------------------------------------------------
  /** Image extensions */
  IMAGE_EXTENSION: /\.(?:jpg|jpeg|png|gif|svg|webp|tiff?|bmp)$/i,
  /** Image size (300px or 200x150px) */
  IMAGE_SIZE: /^\d+(?:\s*x\s*\d+)?px$/i,
  /** Image size extraction */
  IMAGE_SIZE_EXTRACT: /^(\d+)(?:\s*x\s*(\d+))?px$/i,

  // -------------------------------------------------------------------------
  // REFERENCE PATTERNS
  // -------------------------------------------------------------------------
  /** Citation template check */
  CITATION_START: /^ *\{\{ *(?:cite|citation)/i,
  /** Citation template end */
  CITATION_END: /\}\} *$/,
  /** Citation needed (to exclude) */
  CITATION_NEEDED: /citation needed/i,
  /** Ref name attribute */
  REF_NAME: /name\s*=\s*["']?([^"'\s/>]+)["']?/i,
  /** Anonymous ref tag */
  REF_ANON: / ?<ref>([\s\S]{0,4000}?)<\/ref> ?/gi,
  /** Named ref tag with content */
  REF_NAMED: / ?<ref ([^>]{0,200})>([\s\S]{0,4000}?)<\/ref> ?/gi,
  /** Self-closing ref tag */
  REF_SELF_CLOSE: / ?<ref ([^>]{0,200})\/> ?/gi,

  // -------------------------------------------------------------------------
  // TEMPLATE PARAM PATTERNS
  // -------------------------------------------------------------------------
  /** Named parameter (key=value) */
  NAMED_PARAM: /^[\p{Letter}0-9._/\- '()\t]+=/iu,
  /** Unbalanced wiki link (for joining split params) */
  UNBALANCED_LINK: /\[\[[^\]]+$/,
  /** Unbalanced template */
  UNBALANCED_TEMPLATE: /\{\{[^}]+$/,

  // -------------------------------------------------------------------------
  // CATEGORY PATTERNS
  // -------------------------------------------------------------------------
  /** Category link end cleanup */
  CATEGORY_END: /\|?[ *]?\]\]$/,
  /** Category pipe (for removing sort key) */
  CATEGORY_PIPE: /\|.*/,
  /** Bracket check for category names */
  BRACKET_CHECK: /[[\]]/,

  // -------------------------------------------------------------------------
  // INFOBOX PATTERNS
  // -------------------------------------------------------------------------
  /** Infobox prefix */
  INFOBOX_PREFIX: /^infobox /i,
  /** Infobox suffix */
  INFOBOX_SUFFIX: / infobox$/i,

  // -------------------------------------------------------------------------
  // MISC CLEANUP PATTERNS
  // -------------------------------------------------------------------------
  /** Underscores to spaces */
  UNDERSCORE: /_/g,
  /** Dashes for normalization */
  DASHES: /[−–—]/g,
  /** Commas for number parsing */
  COMMAS: /,/g,
  /** Multiple newlines */
  MULTI_NEWLINE: /\n{3,}/g,
  /** Double newline for paragraph split */
  PARAGRAPH_SPLIT: /\r?\n\r?\n/,
  /** BR tag to newline */
  BR_TAG: / ?< ?br ?\/> ?/g,
  /** Generic HTML tag */
  HTML_TAG: /<[^>]+>/g,
  /** Self-closing div/span/table tags */
  SELF_CLOSE_TAG: / ?< ?(?:span|div|table|data) [a-zA-Z0-9=%.\-#:;'" ]{2,100}\/? ?> ?/g,
  /** Common inline tags to remove */
  INLINE_TAG: / ?<[ /]?(?:p|sub|sup|span|nowiki|div|table|br|tr|td|th|pre|hr|u)[ /]?> ?/g,
  /** Anchor hash in links */
  ANCHOR_HASH: /#(.*)/,
  /** Key normalization (remove parens) */
  KEY_PARENS: /\(.*?\)/,

  // -------------------------------------------------------------------------
  // FAST MODE PATTERNS
  // -------------------------------------------------------------------------
  /** File link patterns for fast mode */
  FILE_LINK: /\[\[File:[^\]]*\]\]/gi,
  IMAGE_LINK: /\[\[Image:[^\]]*\]\]/gi,
  /** External link removal */
  EXT_LINK_REMOVE: /\[https?:\/\/[^\]]+\]/g,
  /** Link to text conversion */
  LINK_PIPED: /\[\[([^\]|]+)\|([^\]]+)\]\]/g,
  LINK_SIMPLE: /\[\[([^\]]+)\]\]/g,

  // -------------------------------------------------------------------------
  // BOLD TEXT EXTRACTION (for title)
  // -------------------------------------------------------------------------
  /** Bold at start of text */
  BOLD_START: /^'''([^']+)'''/,
} as const

// ============================================================================
// DYNAMIC PATTERN BUILDERS
// ============================================================================
// Functions to build patterns that need runtime data

/** Build redirect detection pattern from i18n redirect words */
export function buildRedirectPattern(redirects: string[]): RegExp {
  return new RegExp('^\\s*#(?:' + redirects.join('|') + ')\\s*(\\[\\[[^\\]]{2,180}?\\]\\])', 'i')
}

/** Build category detection pattern from i18n category names */
export function buildCategoryPattern(categories: string[]): RegExp {
  return new RegExp('\\[\\[(?:' + categories.join('|') + '):([^\\]]{2,178}?)\\]\\](\\w{0,10})', 'gi')
}

/** Build category removal pattern */
export function buildCategoryRemovePattern(categories: string[]): RegExp {
  return new RegExp('^\\[\\[:?(?:' + categories.join('|') + '):', 'gi')
}

/** Build infobox detection pattern from i18n infobox names */
export function buildInfoboxPattern(infoboxes: string[]): RegExp {
  return new RegExp('^(?:subst\\.)?(?:' + infoboxes.join('|') + ')(?=:| |\\n|$)', 'i')
}

/** Build reference section name pattern */
export function buildRefSectionPattern(refNames: string[]): RegExp {
  return new RegExp('^(?:' + refNames.join('|') + '):?', 'i')
}

/** Build file namespace pattern from i18n file prefixes */
export function buildFileNsPattern(prefixes: string[]): RegExp {
  return new RegExp('\\[\\[(?:' + prefixes.join('|') + '):', 'gi')
}

/** Build file namespace prefix check pattern */
export function buildFileNsPrefixPattern(prefixes: string[]): RegExp {
  return new RegExp('^(?:' + prefixes.join('|') + '):', 'i')
}

/** Build ignore tags pattern */
export function buildIgnoreTagsPattern(tags: string[]): RegExp {
  const tagGroup = tags.join('|')
  return new RegExp(`< ?(?:${tagGroup}) ?[^>]{0,200}>(?:[^<]|<(?!\\s?/\\s?(?:${tagGroup})\\s?>))+< ?/ ?(?:${tagGroup}) ?>`, 'gi')
}

/** Build abbreviation pattern for sentence splitting */
export function buildAbbrevPattern(abbreviations: string[]): RegExp {
  return new RegExp("(?:^| |')(?:" + abbreviations.join('|') + ")[.!?] ?$", 'i')
}

/** Build disambiguation template detection pattern */
export function buildDisambigTemplatePattern(templates: string[]): RegExp {
  return new RegExp('\\{\\{\\s*(?:' + templates.join('|') + ')\\s*(?:\\|[^}]*)?\\}\\}', 'i')
}

/** Build disambiguation title suffix pattern */
export function buildDisambigTitlePattern(suffixes: string[]): RegExp {
  const escaped = suffixes.map(s => s.replace(/[()]/g, '\\$&'))
  return new RegExp('(?:' + escaped.join('|') + ')\\s*$', 'i')
}

// ============================================================================
// CACHED DYNAMIC PATTERNS
// ============================================================================
// Pre-built patterns using default constants (avoid re-building)

/** Cached redirect pattern */
let _cachedRedirectPattern: RegExp | null = null
export function getRedirectPattern(): RegExp {
  if (!_cachedRedirectPattern) {
    _cachedRedirectPattern = buildRedirectPattern(REDIRECTS)
  }
  return _cachedRedirectPattern
}

/** Cached category pattern */
let _cachedCategoryPattern: RegExp | null = null
export function getCategoryPattern(): RegExp {
  if (!_cachedCategoryPattern) {
    _cachedCategoryPattern = buildCategoryPattern(CATEGORIES)
  }
  return _cachedCategoryPattern
}

/** Cached category remove pattern */
let _cachedCategoryRemovePattern: RegExp | null = null
export function getCategoryRemovePattern(): RegExp {
  if (!_cachedCategoryRemovePattern) {
    _cachedCategoryRemovePattern = buildCategoryRemovePattern(CATEGORIES)
  }
  return _cachedCategoryRemovePattern
}

/** Cached infobox pattern */
let _cachedInfoboxPattern: RegExp | null = null
export function getInfoboxPattern(): RegExp {
  if (!_cachedInfoboxPattern) {
    _cachedInfoboxPattern = buildInfoboxPattern(INFOBOXES)
  }
  return _cachedInfoboxPattern
}

/** Cached ref section pattern */
let _cachedRefSectionPattern: RegExp | null = null
export function getRefSectionPattern(): RegExp {
  if (!_cachedRefSectionPattern) {
    _cachedRefSectionPattern = buildRefSectionPattern(REF_SECTION_NAMES)
  }
  return _cachedRefSectionPattern
}

/** Cached file namespace pattern */
let _cachedFileNsPattern: RegExp | null = null
export function getFileNsPattern(): RegExp {
  if (!_cachedFileNsPattern) {
    _cachedFileNsPattern = buildFileNsPattern(FILE_NS_PREFIXES)
  }
  return _cachedFileNsPattern
}

/** Cached file namespace prefix pattern */
let _cachedFileNsPrefixPattern: RegExp | null = null
export function getFileNsPrefixPattern(): RegExp {
  if (!_cachedFileNsPrefixPattern) {
    _cachedFileNsPrefixPattern = buildFileNsPrefixPattern(FILE_NS_PREFIXES)
  }
  return _cachedFileNsPrefixPattern
}

/** Cached ignore tags pattern */
let _cachedIgnoreTagsPattern: RegExp | null = null
export function getIgnoreTagsPattern(): RegExp {
  if (!_cachedIgnoreTagsPattern) {
    _cachedIgnoreTagsPattern = buildIgnoreTagsPattern(IGNORE_TAGS)
  }
  return _cachedIgnoreTagsPattern
}

/** Cached abbreviation pattern */
let _cachedAbbrevPattern: RegExp | null = null
export function getAbbrevPattern(): RegExp {
  if (!_cachedAbbrevPattern) {
    _cachedAbbrevPattern = buildAbbrevPattern(ABBREVIATIONS)
  }
  return _cachedAbbrevPattern
}

/** Cached disambiguation template pattern */
let _cachedDisambigTemplatePattern: RegExp | null = null
export function getDisambigTemplatePattern(): RegExp {
  if (!_cachedDisambigTemplatePattern) {
    _cachedDisambigTemplatePattern = buildDisambigTemplatePattern(DISAMBIG_TEMPLATES)
  }
  return _cachedDisambigTemplatePattern
}

/** Cached disambiguation title pattern */
let _cachedDisambigTitlePattern: RegExp | null = null
export function getDisambigTitlePattern(): RegExp {
  if (!_cachedDisambigTitlePattern) {
    _cachedDisambigTitlePattern = buildDisambigTitlePattern(DISAMBIG_TITLE_SUFFIXES)
  }
  return _cachedDisambigTitlePattern
}
