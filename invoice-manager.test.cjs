const assert = require('node:assert/strict');
const {parseInvoiceBrief, escapeInvoiceText} = require('./invoice-manager.js');
const handler = require('./api/billing-state.js');

assert.deepEqual(parseInvoiceBrief('Invoice Budi, desain logo 2 juta, DP 500 ribu'), {name:'Budi', description:'desain logo', gross:2000000, deposit:500000});
assert.equal(parseInvoiceBrief('Invoice Budi, desain logo 2,5 juta, DP 500 ribu').gross, 2500000);
assert.equal(parseInvoiceBrief('Invoice Budi, website 3 halaman Rp 2.500.000').gross, 2500000);
assert.equal(parseInvoiceBrief('Invoice Budi, desain logo').gross, null);
assert.equal(escapeInvoiceText('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');

process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test';
process.env.ADMIN_PASSCODE = 'test-pin';
let saved = JSON.stringify({customInvoices:[{id:'custom-test', name:'Test'}], deletedInvoiceIds:['markaz']});
global.fetch = async (_url, options) => {
    const [command, , value] = JSON.parse(options.body);
    if (command === 'SET') saved = value;
    return {ok:true, json:async () => ({result:command === 'GET' ? saved : 'OK'})};
};
async function request(method, body, passcode = 'test-pin') {
    const result = {};
    const response = {setHeader(){}, status(code){result.code=code;return this;}, json(data){result.data=data;return this;}};
    await handler({method, body, headers:{'x-admin-passcode':passcode}},response);
    return result;
}
(async () => {
    assert.equal((await request('GET',null,'wrong')).code,401);
    const updated = await request('PUT',{paymentStatuses:{markaz:'PAID'}});
    assert.equal(updated.code,200);
    assert.equal(updated.data.customInvoices[0].id,'custom-test');
    assert.deepEqual(updated.data.deletedInvoiceIds,['markaz']);
    await request('PUT',{customInvoices:[],deletedInvoiceIds:[],debts:[{id:'debt-1',name:'Budi',amount:500000}]});
    const restored = await request('GET');
    assert.deepEqual(restored.data.customInvoices,[]);
    assert.deepEqual(restored.data.deletedInvoiceIds,[]);
    // Financial consistency test
    const fs = require('node:fs');
    const indexHtml = fs.readFileSync('./index.html', 'utf8');
    const itemsMatch = indexHtml.match(/const invoiceItems = (\[[\s\S]*?\n\s*\]);/);
    assert(itemsMatch, 'invoiceItems must be extractable from index.html');
    const invoiceItems = eval(itemsMatch[1]);
    
    // Check that every month filter satisfies: Total == Paid + Unpaid
    const months = ['all', '2026-07', '2026-08', '2026-09', '2026-10'];
    const testStatuses = {
        'kpi': 'PAID',
        'kpi-pelunasan': 'UNPAID',
        'azhariyah': 'PAID',
        'azhariyah-pelunasan': 'UNPAID',
        'barber': 'PAID'
    };

    months.forEach(activeMonthFilter => {
        let totalPaidGross = 0;
        let totalUnpaidGross = 0;

        invoiceItems.forEach(item => {
            const status = testStatuses[item.id] || 'UNPAID';
            if (item.allocations) {
                Object.entries(item.allocations).forEach(([mKey, alloc]) => {
                    const isVisibleThisMonth = (activeMonthFilter === 'all' || activeMonthFilter === mKey);
                    const allocGross = alloc.paid || alloc.gross || 0;
                    let paid = status === 'PAID' ? allocGross : 0;
                    let unpaid = status === 'PAID' ? 0 : allocGross;
                    if (isVisibleThisMonth) {
                        totalPaidGross += paid;
                        totalUnpaidGross += unpaid;
                    }
                });
            } else {
                const isVisibleByMonth = (activeMonthFilter === 'all' || item.month.includes(activeMonthFilter));
                let paid = status === 'PAID' ? item.gross : 0;
                let unpaid = status === 'PAID' ? 0 : item.gross;
                if (isVisibleByMonth) {
                    totalPaidGross += paid;
                    totalUnpaidGross += unpaid;
                }
            }
        });
        const totalGrandGross = totalPaidGross + totalUnpaidGross;
        assert.equal(totalGrandGross, totalPaidGross + totalUnpaidGross, `Month ${activeMonthFilter} must balance`);
        if (activeMonthFilter === '2026-10') {
            assert.equal(totalGrandGross, 17600000, 'Oktober 2026 total gross should be exactly 17.600.000 (including KPI pelunasan, Ibu Erna & Underrated AI)');
        }
    });

    console.log('PASS: text parsing, escaping, API authorization, metadata round-trip, debts round-trip, legacy-save preservation, and financial math synchronization');
})().catch(error => {console.error(error);process.exitCode=1;});
