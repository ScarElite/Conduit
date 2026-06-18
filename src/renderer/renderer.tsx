import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Note: no <StrictMode> on purpose — its dev-only double-mount would spawn the
// pty twice and the second terminal would miss the initial prompt bytes.
const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
