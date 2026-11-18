import crypto from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import { abbSignatureInput, configuredAbbGateway } from '../../src/server/abbAcquiring';
import type { InvoiceRequest } from '../../src/server/paymentGateway';

const keys = () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const merchant = keys();
const bank = keys();
const environment = {
  VERCEL_ENV: 'production',
  ABB_EPOS_GATEWAY_URL: 'https://mpi.3dsecure.az/cgi-bin/cgi_link',
  ABB_EPOS_TERMINAL: '00000042',
  ABB_EPOS_MERCHANT_NAME: 'Test merchant',
  ABB_EPOS_MERCHANT_PRIVATE_KEY: merchant.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  ABB_EPOS_GATEWAY_PUBLIC_KEY: bank.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  ABB_EPOS_CHECKOUT_TTL_SECONDS: '300',
  APP_URL: 'https://example.test',
};
const invoiceRequest = (): InvoiceRequest => ({
  reservationId: 'booked-group', attempt: 'attempt-1', eventId: 'runway', eventTitle: 'Test runway',
  language: 'AZ', amountMinor: 15600, expiresAt: Date.now() + 6 * 3600 * 1000,
});

function memoryFirestore() {
  const rows = new Map<string, Record<string, unknown>>();
  const snapshot = (path: string) => ({ get: (name: string) => rows.get(path)?.[name], data: () => rows.get(path) });
  return {
    doc: (path: string) => ({
      path,
      get: async () => snapshot(path),
      update: async (changes: Record<string, unknown>) => { rows.set(path, { ...rows.get(path), ...changes }); },
    }),
    runTransaction: (work: (transaction: unknown) => unknown) => {
      const set = (ref: { path: string }, row: Record<string, unknown>) => rows.set(ref.path, row);
      return work({ get: async (ref: { path: string }) => snapshot(ref.path), set, create: set });
    },
  } as unknown as Firestore;
}

function bankAnswer(orderId: string, values: Record<string, string> = {}) {
  const fields = {
    ORDER: orderId, TRAN_TRTYPE: '1', TRTYPE: '1', ACTION: '0', RC: '00',
    TERMINAL: environment.ABB_EPOS_TERMINAL, CURRENCY: 'AZN', AMOUNT: '156.00',
    APPROVAL: '123456', RRN: '123456789012', INT_REF: 'FAKEBANK00000001', ...values,
  };
  const input = abbSignatureInput(fields, ['AMOUNT', 'TERMINAL', 'APPROVAL', 'RRN', 'INT_REF']);
  return { ...fields, P_SIGN: crypto.sign('RSA-SHA256', input, bank.privateKey).toString('hex') };
}

describe('ABB hosted checkout', () => {
  it('requires a contracted production terminal or the local sandbox configuration', () => {
    const db = memoryFirestore();
    expect(configuredAbbGateway(db, { ...environment, VERCEL_ENV: 'preview' })).toBeNull();
    expect(configuredAbbGateway(db, { ...environment, ABB_EPOS_CHECKOUT_TTL_SECONDS: '' })).toBeNull();
    expect(configuredAbbGateway(db, { ...environment, ABB_EPOS_GATEWAY_URL: 'https://example.test/api' })).toBeNull();
    const sandbox = { ...environment, ABB_EPOS_GATEWAY_URL: 'https://testmpi.3dsecure.az/cgi-bin/cgi_link', VERCEL_ENV: '', VITE_USE_EMULATORS: 'true' };
    expect(configuredAbbGateway(db, sandbox)).toBeNull();
    expect(configuredAbbGateway(db, { ...sandbox, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).not.toBeNull();
  });

  it('builds and signs the bank-hosted form and protects the reservation deadline', async () => {
    const gateway = configuredAbbGateway(memoryFirestore(), environment, vi.fn<typeof fetch>())!;
    const request = invoiceRequest();
    const invoice = await gateway.create(request);
    if (!invoice.form) throw new Error('The bank form was not created');
    expect(invoice.id).toMatch(/^\d{14}$/);
    expect(invoice.checkoutExpiresAt).toBeGreaterThan(Date.now());
    expect(invoice.checkoutExpiresAt).toBeLessThan(request.expiresAt);
    expect(invoice.form.action).toBe(environment.ABB_EPOS_GATEWAY_URL);
    const fields = invoice.form.fields;
    expect(fields).toMatchObject({ ORDER: invoice.id, CURRENCY: 'AZN', AMOUNT: '156.00', TRTYPE: '1', BACKREF: 'https://example.test/api/payments/abb/callback' });
    const input = Buffer.from(['AMOUNT', 'CURRENCY', 'TERMINAL', 'TRTYPE', 'TIMESTAMP', 'NONCE', 'MERCH_URL']
      .map(name => fields[name].length + fields[name]).join(''));
    expect(crypto.verify('RSA-SHA256', input, merchant.publicKey, Buffer.from(fields.P_SIGN, 'hex'))).toBe(true);
    expect((await gateway.create({ ...request, attempt: 'another-attempt' })).id).not.toEqual(invoice.id);
    await expect(gateway.create({ ...request, expiresAt: Date.now() + 10_000 })).rejects.toMatchObject({ status: 409 });
  });

  it('waits for a matching authoritative bank response before accepting payment', async () => {
    const status = vi.fn<typeof fetch>();
    const gateway = configuredAbbGateway(memoryFirestore(), environment, status)!;
    const invoice = await gateway.create(invoiceRequest());
    const answer = bankAnswer(invoice.id);
    expect(await gateway.callback({ ...answer, P_SIGN: '' })).toBeNull();
    expect(await gateway.callback({ ...answer, TERMINAL: '00000099' })).toBeNull();
    expect(await gateway.callback(answer)).toMatchObject({ id: invoice.id, reservationId: 'booked-group' });

    status.mockResolvedValueOnce(Response.json(bankAnswer(invoice.id, { AMOUNT: '52.00' })));
    expect(await gateway.status(invoice.id, 15600)).toBe('pending');
    status.mockResolvedValueOnce(Response.json(bankAnswer(invoice.id, { ORDER: '00000000000000' })));
    expect(await gateway.status(invoice.id, 15600)).toBe('pending');
    status.mockResolvedValueOnce(Response.json(bankAnswer(invoice.id, { APPROVAL: '' })));
    expect(await gateway.status(invoice.id, 15600)).toBe('paid');
    expect(await gateway.status(invoice.id, 15600)).toBe('paid');
    expect(status).toHaveBeenCalledTimes(3);
    const [address, init] = status.mock.calls[0];
    expect(address).toBe(environment.ABB_EPOS_GATEWAY_URL);
    const fields = Object.fromEntries(init?.body as URLSearchParams);
    expect(fields).toMatchObject({ TRAN_TRTYPE: '1', TRTYPE: '90', TERMINAL: environment.ABB_EPOS_TERMINAL, ORDER: invoice.id });
    const input = abbSignatureInput(fields, ['ORDER', 'TERMINAL', 'TRTYPE', 'TIMESTAMP', 'NONCE']);
    expect(crypto.verify('RSA-SHA256', input, merchant.publicKey, Buffer.from(fields.P_SIGN, 'hex'))).toBe(true);
  });
});
