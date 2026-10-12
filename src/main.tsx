import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomePage from './routes/HomePage';
import TapdCommentTool from './pages/TapdCommentTool';
import JsonFormatter from './pages/JsonFormatter';
import TimestampConverter from './pages/TimestampConverter';
import TextDiffTool from './pages/TextDiffTool';
import JsonDupKey from './pages/JsonDupKey';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/tools/tapd-comment" element={<TapdCommentTool />} />
      <Route path="/tools/json-formatter" element={<JsonFormatter />} />
      <Route path="/tools/timestamp" element={<TimestampConverter />} />
      <Route path="/tools/text-diff" element={<TextDiffTool />} />
      <Route path="/tools/json-dup-key" element={<JsonDupKey />} />
    </Routes>
  </BrowserRouter>,
);
