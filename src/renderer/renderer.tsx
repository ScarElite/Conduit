import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Note: no <StrictMode> on purpose — its dev-only double-mount would spawn the
// pty twice and the second terminal would miss the initial prompt bytes.
// A fresh renderer (initial load or reload) reaps any shells main still holds for
// this window before the new tabs spawn theirs — otherwise a reload would orphan
// the previous session's shells (one per tab) until the window finally closes.
window.term.resetPtys();

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
