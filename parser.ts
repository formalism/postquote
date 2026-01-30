import * as cheerio from 'cheerio';

export interface StockData {
    name: string;
    code: string; // The parser might not extract code from HTML if it's not easily available, but the caller usually knows it. We'll pass it or try to find it.
    price: string;
    changeAmount: string;
    changePercent: string;
}

export function parseStockHtml(html: string, code: string): StockData {
    const $ = cheerio.load(html);

    // Selectors based on class partials for robustness
    // Name: <h2 class="PriceBoard__name...">
    const name = $('h2[class*="PriceBoard__name"]').text().trim();

    // Price: <span class="PriceBoard__price..."><span ...><span class="StyledNumber__value...">470</span>
    const price = $('[class*="PriceBoard__price"] [class*="StyledNumber__value"]').first().text().trim();

    // Change Amount: <span class="PriceChangeLabel__primary..."><span class="StyledNumber__value...">+5.5</span>
    const changeAmount = $('[class*="PriceChangeLabel__primary"] [class*="StyledNumber__value"]').text().trim();

    // Change Percent: <span class="PriceChangeLabel__secondary..."><span class="StyledNumber__value...">+1.18</span>
    // Note: The HTML might include brackets "()" or "%" in other spans. The text() might capture them if we select the parent.
    // The spec says "Change: +5.5円 +1.18%".
    // My selector for primary/secondary targets the inner number value. 
    // Let's grab the value. The "%" is usually in a sibling span suffix.
    
    const changePercentValue = $('[class*="PriceChangeLabel__secondary"] [class*="StyledNumber__value"]').text().trim();
    const changePercentSuffix = $('[class*="PriceChangeLabel__secondary"] [class*="StyledNumber__suffix"]').text().trim() || '%';
    
    const changePercent = `${changePercentValue}${changePercentSuffix}`;

    return {
        name,
        code,
        price,
        changeAmount,
        changePercent
    };
}
