import { parseStockHtml } from './parser';

const mockHtml = `
<div class="PriceBoard__nameBlock__3rFf"><h2 class="PriceBoard__name__166W">住友化学(株)</h2></div>
<div class="PriceBoard__priceBlock__1PmX">
    <span class="StyledNumber__1fof StyledNumber--vertical__2aoh PriceBoard__price__1V0k">
        <span class="StyledNumber__item__1-yu"><span class="StyledNumber__value__3rXW">470</span></span>
    </span>
    <div class="PriceChangeLabel__2Kf0">
        <dl class="PriceChangeLabel__definition__3Jdj">
            <dd class="PriceChangeLabel__description__a5Lp">
                <span class="PriceChangeLabel__primary__Y_ut"><span class="StyledNumber__value__3rXW">+5.5</span></span>
                <span class="PriceChangeLabel__secondary__3BXI"><span class="StyledNumber__value__3rXW">+1.18</span><span class="StyledNumber__suffix__2SD5">%</span></span>
            </dd>
        </dl>
    </div>
</div>
`;

console.log("Running Verification for Code 4005 (Mocked)...");

const result = parseStockHtml(mockHtml, "4005");

console.log("Result:", result);

let passed = true;

if (result.name !== "住友化学(株)") {
    console.error(`FAIL: Name mismatch. Expected '住友化学(株)', got '${result.name}'`);
    passed = false;
} else {
    console.log("PASS: Name matches");
}

if (result.price !== "470") {
    console.error(`FAIL: Price mismatch. Expected '470', got '${result.price}'`);
    passed = false;
} else {
    console.log("PASS: Price matches");
}

if (result.changeAmount !== "+5.5") {
    console.error(`FAIL: Change Amount mismatch. Expected '+5.5', got '${result.changeAmount}'`);
    passed = false;
} else {
    console.log("PASS: Change Amount matches");
}

if (result.changePercent !== "+1.18%") {
    console.error(`FAIL: Change Percent mismatch. Expected '+1.18%', got '${result.changePercent}'`);
    passed = false;
} else {
    console.log("PASS: Change Percent matches");
}

if (passed) {
    console.log("\nVERIFICATION PASSED: The parser correctly extracts the specified values.");
} else {
    console.error("\nVERIFICATION FAILED");
    process.exit(1);
}
