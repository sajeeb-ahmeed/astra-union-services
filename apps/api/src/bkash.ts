import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { pool } from './db.js';
import { ApiError } from './models.js';

// bKash Tokenized Checkout v2, without agreement. Provider documentation checked
// 2026-10-17. Wallet numbers, OTPs and PINs are handled only on bKash's page.
export type CreatedPayment = { paymentId: string; checkoutUrl: string; signature: string; amountMinor: number; currency: 'BDT'; invoice: string };
export type PaymentResult = { paymentId: string; status: string; transactionId?: string; amountMinor: number; currency: string; invoice: string; intent: string; serviceFeeMinor?: number; creditedAmountMinor?: number; couponAmountMinor?: number };
export type TransactionResult = { transactionId: string; status: string; amountMinor: number; currency: string; merchantAccount: string; serviceFeeMinor?: number; creditedAmountMinor?: number; couponAmountMinor?: number };
export interface Gateway {
  provider: 'BKASH'; environment: 'SANDBOX' | 'LIVE'; merchantAccount: string;
  create(input: {invoice: string; amountMinor: number; callbackURL: string; payerReference: string}): Promise<CreatedPayment>;
  execute(paymentId: string): Promise<PaymentResult>;
  query(paymentId: string): Promise<PaymentResult>;
  search(transactionId: string): Promise<TransactionResult>;
}
export type BkashConfig = {
  tenantId: string; environment: 'SANDBOX' | 'LIVE'; merchantAccount: string;
  appKey: string; appSecret: string; username: string; password: string;
  encryptionKey: string; publicOrigin: string;
};
type Tokens = { idToken: string; refreshToken: string; expiresAt: number; refreshAfter: number };
export type TokenState = { fingerprint: string; encryptedTokens: string | null; expiresAt: number | null; refreshAfter: number | null; authAttempts: number[] };
export interface TokenStore {
  withLock<T>(fn: (state: TokenState, save: (state: TokenState) => Promise<void>) => Promise<T>): Promise<T>;
}
const problem = (code: string, message: string, status = 502) => new ApiError(status, code, message);
function providerFailure(): never { throw problem('GATEWAY_RESPONSE_INVALID', 'The gateway response could not be verified. No payment has been confirmed.'); }
export function moneyToMinor(value: unknown): number {
  const raw = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof raw !== 'string' || !/^\d{1,10}(?:\.\d{1,2})?$/.test(raw)) return providerFailure();
  const [whole, fraction = ''] = raw.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor > 1_000_000_000_000) return providerFailure();
  return minor;
}
export function minorToMoney(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor <= 0 || minor > 400_000_000) throw problem('PAYMENT_AMOUNT_INVALID', 'A positive application assessment is required.', 422);
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}
export function normalizeMerchant(value: unknown): string {
  if (typeof value !== 'string') return providerFailure();
  const normalized = value.replace(/^\+?88(?=01)/, '');
  if (!/^01\d{9}$/.test(normalized)) return providerFailure();
  return normalized;
}
const string = (value: unknown, max = 255): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) return providerFailure();
  return value;
};
function alias(data: any, names: string[]): unknown {
  const values = names.filter(n => data[n] !== undefined).map(n => data[n]);
  if (!values.length || values.some(v => v !== values[0])) return providerFailure();
  return values[0];
}
function moneyFields(data: any) {
  return Object.fromEntries(['serviceFee', 'creditedAmount', 'couponAmount'].filter(k => data[k] !== undefined && data[k] !== null).map(k => [`${k}Minor`, moneyToMinor(data[k])])) as Pick<TransactionResult, 'serviceFeeMinor' | 'creditedAmountMinor' | 'couponAmountMinor'>;
}
export function validateCheckoutUrl(value: unknown, environment: 'SANDBOX' | 'LIVE'): string {
  const raw = string(value, 8000);
  let url: URL;
  try { url = new URL(raw); } catch { return providerFailure(); }
  const host = environment === 'SANDBOX' ? 'sandbox.payment.bkash.com' : 'payment.bkash.com';
  if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password || url.hash) return providerFailure();
  // Return the original provider URL without reconstruction or modification.
  return raw;
}
function encrypt(tokens: Tokens, config: BkashConfig) {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(config.encryptionKey, 'hex'), nonce);
  cipher.setAAD(Buffer.from(`${config.tenantId}:${config.environment}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
  return [nonce, cipher.getAuthTag(), ciphertext].map(v => v.toString('base64')).join('.');
}
function decrypt(value: string, config: BkashConfig): Tokens {
  try {
    const [nonce, tag, ciphertext] = value.split('.').map(v => Buffer.from(v, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(config.encryptionKey, 'hex'), nonce!);
    decipher.setAAD(Buffer.from(`${config.tenantId}:${config.environment}`));
    decipher.setAuthTag(tag!);
    const tokens = JSON.parse(Buffer.concat([decipher.update(ciphertext!), decipher.final()]).toString('utf8'));
    string(tokens.idToken, 20000); string(tokens.refreshToken, 20000);
    if (!Number.isFinite(tokens.expiresAt) || !Number.isFinite(tokens.refreshAfter)) throw new Error();
    return tokens;
  } catch { throw problem('GATEWAY_TOKEN_UNAVAILABLE', 'The stored gateway token could not be read. An administrator must check gateway configuration.', 503); }
}

export class PostgresTokenStore implements TokenStore {
  constructor(private tenantId: string) {}
  async withLock<T>(fn: (state: TokenState, save: (state: TokenState) => Promise<void>) => Promise<T>): Promise<T> {
    const db = await pool.connect();
    let locked = false, damaged = false;
    const lockName = `astra:bkash-token:${this.tenantId}`;
    const scoped = async <R>(work:()=>Promise<R>):Promise<R> => {
      await db.query('BEGIN');
      try {
        await db.query("SELECT set_config('astra.tenant_id',$1,true)",[this.tenantId]);
        const result=await work(); await db.query('COMMIT'); return result;
      } catch(error) { await db.query('ROLLBACK').catch(()=>{damaged=true;}); throw error; }
    };
    try {
      // A session lock spans separate committed reservations and provider I/O.
      // A crash releases the lock but does not erase an already committed auth call.
      await db.query("SELECT pg_advisory_lock(hashtextextended($1,0))",[lockName]);
      locked = true;
      const row = await scoped(async()=>{
        await db.query("INSERT INTO gateway_token_cache(tenant_id,credential_fingerprint) VALUES($1,'') ON CONFLICT DO NOTHING", [this.tenantId]);
        return (await db.query('SELECT * FROM gateway_token_cache WHERE tenant_id=$1', [this.tenantId])).rows[0];
      });
      const state: TokenState = {fingerprint:row.credential_fingerprint, encryptedTokens:row.encrypted_tokens, expiresAt:row.expires_at?.getTime() ?? null, refreshAfter:row.refresh_after?.getTime() ?? null, authAttempts:row.auth_attempts.map((v:Date)=>v.getTime())};
      return await fn(state, s=>scoped(async()=>{
        await db.query('UPDATE gateway_token_cache SET credential_fingerprint=$2,encrypted_tokens=$3,expires_at=$4,refresh_after=$5,auth_attempts=$6 WHERE tenant_id=$1', [this.tenantId,s.fingerprint,s.encryptedTokens,s.expiresAt === null ? null : new Date(s.expiresAt),s.refreshAfter === null ? null : new Date(s.refreshAfter),s.authAttempts.map(t=>new Date(t))]);
      }));
    } finally {
      if(locked) await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lockName]).catch(()=>{damaged=true;});
      db.release(damaged?new Error('Gateway token connection is not reusable.'):undefined);
    }
  }
}

export class BkashGateway implements Gateway {
  readonly provider = 'BKASH' as const;
  readonly environment: 'SANDBOX' | 'LIVE';
  readonly merchantAccount: string;
  private readonly base: string;
  private readonly fingerprint: string;
  constructor(private config: BkashConfig, private store: TokenStore = new PostgresTokenStore(config.tenantId), private transport: typeof fetch = fetch, private now: () => number = Date.now) {
    if (!/^[a-f\d]{64}$/i.test(config.encryptionKey)) throw problem('GATEWAY_CONFIGURATION_INVALID', 'Gateway token encryption must be configured.', 503);
    this.environment = config.environment;
    this.merchantAccount = normalizeMerchant(config.merchantAccount);
    this.base = config.environment === 'SANDBOX' ? 'https://tokenized.sandbox.bka.sh/v2/tokenized-checkout' : 'https://tokenized.pay.bka.sh/v2/tokenized-checkout';
    this.fingerprint = createHash('sha256').update(JSON.stringify([config.environment,config.appKey,config.appSecret,config.username,config.password,this.merchantAccount,config.encryptionKey])).digest('hex');
  }
  private async post(path: string, body: unknown, headers: Record<string,string>): Promise<any> {
    let response: Response;
    try {
      response = await this.transport(this.base + path, {method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json','Accept':'application/json',...headers},body:JSON.stringify(body)});
    } catch { throw problem('GATEWAY_UNAVAILABLE', 'The payment gateway did not return a verified response. Check the existing payment before trying again.', 503); }
    if (!response.ok) throw problem('GATEWAY_UNAVAILABLE', 'The gateway request was not completed. Payment status must be checked before another attempt.', 503);
    const data = await response.json().catch(()=>providerFailure());
    if (!data || typeof data !== 'object' || Array.isArray(data)) return providerFailure();
    if ((data.statusCode !== undefined && data.statusCode !== '0000') || data.externalCode) throw problem('GATEWAY_REJECTED', 'The gateway rejected this request. No payment confirmation was accepted.');
    return data;
  }
  private async token(): Promise<string> {
    // Commit auth-attempt timestamps even when the network fails. The row lock and
    // encrypted durable cache prevent cold starts/workers exhausting 2 calls/hour.
    const outcome = await this.store.withLock(async (state, save) => {
      const now = this.now();
      const prior = state.fingerprint === this.fingerprint && state.encryptedTokens ? decrypt(state.encryptedTokens, this.config) : null;
      if (prior && prior.refreshAfter > now && prior.expiresAt > now + 60000) return {token:prior.idToken};
      const attempts = state.authAttempts.filter(t=>t > now - 3600000);
      if (attempts.length >= 2) return {error:problem('GATEWAY_TOKEN_RATE_LIMIT', 'Gateway authentication is temporarily limited. Please retry after the current authentication window.', 503)};
      state = {...state,authAttempts:[...attempts,now]};
      await save(state);
      try {
        const useRefresh = prior && prior.expiresAt > now - 29 * 86400000;
        const data = await this.post(useRefresh ? '/auth/refresh-token' : '/auth/grant-token', {app_key:this.config.appKey,app_secret:this.config.appSecret,...(useRefresh ? {refresh_token:prior.refreshToken} : {})}, {username:this.config.username,password:this.config.password});
        const lifetime = Number(data.expires_in);
        if (!Number.isInteger(lifetime) || lifetime < 600 || lifetime > 86400) return providerFailure();
        const tokens: Tokens = {idToken:string(data.id_token,20000),refreshToken:string(data.refresh_token,20000),expiresAt:now+lifetime*1000,refreshAfter:now+Math.min(3000000,(lifetime-300)*1000)};
        await save({...state,fingerprint:this.fingerprint,encryptedTokens:encrypt(tokens,this.config),expiresAt:tokens.expiresAt,refreshAfter:tokens.refreshAfter});
        return {token:tokens.idToken};
      } catch (error) { return {error}; }
    });
    if ('error' in outcome) throw outcome.error;
    return outcome.token!;
  }
  private async call(path: string, body: unknown) {
    const token = await this.token();
    return this.post(path,body,{'Authorization':token,'X-App-Key':this.config.appKey});
  }
  async create(input: {invoice:string;amountMinor:number;callbackURL:string;payerReference:string}): Promise<CreatedPayment> {
    const amount = minorToMoney(input.amountMinor);
    if (!/^[a-zA-Z0-9_-]{1,255}$/.test(input.invoice) || !/^[a-zA-Z0-9_-]{1,255}$/.test(input.payerReference)) throw problem('PAYMENT_REFERENCE_INVALID','Invalid internal payment reference.',422);
    let callback: URL;
    try { callback = new URL(input.callbackURL); } catch { return providerFailure(); }
    if (callback.origin !== this.config.publicOrigin || callback.username || callback.password || callback.hash || !callback.pathname.startsWith('/api/v1/payments/bkash/callback/')) return providerFailure();
    const data = await this.call('/payment/create',{payerReference:input.payerReference,callbackURL:input.callbackURL,amount,currency:'BDT',intent:'sale',merchantInvoiceNumber:input.invoice});
    const result: CreatedPayment = {paymentId:string(data.paymentId),checkoutUrl:validateCheckoutUrl(alias(data,['bKashURL','bkashURL']),this.environment),signature:string(data.signature,1000),amountMinor:moneyToMinor(data.amount),currency:data.currency,invoice:string(data.merchantInvoiceNumber)};
    if (result.amountMinor!==input.amountMinor || result.currency!=='BDT' || result.invoice!==input.invoice || data.intent!=='sale' || data.transactionStatus!=='Initiated' || data.callbackURL!==input.callbackURL) return providerFailure();
    return result;
  }
  private payment(data: any): PaymentResult {
    const result: PaymentResult = {paymentId:string(data.paymentId),status:string(data.transactionStatus,100),amountMinor:moneyToMinor(data.amount),currency:string(data.currency,10),invoice:string(alias(data,['merchantInvoiceNumber','merchantInvoice'])),intent:string(data.intent,30),...moneyFields(data)};
    if (data.trxId !== undefined) result.transactionId = string(data.trxId);
    if (result.status==='Completed' && !result.transactionId) return providerFailure();
    return result;
  }
  async execute(paymentId: string): Promise<PaymentResult> {
    const result = this.payment(await this.call('/payment/execute',{paymentId:string(paymentId)}));
    if (result.paymentId!==paymentId) return providerFailure();
    return result;
  }
  async query(paymentId: string): Promise<PaymentResult> {
    const result = this.payment(await this.call('/query/payment',{paymentId:string(paymentId)}));
    if (result.paymentId!==paymentId) return providerFailure();
    return result;
  }
  async search(transactionId: string): Promise<TransactionResult> {
    const data = await this.call('/general/search-transaction',{trxId:string(transactionId)});
    const result: TransactionResult = {transactionId:string(data.trxId),status:string(data.transactionStatus,100),amountMinor:moneyToMinor(data.amount),currency:string(data.currency,10),merchantAccount:normalizeMerchant(data.organizationAccount),...moneyFields(data)};
    if (result.transactionId!==transactionId) return providerFailure();
    return result;
  }
}

const overrides = new Map<string,Gateway>();
export function setGatewayForTests(tenantId: string, gateway: Gateway | null) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Gateway overrides are limited to test processes.');
  gateway ? overrides.set(tenantId,gateway) : overrides.delete(tenantId);
}
function configuration(tenantId: string): {config?:BkashConfig; environment:'DISABLED'|'SANDBOX'|'LIVE';reason:string} {
  const mode = process.env.BKASH_ENVIRONMENT ?? 'disabled';
  const environment = mode === 'sandbox' ? 'SANDBOX' : mode === 'live' ? 'LIVE' : 'DISABLED';
  if (environment==='DISABLED') return {environment,reason:'MERCHANT_SETUP_REQUIRED'};
  if (tenantId !== process.env.BKASH_TENANT_ID) return {environment,reason:'OFFICE_GATEWAY_NOT_CONFIGURED'};
  if (environment==='LIVE' && process.env.BKASH_LIVE_ENABLED!=='true') return {environment,reason:'LIVE_ACTIVATION_REQUIRED'};
  const keys = ['BKASH_APP_KEY','BKASH_APP_SECRET','BKASH_USERNAME','BKASH_PASSWORD','BKASH_MERCHANT_ACCOUNT','BKASH_TOKEN_ENCRYPTION_KEY','PUBLIC_ORIGIN'];
  if (keys.some(k=>!process.env[k])) return {environment,reason:'MERCHANT_SETUP_REQUIRED'};
  try {
    const origin=new URL(process.env.PUBLIC_ORIGIN!);
    if (origin.protocol!=='https:' || origin.origin!==process.env.PUBLIC_ORIGIN || !/^[a-f\d]{64}$/i.test(process.env.BKASH_TOKEN_ENCRYPTION_KEY!) || !/^[a-f\d-]{36}$/i.test(tenantId)) return {environment,reason:'GATEWAY_CONFIGURATION_INVALID'};
    const merchantAccount=normalizeMerchant(process.env.BKASH_MERCHANT_ACCOUNT);
    return {environment,reason:'CONFIGURED',config:{tenantId,environment,merchantAccount,appKey:process.env.BKASH_APP_KEY!,appSecret:process.env.BKASH_APP_SECRET!,username:process.env.BKASH_USERNAME!,password:process.env.BKASH_PASSWORD!,encryptionKey:process.env.BKASH_TOKEN_ENCRYPTION_KEY!,publicOrigin:origin.origin}};
  } catch { return {environment,reason:'GATEWAY_CONFIGURATION_INVALID'}; }
}
export function gatewayAvailability(tenantId: string) {
  const override=process.env.NODE_ENV==='test' ? overrides.get(tenantId) : undefined;
  const c=configuration(tenantId);
  return {provider:'BKASH' as const,environment:override?.environment ?? c.environment,configured:Boolean(override||c.config),available:Boolean(override||c.config),reason:override?'TEST_TRANSPORT':c.reason,bankSettlement:'NOT_CONNECTED' as const,nagad:{configured:false,reason:'NOT_INTEGRATED'}};
}
export function getGateway(tenantId: string): Gateway {
  if (process.env.NODE_ENV==='test' && overrides.has(tenantId)) return overrides.get(tenantId)!;
  const c=configuration(tenantId);
  if (!c.config) throw problem('GATEWAY_NOT_CONFIGURED','Online payment is unavailable until this office completes merchant setup.',503);
  return new BkashGateway(c.config);
}
