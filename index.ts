import { parseStockHtml, type StockData } from './parser';
import * as fs from 'fs/promises';

interface Config {
    codes: string[];
    amounts?: number[];
    discordWebhookUrl: string;
}

async function loadConfig(filePath: string): Promise<Config> {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    let codes: string[] = [];
    let amounts: number[] | undefined;
    let discordWebhookUrl = '';

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=').trim();

        if (key.trim() === 'CODES') {
            codes = value.split(',').map(c => c.trim()).filter(c => c);
        } else if (key.trim() === 'AMOUNTS') {
            amounts = value.split(',').map(n => parseInt(n.trim(), 10));
        } else if (key.trim() === 'DISCORD_WEBHOOK_URL') {
            discordWebhookUrl = value;
        }
    }

    if (!discordWebhookUrl) {
        throw new Error('DISCORD_WEBHOOK_URL is missing in settings.conf');
    }
    if (codes.length === 0) {
        throw new Error('CODES are missing in settings.conf');
    }
    if (amounts && amounts.length !== codes.length) {
        throw new Error(`The number of AMOUNTS (${amounts.length}) does not match the number of CODES (${codes.length})`);
    }

    return { codes, amounts, discordWebhookUrl };
}

async function fetchStockData(code: string): Promise<StockData | null> {
    const url = `https://finance.yahoo.co.jp/quote/${code}.T`;
    console.log(`Fetching data for ${code}...`);
    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
            return null;
        }
        const html = await response.text();
        return parseStockHtml(html, code);
    } catch (error) {
        console.error(`Error fetching data for ${code}:`, error);
        return null;
    }
}

async function sendToDiscord(webhookUrl: string, content: string) {
    if (!content) return;

    // Discord content limit is 2000 characters.
    // We'll split simply by lines if needed, or just send chunks.
    // Ideally, we batch lines until we hit the limit.
    
    const MAX_LENGTH = 2000;
    const lines = content.split('\n');
    let currentChunk = '';

    for (const line of lines) {
        if (currentChunk.length + line.length + 1 > MAX_LENGTH) {
            await postChunk(webhookUrl, currentChunk);
            currentChunk = '';
        }
        currentChunk += line + '\n';
    }
    if (currentChunk) {
        await postChunk(webhookUrl, currentChunk);
    }
}

async function postChunk(webhookUrl: string, content: string) {
    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        if (!response.ok) {
            console.error(`Failed to post to Discord: ${response.status} ${await response.text()}`);
        } else {
            console.log('Successfully posted to Discord.');
        }
    } catch (error) {
        console.error('Error posting to Discord:', error);
    }
}

async function main() {
    try {
        const config = await loadConfig('settings.conf');
        
        const results: string[] = [];
        
        // Fetch sequentially to be nice to the server, or parallel. 
        // Parallel is fine for a few codes.
        const promises = config.codes.map(code => fetchStockData(code));
        const stockDataList = await Promise.all(promises);

        let totalValuation = 0;
        let totalChange = 0;
        let allDataAvailable = true;

        stockDataList.forEach((data, index) => {
            if (data) {
                // Format: 住友化学(株) (4005): 470円 (前日比 +5.5円 +1.18%)
                const line = `${data.name} (${data.code}): ${data.price}円 (前日比 ${data.changeAmount}円 ${data.changePercent})`;
                results.push(line);

                if (config.amounts) {
                    const amount = config.amounts[index];
                    const priceVal = parseFloat(data.price.replace(/,/g, ''));
                    const changeVal = parseFloat(data.changeAmount.replace(/,/g, '').replace('+', '')); // parseFloat handles + but being explicit is safe. Actually parseFloat handles leading + fine.

                    if (!isNaN(priceVal) && !isNaN(changeVal)) {
                        totalValuation += priceVal * amount;
                        totalChange += changeVal * amount;
                    } else {
                        allDataAvailable = false;
                        console.warn(`Failed to parse numbers for ${data.code}: price="${data.price}", change="${data.changeAmount}"`);
                    }
                }
            } else {
                allDataAvailable = false;
            }
        });

        if (config.amounts && allDataAvailable && results.length > 0) {
            const totalChangeSign = totalChange > 0 ? '+' : '';
            results.push(`評価額合計: ${totalValuation.toLocaleString()}円 (前日比 ${totalChangeSign}${totalChange.toLocaleString()}円)`);
        } else if (config.amounts && !allDataAvailable) {
            console.warn('Skipping total valuation calculation because some stock data is missing or invalid.');
        }

        if (results.length > 0) {
            const message = results.join('\n');
            await sendToDiscord(config.discordWebhookUrl, message);
        } else {
            console.log('No stock data retrieved.');
        }

    } catch (error) {
        console.error('An error occurred:', error);
        process.exit(1);
    }
}

main();
