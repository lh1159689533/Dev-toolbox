import { useEffect, useRef, useState } from 'react';
import { getToolById } from '../../data/tools';
import PageHeader from '../../components/PageHeader';
import Button from '../../components/Button';
import './index.css';

type Unit = 's' | 'ms';

const UNIT_LABEL: Record<Unit, string> = { s: '秒 (s)', ms: '毫秒 (ms)' };

const TZ_OPTIONS: { value: string; label: string }[] = [
  { value: 'UTC', label: 'UTC' },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai' },
  { value: 'Asia/Hong_Kong', label: 'Asia/Hong_Kong' },
  { value: 'Asia/Taipei', label: 'Asia/Taipei' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
  { value: 'Asia/Seoul', label: 'Asia/Seoul' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai' },
  { value: 'Europe/London', label: 'Europe/London' },
  { value: 'Europe/Paris', label: 'Europe/Paris' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin' },
  { value: 'Europe/Moscow', label: 'Europe/Moscow' },
  { value: 'America/New_York', label: 'America/New_York' },
  { value: 'America/Chicago', label: 'America/Chicago' },
  { value: 'America/Denver', label: 'America/Denver' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney' },
  { value: 'Pacific/Auckland', label: 'Pacific/Auckland' },
];

/* ===== 纯工具函数 ===== */

/** 根据整数位长度自动判断单位：10 位=秒，13 位=毫秒，其余回退到 fallback */
function detectUnit(raw: string, fallback: Unit): Unit {
  const intPart = raw.trim().replace(/^-/, '').split('.')[0];
  if (intPart.length === 10) return 's';
  if (intPart.length === 13) return 'ms';
  return fallback;
}

/** 时间戳字符串 → epoch 毫秒（自动识别单位，无法解析返回 null） */
function tsToEpoch(raw: string, unit: Unit): number | null {
  const s = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const u = detectUnit(s, unit);
  const ms = u === 's' ? Math.round(n * 1000) : Math.round(n);
  if (!Number.isSafeInteger(ms) || Math.abs(ms) > 8.64e15) return null;
  return ms;
}

/** 将 epoch 毫秒格式化为指定时区的 YYYY-MM-DD HH:mm:ss[.mmm]（withMillis 控制是否显示毫秒） */
function formatInTz(ms: number, tz: string, withMillis = false): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  const hour = p.hour === '24' ? '00' : p.hour;
  const base = `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}:${p.second}`;
  if (!withMillis) return base;
  const millis = String(new Date(ms).getMilliseconds()).padStart(3, '0');
  return `${base}.${millis}`;
}

/** 计算指定时刻在指定时区的偏移量（毫秒，东区为正） */
function getTzOffsetMs(date: Date, tz: string): number {
  // 偏移量只与秒级墙钟相关，先去掉毫秒，避免毫秒污染偏移计算
  const secDate = new Date(Math.floor(date.getTime() / 1000) * 1000);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(secDate)) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUTC - secDate.getTime();
}

/** 将"指定时区的墙钟时间"解析为 epoch 毫秒（无法解析返回 null） */
function parseDateInTz(raw: string, tz: string): number | null {
  const s = raw.trim();
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:[.,](\d{1,3}))?)?)?/);
  if (!m) return null;
  const year = +m[1];
  const month = +m[2];
  const day = +m[3];
  const hour = m[4] ? +m[4] : 0;
  const minute = m[5] ? +m[5] : 0;
  const second = m[6] ? +m[6] : 0;
  const millis = m[7] ? +m[7].padEnd(3, '0') : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  // 校验该月该日确实存在（如 2 月 30 日）
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;

  const wallUtc = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  // 两次迭代，处理 DST 边界附近偏移量的差异
  let offset = getTzOffsetMs(new Date(wallUtc), tz);
  offset = getTzOffsetMs(new Date(wallUtc - offset), tz);
  return wallUtc - offset;
}

/** epoch 毫秒 → 展示字符串（按单位） */
function formatEpoch(ms: number, unit: Unit): string {
  return unit === 's' ? String(Math.floor(ms / 1000)) : String(ms);
}

/** 单行结果 */
interface Row {
  raw: string;
  ok: boolean;
  value: string;
}

/** 复制按钮（自带"已复制"反馈） */
function CopyButton({ text, size }: { text: string; size?: 'small' | 'default' }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>();
  const onClick = () => {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1500);
      },
      () => {
        /* 忽略复制失败（如非 https 环境） */
      },
    );
  };
  return (
    <Button size={size} onClick={onClick} disabled={!text}>
      {copied ? '已复制' : '复制'}
    </Button>
  );
}

function TimestampIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke-width="1.5"
      stroke="currentColor"
      aria-hidden="true"
      data-slot="icon"
      style={{ width: '1.25rem', color: 'oklch(50% 0.07 160)' }}
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"></path>
    </svg>
  );
}

function DateIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke-width="1.5"
      stroke="currentColor"
      aria-hidden="true"
      data-slot="icon"
      style={{ width: '1.25rem', color: 'oklch(50% 0.07 160)' }}
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
      ></path>
    </svg>
  );
}

export default function TimestampConverter() {
  const tool = getToolById('timestamp');

  /* 顶部当前时间戳 */
  const [now, setNow] = useState(() => Date.now());
  const [nowUnit, setNowUnit] = useState<Unit>('ms');
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [paused]);

  const nowValue = nowUnit === 's' ? String(Math.floor(now / 1000)) : String(now);

  /* Tab */
  const [tab, setTab] = useState<'single' | 'batch'>('single');

  /* 单个转换：时间戳 → 日期时间 */
  const [tsInput, setTsInput] = useState('');
  const [tsUnit, setTsUnit] = useState<Unit>('s');
  const [tsTz, setTsTz] = useState('Asia/Shanghai');
  const [tsResult, setTsResult] = useState<{ ok: boolean; value: string } | null>(null);

  /* 单个转换：日期时间 → 时间戳 */
  const [dateInput, setDateInput] = useState('');
  const [dateTz, setDateTz] = useState('Asia/Shanghai');
  const [dateEpoch, setDateEpoch] = useState<number | null>(null);
  const [dateErr, setDateErr] = useState<string | null>(null);
  const [dateUnit, setDateUnit] = useState<Unit>('s');

  /* 批量：时间戳 → 日期时间 */
  const [bTsInput, setBTsInput] = useState('');
  const [bTsUnit, setBTsUnit] = useState<Unit>('s');
  const [bTsTz, setBTsTz] = useState('Asia/Shanghai');
  const [bTsRows, setBTsRows] = useState<Row[]>([]);

  /* 批量：日期时间 → 时间戳 */
  const [bDateInput, setBDateInput] = useState('');
  const [bDateTz, setBDateTz] = useState('Asia/Shanghai');
  const [bDateUnit, setBDateUnit] = useState<Unit>('s');
  const [bDateRows, setBDateRows] = useState<Row[]>([]);

  /** 点击当前时间戳：按当前 Tab 填充到对应输入框，并同步单位 */
  const handleNowClick = () => {
    const value = nowUnit === 's' ? String(Math.floor(now / 1000)) : String(now);
    if (tab === 'batch') {
      setBTsUnit(nowUnit);
      setBTsInput((prev) => {
        const trimmed = prev.replace(/\s+$/, '');
        return trimmed ? `${trimmed}\n${value}` : value;
      });
    } else {
      setTsUnit(nowUnit);
      setTsInput(value);
    }
  };

  const convertTsToDate = () => {
    const ms = tsToEpoch(tsInput, tsUnit);
    setTsResult(ms === null ? { ok: false, value: '无效时间戳' } : { ok: true, value: formatInTz(ms, tsTz, tsUnit === 'ms') });
  };

  const convertDateToTs = () => {
    const epoch = parseDateInTz(dateInput, dateTz);
    if (epoch === null) {
      setDateEpoch(null);
      setDateErr('无法解析该日期时间');
    } else {
      setDateEpoch(epoch);
      setDateErr(null);
    }
  };

  const convertBatchTs = () => {
    const lines = bTsInput
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    setBTsRows(
      lines.map((raw) => {
        const ms = tsToEpoch(raw, bTsUnit);
        return ms === null ? { raw, ok: false, value: '无效时间戳' } : { raw, ok: true, value: formatInTz(ms, bTsTz, bTsUnit === 'ms') };
      }),
    );
  };

  const convertBatchDate = () => {
    const lines = bDateInput
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    setBDateRows(
      lines.map((raw) => {
        const epoch = parseDateInTz(raw, bDateTz);
        return epoch === null
          ? { raw, ok: false, value: '无效日期时间' }
          : { raw, ok: true, value: formatEpoch(epoch, bDateUnit) };
      }),
    );
  };

  const batchTsCopyText = bTsRows
    .filter((r) => r.ok)
    .map((r) => r.value)
    .join('\n');
  const batchDateCopyText = bDateRows
    .filter((r) => r.ok)
    .map((r) => r.value)
    .join('\n');

  return (
    <div className="ts-app">
      <PageHeader title={tool?.name ?? '时间戳转换'} subtitle={tool?.description ?? ''} />

      <div className="ts-body">
        {/* 当前时间戳 */}
        <section className="ts-now">
          <div className="ts-now-left">
            <span className="ts-now-label">当前时间戳</span>
            <button type="button" className="ts-now-value" title="点击填充到时间戳转日期" onClick={handleNowClick}>
              {nowValue}
            </button>
            <span className="ts-now-badge">{nowUnit === 'ms' ? '毫秒' : '秒'}</span>
          </div>
          <div className="ts-now-actions">
            <Button onClick={() => setNowUnit((u) => (u === 'ms' ? 's' : 'ms'))}>切换单位</Button>
            <CopyButton text={nowValue} size="default" />
            <Button className="ts-btn-danger" onClick={() => setPaused((p) => !p)}>
              {paused ? '继续' : '暂停'}
            </Button>
          </div>
        </section>

        {/* Tab 切换 */}
        <div className="ts-tabs" role="tablist">
          <button
            type="button"
            className={`ts-tab${tab === 'single' ? ' active' : ''}`}
            onClick={() => setTab('single')}
          >
            单个转换
          </button>
          <button type="button" className={`ts-tab${tab === 'batch' ? ' active' : ''}`} onClick={() => setTab('batch')}>
            批量转换
          </button>
        </div>

        {tab === 'single' ? (
          <>
            {/* 时间戳 → 日期时间 */}
            <section className="ts-card">
              <h2 className="ts-card-title">
                <TimestampIcon /> 时间戳转日期时间
              </h2>
              <div className="ts-row">
                <label className="ts-field ts-field-grow">
                  <span>时间戳</span>
                  <input
                    className="ts-input"
                    placeholder="例如 1700000000"
                    value={tsInput}
                    onChange={(e) => setTsInput(e.target.value)}
                  />
                </label>
                <label className="ts-field">
                  <span>单位</span>
                  <select className="ts-input" value={tsUnit} onChange={(e) => setTsUnit(e.target.value as Unit)}>
                    <option value="s">{UNIT_LABEL.s}</option>
                    <option value="ms">{UNIT_LABEL.ms}</option>
                  </select>
                </label>
                <label className="ts-field">
                  <span>时区</span>
                  <select className="ts-input" value={tsTz} onChange={(e) => setTsTz(e.target.value)}>
                    {TZ_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="ts-field ts-field-actions">
                  <Button onClick={handleNowClick}>填入当前</Button>
                  <Button variant="primary" onClick={convertTsToDate}>
                    转换
                  </Button>
                </div>
              </div>

              <div className="ts-row ts-result-row">
                <label className="ts-field ts-field-grow">
                  <span>转换结果</span>
                  <input
                    className={`ts-input${tsResult && !tsResult.ok ? ' ts-input-error' : ''}`}
                    readOnly
                    placeholder="点击「转换」生成结果"
                    value={tsResult ? tsResult.value : ''}
                  />
                </label>
                <div className="ts-field ts-field-actions">
                  <CopyButton text={tsResult?.ok ? tsResult.value : ''} />
                </div>
              </div>
            </section>

            {/* 日期时间 → 时间戳 */}
            <section className="ts-card">
              <h2 className="ts-card-title">
                <DateIcon /> 日期时间转时间戳
              </h2>
              <div className="ts-row">
                <label className="ts-field ts-field-grow">
                  <span>日期时间</span>
                  <input
                    className="ts-input"
                    placeholder="例如 2026-10-12 11:07:43"
                    value={dateInput}
                    onChange={(e) => setDateInput(e.target.value)}
                  />
                </label>
                <label className="ts-field">
                  <span>时区</span>
                  <select className="ts-input" value={dateTz} onChange={(e) => setDateTz(e.target.value)}>
                    {TZ_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="ts-field ts-field-actions">
                  <Button variant="primary" onClick={convertDateToTs}>
                    转换
                  </Button>
                </div>
              </div>

              <div className="ts-row ts-result-row">
                <label className="ts-field ts-field-grow">
                  <span>转换结果</span>
                  <input
                    className={`ts-input${dateErr ? ' ts-input-error' : ''}`}
                    readOnly
                    placeholder="点击「转换」生成结果"
                    value={dateErr ?? (dateEpoch !== null ? formatEpoch(dateEpoch, dateUnit) : '')}
                  />
                </label>
                <label className="ts-field">
                  <span>单位</span>
                  <select className="ts-input" value={dateUnit} onChange={(e) => setDateUnit(e.target.value as Unit)}>
                    <option value="s">{UNIT_LABEL.s}</option>
                    <option value="ms">{UNIT_LABEL.ms}</option>
                  </select>
                </label>
                <div className="ts-field ts-field-actions">
                  <CopyButton text={dateEpoch !== null ? formatEpoch(dateEpoch, dateUnit) : ''} />
                </div>
              </div>
            </section>
          </>
        ) : (
          <>
            {/* 批量时间戳 → 日期时间 */}
            <section className="ts-card">
              <h2 className="ts-card-title">
                <TimestampIcon /> 批量时间戳转日期时间
              </h2>
              <div className="ts-row">
                <label className="ts-field ts-field-grow">
                  <span>时间戳列表（每行一个）</span>
                  <textarea
                    className="ts-textarea"
                    placeholder={'1700000000\n1710000000000\n1720000000'}
                    value={bTsInput}
                    onChange={(e) => setBTsInput(e.target.value)}
                    spellCheck={false}
                  />
                </label>
              </div>
              <div className="ts-row">
                <label className="ts-field">
                  <span>时区</span>
                  <select className="ts-input" value={bTsTz} onChange={(e) => setBTsTz(e.target.value)}>
                    {TZ_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ts-field">
                  <span>单位</span>
                  <select className="ts-input" value={bTsUnit} onChange={(e) => setBTsUnit(e.target.value as Unit)}>
                    <option value="s">{UNIT_LABEL.s}</option>
                    <option value="ms">{UNIT_LABEL.ms}</option>
                  </select>
                </label>
                <div className="ts-field ts-field-actions">
                  <Button variant="primary" onClick={convertBatchTs}>
                    转换
                  </Button>
                </div>
              </div>

              {bTsRows.length > 0 && (
                <div className="ts-batch-result">
                  <div className="ts-batch-result-header">
                    <span>转换结果（{bTsRows.length} 行）</span>
                    <CopyButton text={batchTsCopyText} />
                  </div>
                  <ul className="ts-batch-list">
                    {bTsRows.map((r, i) => (
                      <li key={i} className="ts-batch-row">
                        <span className="ts-batch-raw">{r.raw}</span>
                        <span className="ts-batch-arrow">→</span>
                        <span className={r.ok ? 'ts-batch-val' : 'ts-batch-val ts-batch-invalid'}>{r.value}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* 批量日期时间 → 时间戳 */}
            <section className="ts-card">
              <h2 className="ts-card-title">
                <DateIcon />
                批量日期时间转时间戳
              </h2>
              <div className="ts-row">
                <label className="ts-field ts-field-grow">
                  <span>日期时间列表（每行一个）</span>
                  <textarea
                    className="ts-textarea"
                    placeholder={'2026-10-12 11:07:43\n2026-10-13 08:00:00'}
                    value={bDateInput}
                    onChange={(e) => setBDateInput(e.target.value)}
                    spellCheck={false}
                  />
                </label>
              </div>
              <div className="ts-row">
                <label className="ts-field">
                  <span>时区</span>
                  <select className="ts-input" value={bDateTz} onChange={(e) => setBDateTz(e.target.value)}>
                    {TZ_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ts-field">
                  <span>单位</span>
                  <select className="ts-input" value={bDateUnit} onChange={(e) => setBDateUnit(e.target.value as Unit)}>
                    <option value="s">{UNIT_LABEL.s}</option>
                    <option value="ms">{UNIT_LABEL.ms}</option>
                  </select>
                </label>
                <div className="ts-field ts-field-actions">
                  <Button variant="primary" onClick={convertBatchDate}>
                    转换
                  </Button>
                </div>
              </div>

              {bDateRows.length > 0 && (
                <div className="ts-batch-result">
                  <div className="ts-batch-result-header">
                    <span>转换结果（{bDateRows.length} 行）</span>
                    <CopyButton text={batchDateCopyText} />
                  </div>
                  <ul className="ts-batch-list">
                    {bDateRows.map((r, i) => (
                      <li key={i} className="ts-batch-row">
                        <span className="ts-batch-raw">{r.raw}</span>
                        <span className="ts-batch-arrow">→</span>
                        <span className={r.ok ? 'ts-batch-val' : 'ts-batch-val ts-batch-invalid'}>{r.value}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
