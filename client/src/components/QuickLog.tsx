// Quick log box (founder notes: "easiest input is voice"): free text or a Web Speech API transcript → POST /participant/log.
// Shows a client-side "will be filed under …" preview while typing, runs the follow-up round trip (pendingId + answer)
// when the classifier needs an attribute ("What brand?"), and toasts the filed path plus any reward.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, Send, Sparkles, Inbox } from 'lucide-react';
import type { FollowUp, QuickLogInput, QuickLogResult } from '@shared/api-types';
import { api } from '../api';
import { useAction } from '../useAction';
import { pushToast } from '../toast';
import { useConcepts, previewConcept } from '../useConcepts';
import { ConceptPath } from './ConceptPath';
import { DemoOnlyHint } from './Brand';
import { money } from '@shared/fmt';

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechCtor = new () => SpeechRecognitionLike;

function speechCtor(): SpeechCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type QuickLogProps = {
  compact?: boolean;
  placeholder?: string;
  onFiled?: (r: QuickLogResult) => void;
};

export function filedToast(r: QuickLogResult): void {
  if (r.status === 'filed' && r.filedAs) {
    const reward = r.rewardCents > 0 ? ` · +${money(r.rewardCents, { cents: true })} reward` : '';
    pushToast('success', `Filed under ${r.filedAs.path.join(' › ')}${r.filedAs.newBranch ? ' (new branch)' : ''}: ${r.filedAs.valueLabel}${reward}`);
  } else if (r.status === 'needs_review') {
    pushToast('info', `Sent to your inbox for review: ${r.message}`);
  }
}

export function QuickLog({ compact, placeholder, onFiled }: QuickLogProps) {
  const [text, setText] = useState('');
  const [via, setVia] = useState<'text' | 'voice'>('text');
  const [listening, setListening] = useState(false);
  const [pending, setPending] = useState<{ id: number; followUp: FollowUp; original: string } | null>(null);
  const [answer, setAnswer] = useState('');
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const { concepts } = useConcepts();
  const hasSpeech = useMemo(() => speechCtor() !== null, []);
  const preview = useMemo(() => (text.trim().length >= 3 ? previewConcept(text, concepts) : null), [text, concepts]);

  useEffect(() => () => { recRef.current?.stop(); }, []);

  const submit = useAction(async (body: QuickLogInput) => {
    const r = await api.post<QuickLogResult>('/participant/log', body);
    if (r.status === 'follow_up' && r.followUp) {
      setPending({ id: r.item.id, followUp: r.followUp, original: body.text });
      setAnswer('');
    } else {
      setPending(null);
      setText('');
      filedToast(r);
      onFiled?.(r);
    }
    return r;
  }, { errorPrefix: 'Quick log' });

  const toggleMic = () => {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const Ctor = speechCtor();
    if (!Ctor) {
      pushToast('info', 'Voice input is not available in this browser — type your note instead.');
      return;
    }
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (ev) => {
      let t = '';
      for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0]?.transcript ?? '';
      setText(t);
      setVia('voice');
    };
    rec.onend = () => setListening(false);
    rec.onerror = (ev) => {
      setListening(false);
      pushToast('error', `Voice input failed${ev.error ? ` (${ev.error})` : ''} — type your note instead.`);
    };
    recRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { setListening(false); }
  };

  const send = () => {
    const t = text.trim();
    if (!t) return;
    submit.run({ text: t, via });
  };
  const reply = (value: string) => {
    if (!pending) return;
    submit.run({ text: pending.original, via, pendingId: pending.id, answer: value });
  };

  return (
    <div className="quicklog">
      <div className="quicklog__row">
        <textarea
          className="quicklog__input"
          rows={compact ? 1 : 2}
          placeholder={placeholder ?? 'Log anything: "smoked a cigarette", "BP 128/82", "ran 5k, heart rate 150", "slept 7 hours"…'}
          value={text}
          onChange={(e) => { setText(e.target.value); setVia('text'); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          aria-label="Quick log"
        />
        <button type="button" className={`quicklog__mic${listening ? ' quicklog__mic--on' : ''}`} onClick={toggleMic} title={hasSpeech ? (listening ? 'Stop listening' : 'Speak') : 'Voice input not available in this browser'} aria-label="Voice input" aria-pressed={listening}>
          {hasSpeech ? <Mic /> : <MicOff />}
        </button>
        <button type="button" className="btn btn--primary" onClick={send} disabled={submit.busy || !text.trim()} aria-label="Log"><Send /> {compact ? '' : 'Log'}</button>
      </div>
      {!pending && (
        <div className="quicklog__preview">
          {listening ? <span className="muted">Listening…</span> : preview ? (
            <>
              <Sparkles style={{ width: 11, height: 11, color: 'var(--accent)' }} />
              <span>Will be filed under</span>
              <ConceptPath path={preview.concept.path} />
              <span className="quicklog__hint">(preview — the classifier decides on submit)</span>
            </>
          ) : text.trim().length >= 3 ? (
            <><Inbox style={{ width: 11, height: 11 }} /> <span>No obvious branch yet — it will go to your inbox for review if the classifier is unsure.</span></>
          ) : (
            <span className="quicklog__hint">Text or voice. New brands, drinks or activities become sub-branches automatically.</span>
          )}
        </div>
      )}
      <DemoOnlyHint />
      {pending && (
        <div className="quicklog__followup" role="group" aria-label="Follow-up question">
          <div className="quicklog__followup-q">{pending.followUp.question}</div>
          {pending.followUp.options && pending.followUp.options.length > 0 && (
            <div className="quicklog__chips">
              {pending.followUp.options.map((o) => <button key={o} type="button" className="chip" disabled={submit.busy} onClick={() => reply(o)}>{o}</button>)}
            </div>
          )}
          <form className="row gap-6" onSubmit={(e) => { e.preventDefault(); if (answer.trim()) reply(answer.trim()); }}>
            <input className="input input--sm flex-1" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={pending.followUp.options?.length ? 'or type another…' : 'Your answer'} aria-label={pending.followUp.question} autoFocus />
            <button className="btn btn--sm btn--primary" type="submit" disabled={submit.busy || !answer.trim()}>Answer</button>
            <button className="btn btn--sm btn--ghost" type="button" onClick={() => setPending(null)}>Skip</button>
          </form>
          <div className="quicklog__hint">{pending.followUp.createsSubBranch ? `A new ${pending.followUp.attribute} creates its own sub-branch.` : `Stored as the ${pending.followUp.attribute} attribute.`}</div>
        </div>
      )}
    </div>
  );
}
