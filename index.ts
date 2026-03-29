import { parseStockHtml, type StockData } from './parser';
import * as fs from 'fs/promises';
import { Resvg } from '@resvg/resvg-js';
import { createHash } from 'crypto';

interface Config {
    codes: string[];
    amounts?: number[];
    discordWebhookUrl: string;
}

const DISCORD_MAX_LENGTH = 2000;
const CODE_BLOCK_PREFIX = '```text\n';
const CODE_BLOCK_SUFFIX = '\n```';
const TABLE_IMAGE_WIDTH = 1200;
const TABLE_IMAGE_PADDING_X = 48;
const TABLE_IMAGE_PADDING_Y = 40;
const TABLE_HEADER_HEIGHT = 44;
const TABLE_ROW_HEIGHT = 42;
const TABLE_SEPARATOR_HEIGHT = 22;
const EMBEDDED_FONT_FAMILY = 'Noto Sans CJK JP';
const EMBEDDED_FONT_URL = 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf';
const FONT_DOWNLOAD_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FONT_CACHE_DIR = '.cache/fonts';

interface PortfolioSummary {
    totalValuation: number;
    totalChange: number;
}

let cachedEmbeddedFontBuffer: Uint8Array | null = null;
let cachedEmbeddedFontPath: string | null = null;

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
 * HTML/XML 上で安全に扱えるよう、文字列中の記号をエスケープする。
 */
function escapeXml(text: string): string {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

/**
 * フォント URL ごとに安定したキャッシュファイル名を作る。
 */
export function buildFontCachePath(fontUrl: string, cacheDir = FONT_CACHE_DIR): string {
    const url = new URL(fontUrl);
    const fileName = url.pathname.split('/').pop() ?? '';
    const extension = fileName.includes('.') ? fileName.split('.').pop() ?? 'bin' : 'bin';
    const hash = createHash('sha256').update(fontUrl).digest('hex');
    return `${cacheDir}/${hash}.${extension}`;
}

/**
 * バイナリ中に UTF-8 / UTF-16 で family 名が含まれるかを確認する。
 */
function bufferContainsFontFamily(buffer: Uint8Array, familyName: string): boolean {
    const utf8Text = Buffer.from(buffer).toString('utf8');
    if (utf8Text.includes(familyName)) {
        return true;
    }

    const utf16leText = Buffer.from(buffer).toString('utf16le');
    if (utf16leText.includes(familyName)) {
        return true;
    }

    const utf16beBytes: number[] = [];
    for (let index = 0; index + 1 < buffer.length; index += 2) {
        utf16beBytes.push(buffer[index + 1], buffer[index]);
    }
    const utf16beText = Buffer.from(utf16beBytes).toString('utf16le');
    return utf16beText.includes(familyName);
}

/**
 * キャッシュ済みフォントを読み込み、存在しない場合は null を返す。
 */
async function readCachedFont(fontUrl: string, cacheDir = FONT_CACHE_DIR): Promise<Uint8Array | null> {
    const filePath = buildFontCachePath(fontUrl, cacheDir);

    try {
        return new Uint8Array(await fs.readFile(filePath));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

/**
 * 不正なキャッシュフォントを削除する。
 */
async function deleteCachedFont(fontUrl: string, cacheDir = FONT_CACHE_DIR): Promise<void> {
    const filePath = buildFontCachePath(fontUrl, cacheDir);

    try {
        await fs.unlink(filePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
}

/**
 * 取得した Web フォントをローカルキャッシュへ保存する。
 */
async function writeCachedFont(fontUrl: string, buffer: Uint8Array, cacheDir = FONT_CACHE_DIR): Promise<void> {
    const filePath = buildFontCachePath(fontUrl, cacheDir);
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(filePath, buffer);
}

/**
 * 埋め込み用フォントをキャッシュ優先で取得し、resvg が直接読めるローカルファイルとして確保する。
 */
async function ensureEmbeddedFontFile(fetcher: typeof fetch = fetch, cacheDir = FONT_CACHE_DIR): Promise<string> {
    if (cachedEmbeddedFontPath) {
        return cachedEmbeddedFontPath;
    }

    const filePath = buildFontCachePath(EMBEDDED_FONT_URL, cacheDir);
    const cachedBuffer = await readCachedFont(EMBEDDED_FONT_URL, cacheDir);
    if (cachedBuffer) {
        if (bufferContainsFontFamily(cachedBuffer, EMBEDDED_FONT_FAMILY)) {
            cachedEmbeddedFontBuffer = cachedBuffer;
            cachedEmbeddedFontPath = filePath;
            return filePath;
        }

        await deleteCachedFont(EMBEDDED_FONT_URL, cacheDir);
    }

    const fontResponse = await fetcher(EMBEDDED_FONT_URL, {
        headers: {
            'User-Agent': FONT_DOWNLOAD_USER_AGENT
        }
    });
    if (!fontResponse.ok) {
        throw new Error(`Failed to fetch embedded font: ${fontResponse.status} ${fontResponse.statusText}`);
    }

    const buffer = new Uint8Array(await fontResponse.arrayBuffer());
    if (!bufferContainsFontFamily(buffer, EMBEDDED_FONT_FAMILY)) {
        throw new Error(`Downloaded font does not contain expected family: ${EMBEDDED_FONT_FAMILY}`);
    }

    await writeCachedFont(EMBEDDED_FONT_URL, buffer, cacheDir);
    cachedEmbeddedFontBuffer = buffer;
    cachedEmbeddedFontPath = filePath;
    return filePath;
}

/**
 * Discord に描画する表の各行データを組み立てる。
 */
export function buildTableRows(stockDataList: StockData[], totalRow?: PortfolioSummary): TableRow[] {
    const rows: TableRow[] = stockDataList.map(data => ({
        code: data.code,
        name: data.name,
        price: `${data.price}円`,
        changeAmount: `${data.changeAmount}円`,
        changePercent: data.changePercent
    }));

    if (totalRow) {
        const totalChangeSign = totalRow.totalChange > 0 ? '+' : '';
        rows.push({
            code: '',
            name: '評価額合計',
            price: `${totalRow.totalValuation.toLocaleString()}円`,
            changeAmount: `${totalChangeSign}${totalRow.totalChange.toLocaleString()}円`,
            changePercent: ''
        });
    }

    return rows;
}

/**
 * 株価一覧画像の 1 行を SVG の text 要素へ変換する。
 */
function buildRowSvg(row: TableRow, layout: {
    xPrice: number;
    xChangeAmount: number;
    xChangePercent: number;
    xCode: number;
    xName: number;
    nameWidth: number;
    y: number;
}): string {
    const rowColor = row.code === '' ? '#f3f4f7' : '#e7e9ee';
    const changeColor = row.changeAmount.startsWith('-') ? '#f38ba8' : row.changeAmount ? '#8bd5ca' : rowColor;

    return `
<text x="${layout.xPrice}" y="${layout.y}" fill="${rowColor}" font-size="28" font-family="${EMBEDDED_FONT_FAMILY}" text-anchor="end">${escapeXml(row.price)}</text>
<text x="${layout.xChangeAmount}" y="${layout.y}" fill="${changeColor}" font-size="28" font-family="${EMBEDDED_FONT_FAMILY}" text-anchor="end">${escapeXml(row.changeAmount)}</text>
<text x="${layout.xChangePercent}" y="${layout.y}" fill="${changeColor}" font-size="28" font-family="${EMBEDDED_FONT_FAMILY}" text-anchor="end">${escapeXml(row.changePercent)}</text>
<text x="${layout.xCode}" y="${layout.y}" fill="${rowColor}" font-size="28" font-family="${EMBEDDED_FONT_FAMILY}" text-anchor="end">${escapeXml(row.code)}</text>
<clipPath id="clip-name-${layout.y}">
  <rect x="${layout.xName}" y="${layout.y - 30}" width="${layout.nameWidth}" height="36" />
</clipPath>
<text x="${layout.xName}" y="${layout.y}" fill="${rowColor}" font-size="28" font-family="${EMBEDDED_FONT_FAMILY}" clip-path="url(#clip-name-${layout.y})">${escapeXml(row.name)}</text>`;
}

/**
 * 株価一覧画像の SVG を組み立てる。列は空白ではなく座標で揃える。
 */
export function buildStockTableSvg(rows: TableRow[]): string {
    const priceWidth = 180;
    const changeAmountWidth = 150;
    const changePercentWidth = 120;
    const codeWidth = 110;
    const columnGap = 28;
    const tableInnerWidth = TABLE_IMAGE_WIDTH - TABLE_IMAGE_PADDING_X * 2;
    const nameWidth = tableInnerWidth - priceWidth - changeAmountWidth - changePercentWidth - codeWidth - columnGap * 4;
    const xPrice = TABLE_IMAGE_PADDING_X + priceWidth;
    const xChangeAmount = xPrice + columnGap + changeAmountWidth;
    const xChangePercent = xChangeAmount + columnGap + changePercentWidth;
    const xCode = xChangePercent + columnGap + codeWidth;
    const xName = xCode + columnGap;
    const separatorCount = rows.some(row => row.code === '') ? 2 : 1;
    const imageHeight = TABLE_IMAGE_PADDING_Y * 2 + TABLE_HEADER_HEIGHT + rows.length * TABLE_ROW_HEIGHT + separatorCount * TABLE_SEPARATOR_HEIGHT;

    const headerY = TABLE_IMAGE_PADDING_Y + 28;
    const bodyStartY = TABLE_IMAGE_PADDING_Y + TABLE_HEADER_HEIGHT + 34;
    let currentY = bodyStartY;
    const bodyNodes: string[] = [];

    rows.forEach((row, index) => {
        const isTotalRow = row.code === '';

        if (index === 0 || isTotalRow) {
            const separatorY = currentY - 18;
            bodyNodes.push(`<line x1="${TABLE_IMAGE_PADDING_X}" y1="${separatorY}" x2="${TABLE_IMAGE_WIDTH - TABLE_IMAGE_PADDING_X}" y2="${separatorY}" stroke="#8a93a7" stroke-width="1"/>`);
            currentY += TABLE_SEPARATOR_HEIGHT;
        }

        bodyNodes.push(buildRowSvg(row, {
            xPrice,
            xChangeAmount,
            xChangePercent,
            xCode,
            xName,
            nameWidth,
            y: currentY
        }));
        currentY += TABLE_ROW_HEIGHT;
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${TABLE_IMAGE_WIDTH}" height="${imageHeight}" viewBox="0 0 ${TABLE_IMAGE_WIDTH} ${imageHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" rx="18" fill="#1f2430" />
  <text x="${xPrice}" y="${headerY}" fill="#f3f4f7" font-size="28" font-family="${EMBEDDED_FONT_FAMILY}" text-anchor="end">価格</text>
  <text x="${xChangeAmount}" y="${headerY}" fill="#f3f4f7" font-size="28" font-family="${EMBEDDED_FONT_FAMILY}" text-anchor="end">前日比</text>
  <text x="${xChangePercent}" y="${headerY}" fill="#f3f4f7" font-size="28" font-family="${EMBEDDED_FONT_FAMILY}" text-anchor="end">騰落率</text>
  <text x="${xCode}" y="${headerY}" fill="#f3f4f7" font-size="28" font-family="${EMBEDDED_FONT_FAMILY}" text-anchor="end">コード</text>
  <text x="${xName}" y="${headerY}" fill="#f3f4f7" font-size="28" font-family="${EMBEDDED_FONT_FAMILY}">銘柄</text>
  ${bodyNodes.join('\n  ')}
</svg>`;
}

/**
 * 埋め込みフォント込みで SVG をレンダリングし、Discord 添付用の PNG データを生成する。
 */
export async function renderStockTablePng(rows: TableRow[], fetcher: typeof fetch = fetch, cacheDir = FONT_CACHE_DIR): Promise<Uint8Array> {
    const svg = buildStockTableSvg(rows);
    const fontFile = await ensureEmbeddedFontFile(fetcher, cacheDir);
    const resvg = new Resvg(svg, {
        fitTo: {
            mode: 'width',
            value: TABLE_IMAGE_WIDTH
        },
        font: {
            loadSystemFonts: false,
            defaultFontFamily: EMBEDDED_FONT_FAMILY,
            fontFiles: [fontFile]
        }
    });

    return resvg.render().asPng();
}

/**
 * 表形式の本文をコードブロック単位で分割しながら Discord Webhook に送信する。
 */
async function sendTextToDiscord(webhookUrl: string, lines: string[]) {
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
 * PNG 画像を Discord Webhook に添付して送信する。
 */
async function sendImageToDiscord(webhookUrl: string, png: Uint8Array) {
    const formData = new FormData();
    formData.append('payload_json', JSON.stringify({ content: '株価一覧' }));
    formData.append('files[0]', new File([png], 'stock-table.png', { type: 'image/png' }));

    const response = await fetch(webhookUrl, {
        method: 'POST',
        body: formData
    });

    if (!response.ok) {
        throw new Error(`Failed to post image to Discord: ${response.status} ${await response.text()}`);
    }

    console.log('Successfully posted image to Discord.');
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

        let totalRow: PortfolioSummary | undefined;
        if (config.amounts && allDataAvailable && validStockDataList.length > 0) {
            totalRow = { totalValuation, totalChange };
        } else if (config.amounts && !allDataAvailable) {
            console.warn('Skipping total valuation calculation because some stock data is missing or invalid.');
        }

        if (validStockDataList.length > 0) {
            const rows = buildTableRows(validStockDataList, totalRow);

            try {
                const png = await renderStockTablePng(rows);
                await sendImageToDiscord(config.discordWebhookUrl, png);
            } catch (error) {
                console.warn('Falling back to text table because image rendering or upload failed.', error);
                const tableLines = formatStockTable(validStockDataList, totalRow);
                await sendTextToDiscord(config.discordWebhookUrl, tableLines);
            }
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
