import { parseStockHtml, type StockData } from './parser';
import * as fs from 'fs/promises';

interface Config {
    codes: string[];
    discordWebhookUrl: string;
}

async function loadConfig(filePath: string): Promise<Config> {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    let codes: string[] = [];
    let discordWebhookUrl = '';

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=').trim();

        if (key.trim() === 'CODES') {
            codes = value.split(',').map(c => c.trim()).filter(c => c);
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

    return { codes, discordWebhookUrl };
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

        for (const data of stockDataList) {
            if (data) {
                // Format: 住友化学(株) (4005): 470円 (前日比 +5.5円 +1.18%)
                const line = `${data.name} (${data.code}): ${data.price}円 (前日比 ${data.changeAmount}円 ${data.changePercent})`;
                results.push(line);
            }
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
