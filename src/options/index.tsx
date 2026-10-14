import ReactDOM from 'react-dom/client';
import SettingsForm from '../components/SettingsForm';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <div className="options-page">
    <header className="options-header">
      <h1>开发工具集 · 设置</h1>
    </header>
    <SettingsForm />
  </div>,
);
