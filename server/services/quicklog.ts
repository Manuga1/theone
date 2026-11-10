// Quick log (text or voice transcript): classify → file / ask a follow-up (round trip via pendingId + answer) / review.
import { nowIso } from '@shared/clock';
import type { IngestKind, Proposal, QuickLogInput, QuickLogResult } from '@shared/api-types';
import { applyAnswer } from '@shared/branching';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { badRequest, conflict, notFound } from '../errors';
import { logActivity } from './activity';
import { classifyQuickLog, leafSpecs } from './classify';
import { fileItem, ingestRow, insertItem, toItem } from './ingest';
import { conceptPath } from './ontology';

const MAX_TEXT = 2000;

export async function quickLog(participantId: number, input: QuickLogInput, db: Db = graph()): Promise<QuickLogResult> {
  const via: IngestKind = input?.via === 'voice' ? 'voice' : 'quicklog';
  const now = nowIso();
  if (input?.pendingId) return await answerFollowUp(participantId, Number(input.pendingId), String(input.answer ?? ''), db, now);
  const text = String(input?.text ?? '').trim();
  if (!text) throw badRequest('text is required');
  if (text.length > MAX_TEXT) throw badRequest(`text must be at most ${MAX_TEXT} characters`);
  const r = await classifyQuickLog(text, db);
  const p = r.proposal;
  if (r.status === 'follow_up') {
    const id = await db.tx(async () => await insertItem(db, participantId, { kind: via, status: 'queued', text, proposal: p, reviewReason: null, createdAt: now }));
    return { status: 'follow_up', item: await toItem((await ingestRow(id, participantId, db))!, db), followUp: p.followUp, filedAs: null, rewardCents: 0, message: p.followUp?.question ?? 'One more detail?' };
  }
  if (r.status === 'needs_review') {
    const reason = p.newConcept ? (p.newConcept.isVariantOf ? `Proposes a new sub-branch “${p.newConcept.name}” under ${p.conceptName}` : `Proposes a new concept “${p.newConcept.name}”`) : p.conceptSlug ? `Confidence ${p.confidence} is below ${r.threshold}` : 'No branch matched';
    const id = await db.tx(async () => {
          const itemId = await insertItem(db, participantId, { kind: via, status: 'needs_review', text, proposal: p, reviewReason: reason, createdAt: now });
          await logActivity(db, { participantId, kind: 'ingest_review', text: `Quick log needs a look: “${text.slice(0, 60)}” — ${reason}`, occurredAt: now });
          return itemId;
        });
    return { status: 'needs_review', item: await toItem((await ingestRow(id, participantId, db))!, db), followUp: null, filedAs: null, rewardCents: 0, message: `${reason}. It is waiting in your inbox.` };
  }
  return await db.tx(async () => {
      const id = await insertItem(db, participantId, { kind: via, status: 'auto_filed', text, proposal: p, createdAt: now });
      const filed = await fileItem(db, participantId, id, via, p, { provenance: 'self_report', allowVariantCreate: true, classifier: p.classifier }, 'auto_filed', now);
      return await done(participantId, id, filed, db);
    });
}

async function answerFollowUp(participantId: number, pendingId: number, answer: string, db: Db, now: string): Promise<QuickLogResult> {
  const row = await ingestRow(pendingId, participantId, db);
  if (!row) throw notFound('pending quick log');
  if (row.status !== 'queued' || !row.proposal_json) throw conflict('this quick log is not waiting for an answer');
  if (!answer.trim()) throw badRequest('answer is required');
  const pending = JSON.parse(row.proposal_json) as Proposal;
  const leaf = (await leafSpecs(db)).find((l) => l.slug === pending.conceptSlug);
  if (!leaf) throw notFound('concept');
  const { proposal } = applyAnswer(leaf, pending, answer);
  const kind = row.kind;
  if (proposal.followUp) {
    await db.tx(async () => await db.run('UPDATE ingest_item SET proposal_json = ? WHERE id = ?', JSON.stringify(proposal), row.id));
    return { status: 'follow_up', item: await toItem((await ingestRow(row.id, participantId, db))!, db), followUp: proposal.followUp, filedAs: null, rewardCents: 0, message: `Sorry, I could not read a value in “${answer}”. ${proposal.followUp.question}` };
  }
  return await db.tx(async () => {
      await db.run('UPDATE ingest_item SET text = ?, proposal_json = ? WHERE id = ?', `${row.text ?? ''} → ${answer.trim()}`, JSON.stringify(proposal), row.id);
      // an explicit answer that names a new sub-branch creates it right away (the notes' "new brands create a new sub-branch")
      const filed = await fileItem(db, participantId, row.id, kind, { ...proposal, newConcept: null }, { provenance: 'self_report', allowVariantCreate: true, classifier: proposal.classifier }, 'auto_filed', now);
      return await done(participantId, row.id, filed, db);
    });
}

async function done(participantId: number, itemId: number, filed: Awaited<ReturnType<typeof fileItem>>, db: Db): Promise<QuickLogResult> {
  const item = await toItem((await ingestRow(itemId, participantId, db))!, db);
  const path = await conceptPath(filed.concept.slug, db);
  return {
    status: 'filed', item, followUp: null,
    filedAs: { conceptSlug: filed.concept.slug, conceptName: filed.concept.name, path, valueLabel: filed.valueLabel, newBranch: filed.variantCreated, observedAt: filed.observedAt },
    rewardCents: filed.rewardCents,
    message: `Filed under ${path.join(' › ')}${filed.valueLabel ? `: ${filed.valueLabel}` : ''}${filed.variantCreated ? ' — new sub-branch created' : ''}${filed.observationCount > 1 ? ` (+${filed.observationCount - 1} related)` : ''}${filed.rewardCents ? ` · +$${(filed.rewardCents / 100).toFixed(2)}` : ''}`,
  };
}
