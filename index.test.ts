import { describe, expect, test } from 'bun:test';
import { formatStockTable, splitDiscordTable } from './index';

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
