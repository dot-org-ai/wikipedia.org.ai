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

// Abbreviations for sentence splitting
export const ABBREVIATIONS = ['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'etc', 'esp', 'eg', 'ie', 'inc', 'ltd', 'co', 'corp', 'st', 'mt', 'ft', 'gen', 'gov', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'no', 'vol', 'pp', 'ca']
