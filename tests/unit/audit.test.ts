// Audit chain primitives: canonical JSON, event hashing from 'genesis', Merkle roots, verify + tamper detection, anchors.
import { beforeAll, describe, expect, it } from 'vitest';
import { appendAudit, canonicalJson, ensureAnchors, hashEvent, merkleRoot, sha256, verifyChain, GENESIS } from '../../server/services/audit';
import { seededDbs, alexId, type TestDbs } from '../helpers/db';

describe('audit chain primitives', () => {
  it('canonical JSON sorts keys recursively and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null }, u: undefined })).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
  it('hashEvent is sha256(prev | canonical) and starts from genesis', () => {
    const e = { kind: 'k', refTable: 't', refId: 1, payload: { x: 1 }, at: '2026-10-24T14:00:00Z' };
    expect(hashEvent(GENESIS, e)).toBe(sha256(`genesis|${canonicalJson({ kind: 'k', refTable: 't', refId: 1, payload: { x: 1 }, at: '2026-10-24T14:00:00Z' })}`));
    expect(hashEvent(GENESIS, e)).not.toBe(hashEvent('abc', e));
    expect(hashEvent(GENESIS, { ...e, payload: { x: 2 } })).not.toBe(hashEvent(GENESIS, e));
  });
  it('merkleRoot: empty → null, one → itself, pairs hashed, odd levels duplicate the last leaf', () => {
    expect(merkleRoot([])).toBeNull();
    expect(merkleRoot(['a'])).toBe('a');
    expect(merkleRoot(['a', 'b'])).toBe(sha256('ab'));
    expect(merkleRoot(['a', 'b', 'c'])).toBe(sha256(sha256('ab') + sha256('cc')));
    expect(merkleRoot(['a', 'b', 'c', 'd'])).toBe(sha256(sha256('ab') + sha256('cd')));
  });
});

describe('the seeded chain', () => {
  let t: TestDbs;
  beforeAll(async () => { t = await seededDbs(); });

  it('verifies from genesis; the seed produced events for every ledger row, grant and license', async () => {
    const v = await verifyChain(t.graph);
    expect(v.ok).toBe(true);
    expect(v.brokenAt).toBeNull();
    expect(v.events).toBeGreaterThan(20);
    const first = (await t.graph.get<{ prev_hash: string }>('SELECT prev_hash FROM audit_event ORDER BY id LIMIT 1'))!;
    expect(first.prev_hash).toBe(GENESIS);
    const ledgerRows = (await t.graph.get<{ n: number }>('SELECT COUNT(*) AS n FROM ledger_entry'))!.n;
    expect((await t.graph.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_event WHERE kind LIKE 'ledger_%'"))!.n).toBe(ledgerRows);
    const pid = await alexId(t.graph);
    expect((await t.graph.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_event WHERE participant_id = ? AND kind = 'license_created'", pid))!.n).toBe(7);
    expect((await t.graph.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_event WHERE participant_id = ? AND kind = 'branch_created'", pid))!.n).toBe(2);
  });
  it('daily anchors exist for every past day with events (status simulated) and are idempotent', async () => {
    const days = (await t.graph.get<{ n: number }>("SELECT COUNT(DISTINCT substr(at, 1, 10)) AS n FROM audit_event WHERE substr(at, 1, 10) < '2026-10-24'"))!.n;
    expect((await t.graph.get<{ n: number }>('SELECT COUNT(*) AS n FROM audit_anchor'))!.n).toBe(days);
    expect((await t.graph.get<{ s: string }>('SELECT DISTINCT status AS s FROM audit_anchor'))!.s).toBe('simulated');
    expect((await ensureAnchors(t.graph))).toBe(0);
    const a = (await t.graph.get<{ date: string; root: string; events: number }>('SELECT date, root, events FROM audit_anchor ORDER BY date DESC LIMIT 1'))!;
    const hashes = (await t.graph.all<{ hash: string }>('SELECT hash FROM audit_event WHERE substr(at, 1, 10) = ? ORDER BY id', a.date)).map((r) => r.hash);
    expect(hashes).toHaveLength(a.events);
    expect(merkleRoot(hashes)).toBe(a.root);
  });
  it('appendAudit links to the head; tampering with any earlier row breaks verification at that row', async () => {
    const head = (await t.graph.get<{ hash: string }>('SELECT hash FROM audit_event ORDER BY id DESC LIMIT 1'))!.hash;
    const r = await t.graph.tx(async () => await appendAudit(t.graph, { participantId: await alexId(t.graph), kind: 'test_event', summary: 'test', payload: { n: 1 } }));
    expect((await t.graph.get<{ prev_hash: string }>('SELECT prev_hash FROM audit_event WHERE id = ?', r.id))!.prev_hash).toBe(head);
    expect((await verifyChain(t.graph))).toMatchObject({ ok: true, headHash: r.hash });
    const victim = (await t.graph.get<{ id: number; payload_json: string }>('SELECT id, payload_json FROM audit_event ORDER BY id LIMIT 1 OFFSET 3'))!;
    await t.graph.run("UPDATE audit_event SET payload_json = ? WHERE id = ?", JSON.stringify({ ...(JSON.parse(victim.payload_json) as object), participantCents: 999999 }), victim.id);
    const broken = await verifyChain(t.graph);
    expect(broken.ok).toBe(false);
    expect(broken.brokenAt).toBe(victim.id);
    await t.graph.run('UPDATE audit_event SET payload_json = ? WHERE id = ?', victim.payload_json, victim.id);
    expect((await verifyChain(t.graph)).ok).toBe(true);
    // deleting a row breaks the link of the next one
    await t.graph.run('DELETE FROM audit_event WHERE id = ?', victim.id);
    expect((await verifyChain(t.graph)).brokenAt).toBe(victim.id + 1);
  });
});
