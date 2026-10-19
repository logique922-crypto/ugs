import { Article } from '../types';

/**
 * Calculates the available stock for an article in a specific boutique or globally.
 * @param article The article object
 * @param projetId Optional project ID ('all' or undefined returns total stock across all projects)
 */
export function getArticleStock(article: Article | null | undefined, projetId?: string): number {
  if (!article) return 0;
  if (article.typeArticle === 'Service') return 999;

  if (article.stocks && typeof article.stocks === 'object') {
    if (!projetId || projetId === 'all') {
      const vals = Object.values(article.stocks);
      if (vals.length > 0) {
        return vals.reduce((sum, qty) => sum + (Number(qty) || 0), 0);
      }
      return Number(article.stock) || 0;
    }

    if (article.stocks[projetId] !== undefined) {
      return Number(article.stocks[projetId]) || 0;
    }

    // If querying Central Depot (1), fallback to legacy stock if stocks['1'] is not explicitly set
    if (projetId === '1' || projetId === article.projetId) {
      return Number(article.stock) || 0;
    }

    // For other boutiques: if not in stocks object, stock is strictly 0
    return 0;
  }

  // Fallback to legacy stock field
  if (!projetId || projetId === 'all' || projetId === '1' || projetId === article.projetId) {
    return Number((article as any).stock) || 0;
  }

  return 0;
}

/**
 * Determines whether an article belongs or has been transferred to a specific boutique.
 * Boutiques (2, 3, etc.) only contain products that have been transferred/linked to them.
 */
export function isArticleInProject(article: Article | null | undefined, projetId?: string): boolean {
  if (!article) return false;
  if (!projetId || projetId === 'all') return true;

  // Dépôt Central (1): displays catalog articles created in Central or having Central stock
  if (projetId === '1') {
    if (article.projetId === '1' || !article.projetId) return true;
    if (article.stocks && article.stocks['1'] !== undefined) return true;
    return false;
  }

  // Boutiques (2, 3, etc.): ONLY articles that have been transferred/linked to this boutique
  if (article.stocks && article.stocks[projetId] !== undefined && Number(article.stocks[projetId]) > 0) {
    return true;
  }
  
  if (article.projetId === projetId && getArticleStock(article, projetId) > 0) {
    return true;
  }

  return false;
}

/**
 * Checks if an article is in low stock condition for a given project/store.
 */
export function hasLowStock(article: Article | null | undefined, projetId?: string): boolean {
  if (!article) return false;
  if (article.typeArticle === 'Service') return false;

  const stock = getArticleStock(article, projetId);
  if (stock <= 0) return false; // Rupture, not low stock

  let min = 15;
  if (article.stockMinimums && typeof article.stockMinimums === 'object') {
    if (projetId && projetId !== 'all' && article.stockMinimums[projetId] !== undefined) {
      min = Number(article.stockMinimums[projetId]);
    } else if (article.stockMinimums['1'] !== undefined) {
      min = Number(article.stockMinimums['1']);
    } else {
      const minValues = Object.values(article.stockMinimums).map(v => Number(v) || 0);
      if (minValues.length > 0) {
        min = Math.min(...minValues);
      }
    }
  } else if (article.seuilAlerte !== undefined) {
    min = Number(article.seuilAlerte);
  }

  return stock < min;
}

/**
 * Checks if an article is out of stock.
 */
export function isOutOfStock(article: Article | null | undefined, projetId?: string): boolean {
  if (!article) return true;
  if (article.typeArticle === 'Service') return false;
  return getArticleStock(article, projetId) <= 0;
}

/**
 * Updates stock for an article in a specific boutique/store.
 * If the boutique didn't have the product, it links it and sets the new quantity.
 * If it already had it, it simply increments/decrements the quantity.
 */
export function updateArticleStock(article: Article, projetId: string, delta: number): Article {
  if (article.typeArticle === 'Service') return article;

  const targetId = projetId === 'all' ? '1' : projetId;
  const currentStocks: Record<string, number> = { ...(article.stocks || {}) };

  // Determine current stock in target store
  let currentQty = 0;
  if (currentStocks[targetId] !== undefined) {
    currentQty = Number(currentStocks[targetId]) || 0;
  } else if (targetId === '1' || targetId === (article.projetId || '1')) {
    currentQty = Number(article.stock) || 0;
  } else {
    currentQty = 0;
  }

  const newQty = Math.max(0, currentQty + delta);
  currentStocks[targetId] = newQty;

  // If central depot was using article.stock without stocks['1'], make sure stocks['1'] is explicitly recorded
  if (currentStocks['1'] === undefined && targetId !== '1') {
    currentStocks['1'] = Number(article.stock) || 0;
  }

  const totalStock = Object.values(currentStocks).reduce((sum, qty) => sum + (Number(qty) || 0), 0);

  return {
    ...article,
    stocks: currentStocks,
    stock: totalStock,
    stockGlobal: totalStock
  };
}
