import test from 'node:test';
import assert from 'node:assert/strict';
import { BkashGateway, moneyToMinor, minorToMoney, normalizeMerchant, validateCheckoutUrl, gatewayAvailability, getGateway, setGatewayForTests, type BkashConfig, type TokenStore, type TokenState } from '../src/bkash.js';

const config: BkashConfig = {tenantId:'11111111-1111-4111-8111-111111111111',environment:'SANDBOX',merchantAccount:'01700000000',appKey:'synthetic-app-key',appSecret:'synthetic-secret',username:'synthetic-user',password:'synthetic-pass',encryptionKey:'ab'.repeat(32),publicOrigin:'https://astra.example.test'};
const input = {invoice:'ASTRA_TEST_001',amountMinor:15210,callbackURL:'https://astra.example.test/api/v1/payments/bkash/callback/test-opaque-reference',payerReference:'ASTRA_TEST_PAYER'};
class MemoryTokenStore implements TokenStore {
  state: TokenState = {fingerprint:'',encryptedTokens:null,expiresAt:null,refreshAfter:null,authAttempts:[]};
  private tail: Promise<void> = Promise.resolve();
  async withLock<T>(fn: (state:TokenState,save:(state:TokenState)=>Promise<void>)=>Promise<T>) {
    const previous=this.tail;
    let release!:()=>void;
    this.tail=new Promise<void>(r=>release=r);
    await previous;
    try { return await fn(structuredClone(this.state),async state=>{this.state=structuredClone(state);}); }
    finally { release(); }
  }
}
type Call = {url:URL;body:any;headers:Headers;options:RequestInit};
function provider(overrides:Record<string,(call:Call)=>any>={}) {
  const calls:Call[]=[];
  const fetcher = (async (url:any,options:RequestInit) => {
    const call={url:new URL(String(url)),body:JSON.parse(String(options.body)),headers:new Headers(options.headers),options};
    calls.push(call);
    const path=call.url.pathname.replace('/v2/tokenized-checkout','');
    if (overrides[path]) return Response.json(await overrides[path]!(call));
    if(path.startsWith('/auth/')) return Response.json({statusCode:'0000',id_token:'test-id-token',refresh_token:'test-refresh-token',expires_in:3600});
    if(path==='/payment/create') return Response.json({paymentId:'PAYMENT_TEST_1',bkashURL:'https://sandbox.payment.bkash.com/?paymentId=PAYMENT_TEST_1&hash=synthetic',signature:'test-callback-signature',amount:call.body.amount,currency:'BDT',merchantInvoiceNumber:call.body.merchantInvoiceNumber,intent:'sale',transactionStatus:'Initiated',callbackURL:call.body.callbackURL});
    if(path==='/general/search-transaction') return Response.json({trxId:call.body.trxId,transactionStatus:'Completed',amount:'152.10',currency:'BDT',organizationAccount:'8801700000000',serviceFee:'1.50',creditedAmount:'150.60',payerAccount:'DO_NOT_PERSIST',payerType:'Customer'});
    return Response.json({paymentId:call.body.paymentId,trxId:'TRX_TEST_1',transactionStatus:'Completed',amount:'152.10',currency:'BDT',intent:'sale',...(path==='/query/payment'?{merchantInvoice:input.invoice}:{merchantInvoiceNumber:input.invoice}),payerAccount:'DO_NOT_PERSIST'});
  }) as typeof fetch;
  return {calls,fetcher};
}
test('BKASH-01: decimal amounts are exact minor units; invalid precision, signs and unsafe amounts fail closed',()=>{
  assert.equal(moneyToMinor('152.10'),15210);
  assert.equal(moneyToMinor('0.01'),1);
  assert.equal(moneyToMinor(15.75),1575);
  assert.equal(minorToMoney(10001),'100.01');
  assert.equal(normalizeMerchant('+8801700000000'),'01700000000');
  for(const v of ['1e3','1.001','-1','+1','NaN','',null,Infinity,'100000000000000']) assert.throws(()=>moneyToMinor(v));
  for(const v of [0,-1,1.2,400000001,Number.MAX_SAFE_INTEGER]) assert.throws(()=>minorToMoney(v));
});
test('BKASH-02: fixed v2 endpoint, provider-returned checkout and exact order fields are used; no customer credentials',async()=>{
  const mock=provider(),store=new MemoryTokenStore(),gateway=new BkashGateway(config,store,mock.fetcher);
  const created=await gateway.create(input);
  assert.equal(created.paymentId,'PAYMENT_TEST_1');
  assert.equal(created.amountMinor,15210);
  assert.equal(created.checkoutUrl,'https://sandbox.payment.bkash.com/?paymentId=PAYMENT_TEST_1&hash=synthetic');
  assert.equal(mock.calls.length,2);
  assert.equal(mock.calls[0]!.url.href,'https://tokenized.sandbox.bka.sh/v2/tokenized-checkout/auth/grant-token');
  assert.equal(mock.calls[1]!.url.pathname,'/v2/tokenized-checkout/payment/create');
  assert.deepEqual(mock.calls[1]!.body,{payerReference:input.payerReference,callbackURL:input.callbackURL,amount:'152.10',currency:'BDT',intent:'sale',merchantInvoiceNumber:input.invoice});
  assert.equal(mock.calls[1]!.headers.get('authorization'),'test-id-token');
  assert.equal(mock.calls[1]!.options.redirect,'error');
  assert.ok(mock.calls[1]!.options.signal);
  assert.ok(!JSON.stringify(created).includes('test-id-token'));
  assert.ok(!store.state.encryptedTokens!.includes('test-id-token'));
});
test('BKASH-03: durable encrypted cache is reused across instances and concurrent calls',async()=>{
  const mock=provider(),store=new MemoryTokenStore();
  await Promise.all(Array.from({length:6},()=>new BkashGateway(config,store,mock.fetcher).query('PAYMENT_TEST_1')));
  assert.equal(mock.calls.filter(c=>c.url.pathname.endsWith('/grant-token')).length,1);
  assert.equal(store.state.authAttempts.length,1);
  assert.equal(store.state.encryptedTokens!.split('.').length,3);
});
test('BKASH-04: refresh uses current documented credentials and persists rotated cache before expiry',async()=>{
  let now=1700000000000;
  const mock=provider(),store=new MemoryTokenStore(),gateway=new BkashGateway(config,store,mock.fetcher,()=>now);
  await gateway.query('PAYMENT_TEST_1');
  now+=50*60*1000+1;
  await gateway.query('PAYMENT_TEST_1');
  const refresh=mock.calls.find(c=>c.url.pathname.endsWith('/refresh-token'))!;
  assert.equal(refresh.body.refresh_token,'test-refresh-token');
  assert.equal(refresh.body.app_key,config.appKey);
  assert.equal(refresh.headers.get('username'),config.username);
  assert.equal(store.state.authAttempts.length,2);
  assert.ok(store.state.expiresAt!>now);
});
test('BKASH-05: auth failures consume the durable rate budget and do not retry secrets on every call',async()=>{
  const mock=provider({'/auth/grant-token':()=>{throw new Error('synthetic transport failure');}}),store=new MemoryTokenStore();
  for(let n=0;n<2;n++) await assert.rejects(new BkashGateway(config,store,mock.fetcher).query('PAYMENT_TEST_1'),(e:any)=>e.code==='GATEWAY_UNAVAILABLE');
  await assert.rejects(new BkashGateway(config,store,mock.fetcher).query('PAYMENT_TEST_1'),(e:any)=>e.code==='GATEWAY_TOKEN_RATE_LIMIT');
  assert.equal(mock.calls.length,2);
  assert.equal(store.state.authAttempts.length,2);
});
test('BKASH-06: create response echo mismatches and malicious redirect origins never become checkout links',async()=>{
  for(const changed of [{amount:'152.11'},{currency:'USD'},{merchantInvoiceNumber:'OTHER'},{intent:'authorization'},{callbackURL:'https://evil.example/'},{bkashURL:'https://sandbox.payment.bkash.com.evil.example/'},{bKashURL:'https://payment.bkash.com/'},{signature:''}]){
    const mock=provider({'/payment/create':call=>({paymentId:'P',bkashURL:'https://sandbox.payment.bkash.com/?p=1',signature:'signature',amount:'152.10',currency:'BDT',merchantInvoiceNumber:input.invoice,intent:'sale',transactionStatus:'Initiated',callbackURL:call.body.callbackURL,...changed})});
    await assert.rejects(new BkashGateway(config,new MemoryTokenStore(),mock.fetcher).create(input),(e:any)=>e.code==='GATEWAY_RESPONSE_INVALID');
  }
  for(const url of ['http://sandbox.payment.bkash.com/','https://evil@sandbox.payment.bkash.com/','https://sandbox.payment.bkash.com:8443/','https://sandbox.payment.bkash.com/#x']) assert.throws(()=>validateCheckoutUrl(url,'SANDBOX'));
});
test('BKASH-07: execute and query map their distinct invoice fields and strip payer wallet data',async()=>{
  const mock=provider(),gateway=new BkashGateway(config,new MemoryTokenStore(),mock.fetcher);
  const executed=await gateway.execute('PAYMENT_TEST_1'),queried=await gateway.query('PAYMENT_TEST_1'),searched=await gateway.search('TRX_TEST_1');
  assert.deepEqual(executed,queried);
  assert.equal(queried.invoice,input.invoice);
  assert.equal(searched.merchantAccount,config.merchantAccount);
  assert.equal(searched.serviceFeeMinor,150);
  assert.equal(searched.creditedAmountMinor,15060);
  assert.ok(!JSON.stringify([executed,queried,searched]).includes('DO_NOT_PERSIST'));
});
test('BKASH-08: missing, conflicting or foreign provider identities are rejected',async()=>{
  for(const changed of [{paymentId:'FOREIGN'},{merchantInvoice:'OTHER',merchantInvoiceNumber:input.invoice},{trxId:undefined},{amount:'152.101'}]){
    const mock=provider({'/query/payment':()=>({paymentId:'PAYMENT_TEST_1',transactionStatus:'Completed',trxId:'T1',amount:'152.10',currency:'BDT',merchantInvoice:input.invoice,intent:'sale',...changed})});
    await assert.rejects(new BkashGateway(config,new MemoryTokenStore(),mock.fetcher).query('PAYMENT_TEST_1'));
  }
  const mock=provider({'/general/search-transaction':()=>({trxId:'FOREIGN',transactionStatus:'Completed',amount:'1.00',currency:'BDT',organizationAccount:config.merchantAccount})});
  await assert.rejects(new BkashGateway(config,new MemoryTokenStore(),mock.fetcher).search('EXPECTED'));
});
test('BKASH-09: execute transport failure is surfaced once with no implicit execute retry',async()=>{
  const mock=provider({'/payment/execute':()=>{throw new Error('ambiguous provider timeout');}}),gateway=new BkashGateway(config,new MemoryTokenStore(),mock.fetcher);
  await assert.rejects(gateway.execute('PAYMENT_TEST_1'),(e:any)=>e.code==='GATEWAY_UNAVAILABLE');
  assert.equal(mock.calls.filter(c=>c.url.pathname.endsWith('/payment/execute')).length,1);
  assert.equal((await gateway.query('PAYMENT_TEST_1')).status,'Completed');
});
test('BKASH-10: callbacks are bound to this application origin and production cannot enable test overrides',async()=>{
  const mock=provider(),gateway=new BkashGateway(config,new MemoryTokenStore(),mock.fetcher);
  await assert.rejects(gateway.create({...input,callbackURL:'https://other.example/api/v1/payments/bkash/callback/x'}));
  assert.equal(mock.calls.length,0);
  const previous=process.env.NODE_ENV,old=process.env.BKASH_ENVIRONMENT;
  try {
    process.env.NODE_ENV='production'; process.env.BKASH_ENVIRONMENT='disabled';
    assert.throws(()=>setGatewayForTests(config.tenantId,gateway));
    assert.equal(gatewayAvailability(config.tenantId).configured,false);
    assert.equal(gatewayAvailability(config.tenantId).nagad.reason,'NOT_INTEGRATED');
    assert.throws(()=>getGateway(config.tenantId),(e:any)=>e.code==='GATEWAY_NOT_CONFIGURED');
  }finally{previous===undefined?delete process.env.NODE_ENV:process.env.NODE_ENV=previous;old===undefined?delete process.env.BKASH_ENVIRONMENT:process.env.BKASH_ENVIRONMENT=old;}
});
