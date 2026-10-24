// PLACEHOLDER shell — replaced by the frontend implementation.
import { Routes, Route, Navigate } from 'react-router-dom';
import { useApi, usePersona } from './hooks';
import type { DemoState } from '@shared/api-types';

export default function App() {
  const [persona, setPersona] = usePersona();
  const state = useApi<DemoState>('/demo/state');
  return (
    <div style={{ padding: 24 }}>
      <h1>Health Data Asset — working model</h1>
      <p>
        Persona: <strong>{persona}</strong>{' '}
        <button onClick={() => setPersona(persona === 'participant' ? 'buyer:1' : 'participant')}>switch</button>
      </p>
      <pre>{state.data ? JSON.stringify(state.data, null, 2) : state.error ? String(state.error) : 'loading…'}</pre>
      <Routes>
        <Route path="/" element={<Navigate to={persona === 'participant' ? '/p' : '/b'} replace />} />
        <Route path="/p/*" element={<p>participant app placeholder</p>} />
        <Route path="/b/*" element={<p>buyer app placeholder</p>} />
      </Routes>
    </div>
  );
}
