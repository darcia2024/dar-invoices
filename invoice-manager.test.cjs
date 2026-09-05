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
    await request('PUT',{customInvoices:[],deletedInvoiceIds:[]});
    const restored = await request('GET');
    assert.deepEqual(restored.data.customInvoices,[]);
    assert.deepEqual(restored.data.deletedInvoiceIds,[]);
    console.log('PASS: text parsing, escaping, API authorization, metadata round-trip, and legacy-save preservation');
})().catch(error => {console.error(error);process.exitCode=1;});
