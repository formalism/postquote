import { parseStockHtml, type StockData } from './parser';
import * as fs from 'fs/promises';

interface Config {
    codes: string[];
    amounts?: number[];
    discordWebhookUrl: string;
}

const DISCORD_MAX_LENGTH = 2000;
const CODE_BLOCK_PREFIX = '```text\n';
const CODE_BLOCK_SUFFIX = '\n```';

/**
 * settings.conf から株価取得対象と通知先の設定を読み込む。
 */
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

/**
 * Yahoo!ファイナンスから指定銘柄の株価情報を取得する。
 */
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

interface TableRow {
    code: string;
    name: string;
    price: string;
    changeAmount: string;
    changePercent: string;
}

/**
 * Discord の等幅コードブロック上で列が揃うよう、文字の表示幅を概算する。
 */
function getDisplayWidth(text: string): number {
    let width = 0;

    for (const char of text) {
        width += isWideCharacter(char) ? 2 : 1;
    }

    return width;
}

/**
 * 日本語などの全角文字を 2 桁幅として扱う。
 */
function isWideCharacter(char: string): boolean {
    const codePoint = char.codePointAt(0);

    if (codePoint === undefined) {
        return false;
    }

    return (
        (codePoint >= 0x1100 && codePoint <= 0x115f) ||
        (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
        (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
        (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
        (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
        (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
        (codePoint >= 0xff01 && codePoint <= 0xff60) ||
        (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    );
}

/**
 * 列幅に合わせて末尾へ空白を補い、Discord 上で表の列位置を揃える。
 */
function padDisplayWidth(text: string, width: number): string {
    const padding = Math.max(0, width - getDisplayWidth(text));
    return `${text}${' '.repeat(padding)}`;
}

/**
 * 数値列を右寄せにし、桁の比較をしやすくする。
 */
function padDisplayWidthStart(text: string, width: number): string {
    const padding = Math.max(0, width - getDisplayWidth(text));
    return `${' '.repeat(padding)}${text}`;
}

/**
 * 株価一覧を 1 銘柄 1 行の表形式に変換する。
 */
export function formatStockTable(stockDataList: StockData[], totalRow?: { totalValuation: number; totalChange: number }): string[] {
    const baseRows: TableRow[] = stockDataList.map(data => ({
        code: data.code,
        name: data.name,
        price: `${data.price}円`,
        changeAmount: `${data.changeAmount}円`,
        changePercent: data.changePercent
    }));

    if (totalRow) {
        const totalChangeSign = totalRow.totalChange > 0 ? '+' : '';
        baseRows.push({
            code: '',
            name: '評価額合計',
            price: `${totalRow.totalValuation.toLocaleString()}円`,
            changeAmount: `${totalChangeSign}${totalRow.totalChange.toLocaleString()}円`,
            changePercent: ''
        });
    }

    const nameWidth = Math.max(getDisplayWidth('銘柄'), ...baseRows.map(row => getDisplayWidth(row.name)));
    const rows = baseRows;

    const codeWidth = Math.max(getDisplayWidth('コード'), ...rows.map(row => getDisplayWidth(row.code)));
    const priceWidth = Math.max(getDisplayWidth('価格'), ...rows.map(row => getDisplayWidth(row.price)));
    const changeAmountWidth = Math.max(getDisplayWidth('前日比'), ...rows.map(row => getDisplayWidth(row.changeAmount)));
    const changePercentWidth = Math.max(getDisplayWidth('騰落率'), ...rows.map(row => getDisplayWidth(row.changePercent)));

    const header = [
        padDisplayWidth('価格', priceWidth),
        padDisplayWidth('前日比', changeAmountWidth),
        padDisplayWidth('騰落率', changePercentWidth),
        padDisplayWidth('コード', codeWidth),
        padDisplayWidth('銘柄', nameWidth)
    ].join('  ');
    const separator = [
        '-'.repeat(priceWidth),
        '-'.repeat(changeAmountWidth),
        '-'.repeat(changePercentWidth),
        '-'.repeat(codeWidth),
        '-'.repeat(nameWidth)
    ].join('  ');

    const lines = [header, separator];

    rows.forEach((row, index) => {
        const isTotalRow = totalRow !== undefined && index === rows.length - 1;

        if (isTotalRow) {
            lines.push(separator);
        }

        lines.push([
            padDisplayWidthStart(row.price, priceWidth),
            padDisplayWidthStart(row.changeAmount, changeAmountWidth),
            padDisplayWidthStart(row.changePercent, changePercentWidth),
            padDisplayWidth(row.code, codeWidth),
            padDisplayWidth(row.name, nameWidth)
        ].join('  '));
    });

    return lines;
}

/**
 * 表の各行を Discord のコードブロック単位で分割する。
 */
export function splitDiscordTable(lines: string[], maxLength = DISCORD_MAX_LENGTH): string[] {
    if (lines.length === 0) {
        return [];
    }

    const chunks: string[] = [];
    let currentLines: string[] = [];

    const flushCurrentLines = () => {
        if (currentLines.length === 0) {
            return;
        }

        chunks.push(`${CODE_BLOCK_PREFIX}${currentLines.join('\n')}${CODE_BLOCK_SUFFIX}`);
        currentLines = [];
    };

    for (const line of lines) {
        const candidateLines = currentLines.length === 0 ? [line] : [...currentLines, line];
        const candidateChunk = `${CODE_BLOCK_PREFIX}${candidateLines.join('\n')}${CODE_BLOCK_SUFFIX}`;

        if (candidateChunk.length > maxLength) {
            flushCurrentLines();
            currentLines = [line];
        } else {
            currentLines = candidateLines;
        }
    }

    flushCurrentLines();

    return chunks;
}

/**
 * 表形式の本文をコードブロック単位で分割しながら Discord Webhook に送信する。
 */
async function sendToDiscord(webhookUrl: string, lines: string[]) {
    const chunks = splitDiscordTable(lines);

    for (const chunk of chunks) {
        await postChunk(webhookUrl, chunk);
    }
}

/**
 * 単一チャンクの本文を Discord Webhook に POST する。
 */
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

/**
 * 設定された銘柄の株価取得、集計、Discord 通知をまとめて実行する。
 */
async function main() {
    try {
        const config = await loadConfig('settings.conf');

        // Fetch sequentially to be nice to the server, or parallel. 
        // Parallel is fine for a few codes.
        const promises = config.codes.map(code => fetchStockData(code));
        const stockDataList = await Promise.all(promises);
        const validStockDataList: StockData[] = [];

        let totalValuation = 0;
        let totalChange = 0;
        let allDataAvailable = true;

        stockDataList.forEach((data, index) => {
            if (data) {
                validStockDataList.push(data);

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

        let totalRow: { totalValuation: number; totalChange: number } | undefined;
        if (config.amounts && allDataAvailable && validStockDataList.length > 0) {
            totalRow = { totalValuation, totalChange };
        } else if (config.amounts && !allDataAvailable) {
            console.warn('Skipping total valuation calculation because some stock data is missing or invalid.');
        }

        if (validStockDataList.length > 0) {
            const tableLines = formatStockTable(validStockDataList, totalRow);
            await sendToDiscord(config.discordWebhookUrl, tableLines);
        } else {
            console.log('No stock data retrieved.');
        }

    } catch (error) {
        console.error('An error occurred:', error);
        process.exit(1);
    }
}

if (import.meta.main) {
    main();
}
