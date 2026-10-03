import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import DebugProvider from './shared/DebugProvider';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <DebugProvider>
      <App />
    </DebugProvider>
  </React.StrictMode>
);
