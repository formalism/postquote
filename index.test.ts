import { describe, expect, test } from 'bun:test';
import { buildFontCachePath, buildStockTableSvg, buildTableRows, formatStockTable, renderStockTablePng, splitDiscordTable } from './index';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

describe('formatStockTable', () => {
    test('formats stock rows as a single-line table without truncating names', () => {
        expect(formatStockTable([
            {
                name: 'ＳＢＩホールディングス(株)',
                code: '8473',
                price: '2,983',
                changeAmount: '+3',
                changePercent: '+0.10%'
            }
        ])).toEqual([
            '価格     前日比  騰落率  コード  銘柄                      ',
            '-------  ------  ------  ------  --------------------------',
            '2,983円    +3円  +0.10%  8473    ＳＢＩホールディングス(株)'
        ]);
    });

    test('appends a total row when portfolio summary exists', () => {
        expect(formatStockTable([
            {
                name: '住友化学(株)',
                code: '4005',
                price: '470',
                changeAmount: '+5.5',
                changePercent: '+1.18%'
            }
        ], {
            totalValuation: 1234567,
            totalChange: -890
        })).toEqual([
            '価格         前日比  騰落率  コード  銘柄        ',
            '-----------  ------  ------  ------  ------------',
            '      470円  +5.5円  +1.18%  4005    住友化学(株)',
            '-----------  ------  ------  ------  ------------',
            '1,234,567円  -890円                  評価額合計  '
        ]);
    });
});

describe('splitDiscordTable', () => {
    test('wraps each chunk as an independent code block', () => {
        const lines = [
            'コード  銘柄    価格   前日比  騰落率',
            '----  ------  ----  ----  ----',
            '1111  銘柄A   100円  +1円  +1%',
            '2222  銘柄B   200円  -2円  -1%'
        ];

        const chunks = splitDiscordTable(lines, 70);

        expect(chunks).toEqual([
            '```text\nコード  銘柄    価格   前日比  騰落率\n----  ------  ----  ----  ----\n```',
            '```text\n1111  銘柄A   100円  +1円  +1%\n2222  銘柄B   200円  -2円  -1%\n```'
        ]);
    });
});

describe('buildTableRows', () => {
    test('adds portfolio summary row when total values exist', () => {
        expect(buildTableRows([
            {
                name: '住友化学(株)',
                code: '4005',
                price: '470',
                changeAmount: '+5.5',
                changePercent: '+1.18%'
            }
        ], {
            totalValuation: 1234567,
            totalChange: -890
        })).toEqual([
            {
                name: '住友化学(株)',
                code: '4005',
                price: '470円',
                changeAmount: '+5.5円',
                changePercent: '+1.18%'
            },
            {
                name: '評価額合計',
                code: '',
                price: '1,234,567円',
                changeAmount: '-890円',
                changePercent: ''
            }
        ]);
    });
});

describe('buildStockTableSvg', () => {
    test('embeds escaped text into positioned SVG columns', () => {
        const svg = buildStockTableSvg([
            {
                name: 'A&B<テスト>',
                code: '1111',
                price: '100円',
                changeAmount: '+1円',
                changePercent: '+1%'
            }
        ]);

        expect(svg).toContain('A&amp;B&lt;テスト&gt;');
        expect(svg).toContain('font-family="Noto Sans CJK JP"');
        expect(svg).toContain('text-anchor="end">100円</text>');
        expect(svg).toContain('>コード</text>');
    });
});

describe('font helpers', () => {
    test('builds stable cache path from font URL', () => {
        const pathA = buildFontCachePath('https://fonts.example.com/a.woff2');
        const pathB = buildFontCachePath('https://fonts.example.com/a.woff2');
        const pathC = buildFontCachePath('https://fonts.example.com/b.woff2');

        expect(pathA).toBe(pathB);
        expect(pathA).toEndWith('.woff2');
        expect(pathA).not.toBe(pathC);
    });

    test('uses a safe fallback extension when font URL has no suffix', () => {
        const cachePath = buildFontCachePath('https://fonts.gstatic.com/l/font?kit=abc123');

        expect(cachePath).toStartWith('.cache/fonts/');
        expect(cachePath).toEndWith('.bin');
        expect(cachePath.includes('/l/font')).toBe(false);
    });
});

describe('renderStockTablePng', () => {
    test('renders PNG binary data from rows', async () => {
        const fontBuffer = await fs.readFile('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
        const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'postquote-font-cache-'));
        const fetcher: typeof fetch = async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('NotoSansCJKjp-Regular.otf')) {
                return new Response(fontBuffer, { status: 200 });
            }
            return new Response('not found', { status: 404 });
        };

        let thrown: unknown;
        try {
            await renderStockTablePng([
                {
                    name: '住友化学(株)',
                    code: '4005',
                    price: '470円',
                    changeAmount: '+5.5円',
                    changePercent: '+1.18%'
                }
            ], fetcher, cacheDir);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect(String(thrown)).toContain('Downloaded font does not contain expected family');
    });

    test('renders PNG binary data when embedded font matches expected family', async () => {
        const baseFontBuffer = await fs.readFile('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
        const familyMarker = new TextEncoder().encode('Noto Sans CJK JP');
        const fontBuffer = new Uint8Array(baseFontBuffer.length + familyMarker.length);
        fontBuffer.set(baseFontBuffer, 0);
        fontBuffer.set(familyMarker, baseFontBuffer.length);
        const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'postquote-font-cache-'));
        const fetcher: typeof fetch = async () => new Response(fontBuffer, { status: 200 });

        const png = await renderStockTablePng([
            {
                name: '住友化学(株)',
                code: '4005',
                price: '470円',
                changeAmount: '+5.5円',
                changePercent: '+1.18%'
            }
        ], fetcher, cacheDir);

        expect(png[0]).toBe(0x89);
        expect(png[1]).toBe(0x50);
        expect(png[2]).toBe(0x4e);
        expect(png[3]).toBe(0x47);
    });
});
