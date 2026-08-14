import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

if (!window.activityJournal) {
  root.render(
    <main style={{ padding: 32, fontFamily: 'Segoe UI, sans-serif', color: '#182233' }}>
      <h1>Activity Journal không thể khởi tạo</h1>
      <p>Preload API không được nạp. Hãy đóng ứng dụng hoàn toàn từ system tray và mở lại bản mới nhất.</p>
    </main>,
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
