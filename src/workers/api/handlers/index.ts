/**
 * Handler exports
 */

// Article handlers
export {
  getArticleById,
  getArticleByTitle,
  listArticles,
  queryArticles,
  handleGetArticleById,
  handleGetArticleByTitle,
  handleListArticles,
  handleAdvancedQuery,
} from './articles.js';

// Search handlers
export {
  vectorSearch,
  textSearch,
  handleVectorSearch,
  handleTextSearch,
} from './search.js';

// Relationship handlers
export {
  getOutgoingRelationships,
  getIncomingRelationships,
  handleGetRelationships,
  handleGetOutgoingRelationships,
  handleGetIncomingRelationships,
} from './relationships.js';

// Type handlers
export {
  getTypeStatistics,
  getTypeStats,
  handleListTypes,
  handleGetTypeStats,
} from './types.js';

// Geo handlers
export {
  searchNearby,
  searchNearbyFast,
  handleNearbySearch,
  handleGeoStats,
} from './geo.js';

// Wiki parser handlers (wiki.org.ai)
export {
  handleWikiRoot,
  handleWikiParsePost,
  handleWikiArticle,
} from './wiki.js';
