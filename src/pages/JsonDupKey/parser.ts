/**
 * 仅解析 JSON 最外层对象的字段，识别同一 key 字面出现多次的情况。
 *
 * 为什么不用 JSON.parse：标准 JSON.parse 会静默丢弃重复 key（只保留最后一个），
 * 无法拿到重复 key 的信息。因此这里用轻量递归下降解析器，保留每个字段在原文中的位置 span，
 * 以便在删除某条重复项时精确操作原始文本、保留其余部分的原始格式。
 */

/** 一个顶层字段在原文中的位置信息 */
export interface FieldSpan {
  /** 解码后的 key（用于比较是否重复） */
  key: string;
  /** 原始 key 文本（含引号），用于展示 */
  rawKey: string;
  /** 顶层字段序号（从 0 开始，按出现顺序） */
  index: number;
  /** 字段起始位置（key 的开引号） */
  fullStart: number;
  /** 字段结束位置（value 结束，不含逗号） */
  fullEnd: number;
  /** value 起始位置 */
  valueStart: number;
  /** value 结束位置 */
  valueEnd: number;
}

/** 一个重复 key 的分组（出现次数 >= 2） */
export interface DupGroup {
  key: string;
  rawKey: string;
  fields: FieldSpan[];
}

export type ParseResult =
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'not-object' }
  | { status: 'ok'; fields: FieldSpan[]; groups: DupGroup[] };

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/** value 字面量（数字 / true / false / null）的结束分隔符 */
function isDelimiter(ch: string): boolean {
  return ch === ',' || ch === '}' || ch === ']' || isWhitespace(ch);
}

class Parser {
  private text: string;
  private pos = 0;

  constructor(text: string) {
    this.text = text;
  }

  private get len(): number {
    return this.text.length;
  }

  private skipWhitespace(): void {
    while (this.pos < this.len && isWhitespace(this.text[this.pos])) {
      this.pos++;
    }
  }

  /** 解析字符串（当前 pos 指向开引号），返回解码后的值和结束位置 */
  private parseString(): { value: string; end: number } | null {
    let i = this.pos + 1;
    let value = '';
    while (i < this.len) {
      const ch = this.text[i];
      if (ch === '"') {
        return { value, end: i + 1 };
      }
      if (ch === '\\') {
        const next = this.text[i + 1];
        if (next === 'u') {
          const code = parseInt(this.text.slice(i + 2, i + 6), 16);
          value += Number.isNaN(code) ? 'u' : String.fromCharCode(code);
          i += 6;
          continue;
        }
        const map: Record<string, string> = {
          '"': '"',
          '\\': '\\',
          '/': '/',
          b: '\b',
          f: '\f',
          n: '\n',
          r: '\r',
          t: '\t',
        };
        value += map[next] ?? next;
        i += 2;
        continue;
      }
      value += ch;
      i++;
    }
    return null;
  }

  /** 解析对象 value（用于嵌套场景），返回对象结束后的位置 */
  private parseObject(): number | null {
    this.pos++; // 跳过 {
    this.skipWhitespace();
    if (this.pos < this.len && this.text[this.pos] === '}') {
      this.pos++;
      return this.pos;
    }
    while (true) {
      this.skipWhitespace();
      if (this.pos >= this.len || this.text[this.pos] !== '"') return null;
      const key = this.parseString();
      if (!key) return null;
      this.pos = key.end;
      this.skipWhitespace();
      if (this.pos >= this.len || this.text[this.pos] !== ':') return null;
      this.pos++;
      this.skipWhitespace();
      const valueEnd = this.parseValue();
      if (valueEnd === null) return null;
      this.pos = valueEnd;
      this.skipWhitespace();
      if (this.pos >= this.len) return null;
      const ch = this.text[this.pos];
      if (ch === ',') {
        this.pos++;
        continue;
      }
      if (ch === '}') {
        this.pos++;
        return this.pos;
      }
      return null;
    }
  }

  /** 解析数组 value，返回数组结束后的位置 */
  private parseArray(): number | null {
    this.pos++; // 跳过 [
    this.skipWhitespace();
    if (this.pos < this.len && this.text[this.pos] === ']') {
      this.pos++;
      return this.pos;
    }
    while (true) {
      this.skipWhitespace();
      const valueEnd = this.parseValue();
      if (valueEnd === null) return null;
      this.pos = valueEnd;
      this.skipWhitespace();
      if (this.pos >= this.len) return null;
      const ch = this.text[this.pos];
      if (ch === ',') {
        this.pos++;
        continue;
      }
      if (ch === ']') {
        this.pos++;
        return this.pos;
      }
      return null;
    }
  }

  /** 解析任意 value，返回 value 结束后的位置 */
  private parseValue(): number | null {
    if (this.pos >= this.len) return null;
    const ch = this.text[this.pos];
    if (ch === '"') {
      const s = this.parseString();
      return s ? s.end : null;
    }
    if (ch === '{') return this.parseObject();
    if (ch === '[') return this.parseArray();
    // 字面量：true / false / null / number
    let i = this.pos;
    while (i < this.len && !isDelimiter(this.text[i])) i++;
    if (i === this.pos) return null;
    return i;
  }

  /** 解析顶层对象，收集所有字段并识别重复 key */
  parseTopLevel(): ParseResult {
    this.skipWhitespace();
    if (this.pos >= this.len) return { status: 'empty' };
    if (this.text[this.pos] !== '{') return { status: 'not-object' };

    this.pos++; // 跳过 {
    this.skipWhitespace();
    if (this.pos < this.len && this.text[this.pos] === '}') {
      return { status: 'ok', fields: [], groups: [] };
    }

    const fields: FieldSpan[] = [];
    while (true) {
      this.skipWhitespace();
      if (this.pos >= this.len) {
        return { status: 'error', message: '对象未闭合，缺少 "}"' };
      }
      if (this.text[this.pos] === '}') {
        this.pos++;
        break;
      }
      if (this.text[this.pos] !== '"') {
        return { status: 'error', message: `字段名必须是字符串（位置 ${this.pos}）` };
      }

      const keyStart = this.pos;
      const keyResult = this.parseString();
      if (!keyResult) {
        return { status: 'error', message: '字符串未闭合' };
      }
      const keyEnd = keyResult.end;
      this.pos = keyEnd;
      this.skipWhitespace();

      if (this.pos >= this.len || this.text[this.pos] !== ':') {
        return { status: 'error', message: `字段 "${keyResult.value}" 后缺少冒号` };
      }
      this.pos++;
      this.skipWhitespace();

      if (this.pos >= this.len) {
        return { status: 'error', message: `字段 "${keyResult.value}" 的值缺失` };
      }
      const valueStart = this.pos;
      const valueEnd = this.parseValue();
      if (valueEnd === null) {
        return { status: 'error', message: `字段 "${keyResult.value}" 的值非法` };
      }
      this.pos = valueEnd;

      fields.push({
        key: keyResult.value,
        rawKey: this.text.slice(keyStart, keyEnd),
        index: fields.length,
        fullStart: keyStart,
        fullEnd: valueEnd,
        valueStart,
        valueEnd,
      });

      this.skipWhitespace();
      if (this.pos >= this.len) {
        return { status: 'error', message: '对象未闭合，缺少 "}"' };
      }
      const ch = this.text[this.pos];
      if (ch === ',') {
        this.pos++;
        continue;
      }
      if (ch === '}') {
        this.pos++;
        break;
      }
      return { status: 'error', message: `字段 "${keyResult.value}" 后存在多余字符` };
    }

    // 按 key 分组，识别出现 >= 2 次的 key
    const seen = new Map<string, FieldSpan[]>();
    for (const f of fields) {
      const arr = seen.get(f.key) ?? [];
      arr.push(f);
      seen.set(f.key, arr);
    }
    const groups: DupGroup[] = [];
    for (const [key, arr] of seen) {
      if (arr.length >= 2) {
        groups.push({ key, rawKey: arr[0].rawKey, fields: arr });
      }
    }

    return { status: 'ok', fields, groups };
  }
}

/** 解析 JSON 文本，识别最外层对象的重复 key */
export function parseJsonDupKey(text: string): ParseResult {
  return new Parser(text).parseTopLevel();
}

/**
 * 从原文中删除指定字段（连同相邻逗号），返回新文本。
 * 保留其余部分的原始格式（缩进、换行等）。
 */
export function removeFieldFromText(text: string, field: FieldSpan): string {
  let start = field.fullStart;
  let end = field.fullEnd;

  // 字段后若紧跟逗号（非最后一个字段），连同其后的逗号一起删除
  let j = field.fullEnd;
  while (j < text.length && isWhitespace(text[j])) j++;
  if (j < text.length && text[j] === ',') {
    end = j + 1;
  } else {
    // 最后一个字段：删除其前面的逗号
    let k = field.fullStart - 1;
    while (k >= 0 && isWhitespace(text[k])) k--;
    if (k >= 0 && text[k] === ',') {
      start = k;
    }
  }

  // 若字段独占一行（前面是换行 + 缩进空白），连同行首缩进一并删除，避免残留空白
  start = trimLinePrefix(text, start);

  return text.slice(0, start) + text.slice(end);
}

/**
 * 若 pos 之前是一段“换行 + 缩进空白”，返回该换行符的位置（删除时连同换行符一并删掉，
 * 避免字段独占一行时残留空行）；否则原样返回 pos。
 */
function trimLinePrefix(text: string, pos: number): number {
  let i = pos - 1;
  while (i >= 0 && isWhitespace(text[i]) && text[i] !== '\n') {
    i--;
  }
  if (i >= 0 && text[i] === '\n') {
    return i;
  }
  return pos;
}
