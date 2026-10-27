
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SidePanel } from './SidePanel';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Không tìm thấy #root');

createRoot(container).render(
  <StrictMode>
    <SidePanel />
  </StrictMode>,
);
