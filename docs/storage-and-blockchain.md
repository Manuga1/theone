# Storage and blockchain: should patient data be minted on-chain?

Research note for Maanas and Akash, answering the 2026-11-10 call's "research blockchain minting for data storage" item. Short answer: keep the data off-chain, keep the *history* append-only, and anchor a daily fingerprint of the audit log. The working model already does this (`server/services/audit.ts`); the reasons follow.

## 1. What a public chain guarantees, and what it does not

A public chain gives three things: **integrity** (a record cannot be altered without every validator noticing), **permanence** (it cannot be removed), and **availability** (anyone can read it from any node). It gives no **confidentiality**: every byte is public, forever, by design. Encryption before writing does not change the model; it only moves the question to the key.

That is the wrong fit for health data. The promise on the slide is "this is your asset, we're just managing it for you". An asset you can never withdraw, delete or re-scope is not managed on the participant's behalf.

## 2. Why encrypted health data on a public chain is a permanent liability

- **Key leak.** Every record ever written is exposed the moment a key is compromised. There is no rotation for data that is already public; re-encrypting means writing it again, and the old ciphertext stays.
- **Future cryptanalysis.** Ciphertext written today must survive attacks for the participant's lifetime. Harvest-now-decrypt-later is a stated threat model for long-lived data; the chain is a perfect harvesting target because the data is pre-collected and labelled.
- **No deletion.** The founders' own boundaries (consent visible and revocable; withdraw; category delete; source disconnect) all assume the platform can stop serving data. On-chain, "stop serving" is impossible; the best available is "stop holding the key" (crypto-shredding), which regulators have not accepted as equivalent to erasure.
- **Regulatory collision.** HIPAA (if a covered-entity or business-associate relationship arises through providers or payers), GDPR Article 17 erasure, and the state consumer-health laws that explicitly reach non-HIPAA health apps (Washington's My Health My Data Act, Nevada SB 370, Connecticut's CTDPA health amendments) each contain deletion duties. A public immutable copy cannot satisfy them; a hash of a record is itself arguably personal data under GDPR guidance.
- **Size.** The notes' own upper bound, an MRI/CT study, is hundreds of MB; no general-purpose chain is designed for that (Solana caps a single account at 10 MB; Ethereum execution blocks are tens of millions of gas).

## 3. Cost, order of magnitude

We have no web access in this environment, so every price below is a dated approximation from memory, roughly 2025 levels; plug current prices into the formulas before quoting anyone.

| Venue | Cost model and formula | Assumptions used | 50 KB nucleus (one participant) | 100,000 participants (5 GB) | One 300 MB MRI study |
|---|---|---|---|---|---|
| Ethereum L1 calldata | `bytes × gas_per_byte × gas_price_gwei × 1e-9 × ETH_usd`; 16 gas/non-zero byte (up to 40 after the EIP-7623 calldata floor) | 10 gwei, $3,000/ETH | ~$25–60 | ~$2.4–6 M, and ~7 hours of the entire network's block capacity | ~$145–360 k; needs > 100 full blocks |
| Ethereum contract storage (SSTORE) | ~625 gas/byte (20,000 per 32-byte slot), ≈ 40× calldata | same | ~$1,000 | ~$100 M | not feasible |
| Solana account rent-exempt deposit | `bytes × rent_per_byte_year × 2 years`; ≈ 7 SOL/MB, refundable when the account is closed | $150/SOL → ~$1,000/MB | ~$50 | ~$5 M (refundable) | ~$300 k across ≥ 30 accounts (10 MB cap) |
| Arweave (permanent) | one-time fee per GB, ≈ $5–20/GB depending on AR price | $10/GB | < $0.001 | ~$25–100 | ~$1.5–6 |
| Filecoin (contracted, expiring deals) | per GB-month, often subsidised; `GB × months × price` | $0.01/GB-month | negligible | ~$0.60/year | ~$0.04/year |

Notes: Ethereum "blobs" (EIP-4844) are cheaper than calldata but are deleted after ~18 days, so they are not storage. Calldata is history, not state, and clients may prune history (EIP-4444); "permanent" is weaker than it sounds. Arweave is cheap enough that cost is not the objection — irreversibility and publicity are. Filecoin deals expire and need renewal, so it offers neither permanence nor confidentiality; it is a storage market, not a ledger.

### Minting fees against the 90/10 split

The model pays participants per contribution: $1 per food photo, $0.25 per blood-pressure reading, with the platform keeping 10% of gross (`shared/pricing.ts`, `fromNet` in `server/services/ledger.ts`). On a $1 photo the platform's gross margin is about 11 cents. A minimal Ethereum L1 transaction carrying only a 32-byte hash costs ≈ 21,500 gas ≈ $0.65 at the assumptions above, six times the margin on that item, before any data bytes. Per-event minting therefore either cuts into the participant's 90% (breaking the headline promise) or makes every micro-reward loss-making. Minting the data itself ($25–60 per nucleus) is two orders of magnitude worse. Batching changes everything: one 32-byte root per day for all events costs the same ~$0.65/day on L1 (~$250/year), fractions of a cent on an L2, or nothing via a Bitcoin aggregator such as OpenTimestamps.

## 4. What the founders actually want

Reading the notes, the goals are **tamper-evidence** (nobody, including us, can silently rewrite history), **provenance** (every value says where it came from), and **auditability** (a participant or regulator can check). "Updates append, old records preserved" is a database discipline, not a chain property. The architecture that delivers it:

1. **Off-chain encrypted storage with key management.** The graph and the identity vault stay in the platform's database, encrypted at rest, keys in a KMS/HSM with rotation and per-tenant separation; the vault is only ever read by `server/routes/participant.ts`. Deletion remains a real operation.
2. **Append-only data.** Observations are never overwritten: `one_time` facts close `valid_to` and append; governance deletes are soft (`deleted_at`), so lineage survives (`server/db/schema.sql`, `observation`).
3. **Hash-chained audit log.** Every governance or economic write (ledger rows, consent grants, licenses, revocations, withdrawals, deletions, disconnects, permission and vault-mode changes, branches created from review) appends an `audit_event` **inside the same transaction**. `hash = sha256(prev_hash | canonicalJson{kind, refTable, refId, payload, at})`, first `prev_hash = 'genesis'`. Editing or removing any row breaks every hash after it (`appendAudit`, `verifyChain` in `server/services/audit.ts`; `POST /api/participant/audit/verify`; tests in `tests/unit/audit.test.ts`).
4. **Daily Merkle-root anchoring.** Each past day's event hashes are summarised by a Merkle root in `audit_anchor` (`ensureAnchors`, `merkleRoot`). Status is `'simulated'`; production would publish that 32-byte root, and nothing else, to a public chain or timestamping service. No patient data, no per-person hash, so there is nothing to decrypt or to erase. A participant proves an event by a Merkle path from their event to a published root.
5. **Participant-visible verification.** `GET /api/participant/audit` returns the participant's events, the head hash, the anchors and a fresh verification; the Earnings page shows "Tamper-evident log: N events, head hash, Verify" (`client/src/participant/Earnings.tsx`, `AuditCard`). The seed builds the chain deterministically (`server/seed/index.ts` calls `ensureAnchors`).

What this does not do, and what the chain would not have done either: it cannot prove the *content* of a value is true, only that the record of it has not changed since it was anchored.

## 5. Decision table

| Need | Public chain for data | Encrypted data on-chain | Off-chain + hash chain + daily anchor (this model) |
|---|---|---|---|
| Tamper-evidence | yes | yes | yes (chain); yes against the operator once anchored |
| Confidentiality | no | until key leak / cryptanalysis | yes, standard key management |
| Deletion, withdrawal, revocation | impossible | key destruction only | real deletes; audit record of the deletion stays |
| HIPAA / GDPR / state health laws | conflicts | unsettled | conventional, well-understood |
| Cost per participant | $25–60 (ETH), ~$50 (SOL), < 1¢ (Arweave) | same plus key ops | ~$0 (one tx per day for everyone) |
| MRI-scale files | not feasible | not feasible | ordinary object storage |
| Fits 90/10 micro-rewards | no | no | yes |

## 6. Open questions for counsel

1. Does any provider or payer integration make the platform a HIPAA business associate, and does that change what may leave our systems in any form?
2. Is a published Merkle root over event hashes (no per-person leaf) personal data under GDPR or the Washington MHMDA? Does it need a lawful-basis statement in the privacy notice?
3. Is crypto-shredding an acceptable erasure method in any jurisdiction we plan to operate in, should we ever anchor more than roots?
4. Retention: the audit log must outlive a participant's data (it records the deletion). What retention period and legal basis cover that, and must the participant be able to see it after withdrawal?
5. If an anchor is published, who is the controller of that record, and what do we tell participants about its permanence?
