import * as RandExp from 'randexp';

/**
 * 判断 value 是否为「正则字面量」：整个 value 以 / 开头、以 / 结尾，且中间至少一个字符。
 * 例：/[A-Za-z0-9]{1,3}/
 */
export function isRegexLiteral(value: string): boolean {
  return value.startsWith('/') && value.endsWith('/') && value.length >= 3;
}

/**
 * 根据正则字面量生成一个符合该正则的随机字符串。
 * 例：/[A-Za-z0-9]{1,3}/ -> "ad1"
 * 非法正则会抛出 Error（由调用方按事件失败处理）。
 */
export function generateFromRegexLiteral(value: string): string {
  const pattern = value.slice(1, -1);
  try {
    return RandExp.randexp(pattern);
  } catch {
    throw new Error(`无效的正则表达式: ${value}`);
  }
}
