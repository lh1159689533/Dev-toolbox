import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route } from 'react-router-dom';
import HomePage from './routes/HomePage';
import TapdCommentTool from './pages/TapdCommentTool';
import JsonFormatter from './pages/JsonFormatter';
import TimestampConverter from './pages/TimestampConverter';
import TextDiffTool from './pages/TextDiffTool';
import JsonDupKey from './pages/JsonDupKey';
import RpaRecorder from './pages/RpaRecorder';
import SiteCollection from './pages/SiteCollection';
import ScrollRevealDemo from './pages/ScrollRevealDemo';
import SettingsDrawer from './components/SettingsDrawer';
import './index.css';
import './styles/scrollbar.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <SettingsDrawer />
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/tools/tapd-comment" element={<TapdCommentTool />} />
      <Route path="/tools/json-formatter" element={<JsonFormatter />} />
      <Route path="/tools/timestamp" element={<TimestampConverter />} />
      <Route path="/tools/text-diff" element={<TextDiffTool />} />
      <Route path="/tools/json-dup-key" element={<JsonDupKey />} />
      <Route path="/tools/rpa-recorder" element={<RpaRecorder />} />
      <Route path="/tools/sites" element={<SiteCollection />} />
      <Route path="/demo/scroll-reveal" element={<ScrollRevealDemo />} />
    </Routes>
  </HashRouter>,
);
