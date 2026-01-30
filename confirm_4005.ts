import { parseStockHtml } from './parser';
import * as fs from 'fs/promises';

async function confirm() {
    try {
        const html = await fs.readFile('yahoo_4005.html', 'utf-8');
        const data = parseStockHtml(html, '4005');
        
        console.log("Parsed Data from yahoo_4005.html:");
        console.log(`Name: ${data.name}`);
        console.log(`Price: ${data.price}`);
        console.log(`Change Amount: ${data.changeAmount}`);
        console.log(`Change Percent: ${data.changePercent}`);

        const expected = {
            name: "住友化学(株)",
            price: "470",
            changeAmount: "+5.5",
            changePercent: "+1.18%"
        };

        if (data.name === expected.name &&
            data.price === expected.price &&
            data.changeAmount === expected.changeAmount &&
            data.changePercent === expected.changePercent) {
            console.log("\nCONFIRMATION SUCCESS: Retrieved values match the user's request.");
        } else {
            console.log("\nCONFIRMATION FAILED: Values do not match exactly.");
            console.log("Expected:", expected);
            console.log("Got:", data);
        }

    } catch (e) {
        console.error(e);
    }
}

confirm();
