import type { JsonValue } from './JsonTree';

/* ===== JSON → TypeScript interface 转换 =====
 * 规则：
 *  - interface 风格，根对象命名为 Root
 *  - 嵌套对象按字段名驼峰化（user_list → UserList）
 *  - 数组元素用单数形式命名（users → User）
 *  - 数组「智能合并」：对象元素合并字段并集为一个 interface（缺失字段标可选）；
 *    混杂原始类型则用联合类型
 *  - null 保留为 null；{} → any；[] → any[]
 */

interface TsField {
  key: string;
  type: string;
  optional: boolean;
}

interface TsInterface {
  name: string;
  fields: TsField[];
}

interface Ctx {
  interfaces: TsInterface[];
  usedNames: Map<string, number>;
}

type ObjectNode = { kind: 'object'; fields: FieldNode[] };
type FieldNode = { key: string; value: Node; optional: boolean };
type Node =
  | { kind: 'primitive'; ts: string }
  | { kind: 'array'; item: Node }
  | ObjectNode
  | { kind: 'union'; variants: Node[] };

/* ===== 归一化：把 JsonValue 转为便于合并/生成的结构 ===== */

function normalize(value: JsonValue): Node {
  if (value === null) return { kind: 'primitive', ts: 'null' };
  const t = typeof value;
  if (t === 'boolean') return { kind: 'primitive', ts: 'boolean' };
  if (t === 'number') return { kind: 'primitive', ts: 'number' };
  if (t === 'string') return { kind: 'primitive', ts: 'string' };

  if (Array.isArray(value)) {
    // 空数组 → any[]
    if (value.length === 0) return { kind: 'array', item: { kind: 'primitive', ts: 'any' } };
    return { kind: 'array', item: mergeItems(value.map(normalize)) };
  }

  // 空对象 → any
  if (Object.keys(value).length === 0) return { kind: 'primitive', ts: 'any' };

  const fields: FieldNode[] = Object.entries(value).map(([key, v]) => ({
    key,
    value: normalize(v),
    optional: false,
  }));
  return { kind: 'object', fields };
}

/** 合并数组元素：全为对象则合并字段为一个对象，否则用联合类型 */
function mergeItems(items: Node[]): Node {
  const objects = items.filter((n): n is ObjectNode => n.kind === 'object');
  if (objects.length === items.length) return mergeObjects(objects);
  return { kind: 'union', variants: items };
}

/** 合并多个对象的字段（取并集），缺失字段标记为可选 */
function mergeObjects(objects: ObjectNode[]): ObjectNode {
  const byKey = new Map<string, Node[]>();
  for (const obj of objects) {
    const seen = new Set<string>();
    for (const f of obj.fields) {
      seen.add(f.key);
      const list = byKey.get(f.key) ?? [];
      list.push(f.value);
      byKey.set(f.key, list);
    }
  }

  const fields: FieldNode[] = [];
  for (const [key, values] of byKey) {
    const optional = values.length < objects.length;
    const value: Node = values.length === 1 ? values[0] : { kind: 'union', variants: values };
    fields.push({ key, value, optional });
  }
  return { kind: 'object', fields };
}

/* ===== 生成 ===== */

function describeValue(node: Node, name: string, ctx: Ctx): string {
  switch (node.kind) {
    case 'primitive':
      return node.ts;
    case 'array':
      return `${describeValue(node.item, singularize(name), ctx)}[]`;
    case 'object':
      return describeObject(node, name, ctx);
    case 'union': {
      const set = new Set<string>();
      for (const v of node.variants) set.add(describeValue(v, name, ctx));
      const parts = [...set];
      return parts.length === 1 ? parts[0] : `(${parts.join(' | ')})`;
    }
  }
}

function describeObject(node: ObjectNode, name: string, ctx: Ctx): string {
  const finalName = allocateName(ctx, name);
  const fields: TsField[] = node.fields.map((f) => ({
    key: f.key,
    type: describeValue(f.value, pascal(f.key), ctx),
    optional: f.optional,
  }));
  ctx.interfaces.push({ name: finalName, fields });
  return finalName;
}

/** 分配唯一名称，重名追加数字后缀 */
function allocateName(ctx: Ctx, base: string): string {
  const count = ctx.usedNames.get(base) ?? 0;
  ctx.usedNames.set(base, count + 1);
  return count === 0 ? base : `${base}${count + 1}`;
}

/* ===== 命名工具 ===== */

/** 按非字母数字切分，每段首字母大写（全大写段保持），如 user_list → UserList */
function pascal(raw: string): string {
  const parts = raw.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length === 0) return 'Field';
  return parts
    .map((p) => (/^[A-Z]+$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('');
}

/** 简单单数化：users → user、cities → city、boxes → box */
function singularize(word: string): string {
  if (word.length <= 2) return word;
  if (/ies$/i.test(word) && word.length > 3) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|ses|xes|zes)$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word) && !/ss$/i.test(word) && !/us$/i.test(word) && !/is$/i.test(word)) {
    return word.slice(0, -1);
  }
  return word;
}

/** 合法标识符直接使用，否则加引号 */
function fieldKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function formatInterface(iface: TsInterface): string {
  const lines = iface.fields.map((f) => {
    const opt = f.optional ? '?' : '';
    return `  ${fieldKey(f.key)}${opt}: ${f.type};`;
  });
  return `interface ${iface.name} {\n${lines.join('\n')}\n}`;
}

/** 将 JSON 数据转换为 TypeScript interface 定义文本 */
export function jsonToTs(data: JsonValue): string {
  const ctx: Ctx = { interfaces: [], usedNames: new Map() };
  describeValue(normalize(data), 'Root', ctx);
  return ctx.interfaces.map(formatInterface).join('\n\n');
}
