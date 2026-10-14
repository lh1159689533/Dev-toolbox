import { RpaLocatorType } from '../shared/rpa-types';
import type { RpaLocator } from '../shared/rpa-types';

/** 元素定位器：为元素生成多种定位策略（对齐 rocket-agent-plugin RpaLocatorEngine） */
export class RpaLocatorEngine {
  /**
   * 为指定元素生成多种定位器策略
   */
  static generateLocators(el: Element): RpaLocator[] {
    const locators: RpaLocator[] = [];

    // 1. ID 定位（最优先）
    if (el.id) {
      locators.push({ type: RpaLocatorType.ID, value: el.id, confidence: 1.0 });
    }

    // 2. data-testid
    const testId = el.getAttribute('data-testid');
    if (testId) {
      locators.push({ type: RpaLocatorType.CSS, value: `[data-testid="${testId}"]`, confidence: 0.95 });
    }

    // 3. name 属性
    const name = el.getAttribute('name');
    if (name) {
      locators.push({ type: RpaLocatorType.Name, value: name, confidence: 0.9 });
    }

    // 3.5 针对 input/textarea 的属性增强定位
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const attrSelector = this.generateInputAttrSelector(el as HTMLInputElement);
      if (attrSelector) {
        try {
          const matches = document.querySelectorAll(attrSelector);
          if (matches.length === 1) {
            locators.push({ type: RpaLocatorType.CSS, value: attrSelector, confidence: 0.88 });
          }
        } catch {
          // 选择器无效，跳过
        }
      }
    }

    // 4. 父级属性 + 子元素索引定位（多语言友好）
    const ancestorLocator = this.generateAncestorBasedLocator(el);
    if (ancestorLocator) {
      locators.push(ancestorLocator);
    }

    // 5. CSS 选择器（基于 DOM 结构）
    const cssSelector = this.generateCssSelector(el);
    if (cssSelector) {
      locators.push({ type: RpaLocatorType.CSS, value: cssSelector, confidence: 0.7 });
    }

    // 6. XPath（增强：对 input 元素优先使用属性 XPath）
    const xpath = this.generateXPath(el);
    if (xpath) {
      locators.push({ type: RpaLocatorType.XPath, value: xpath, confidence: 0.6 });
    }

    // 7. 文本定位（最低优先级，多语言场景不稳定）
    const textLocator = this.generateTextLocator(el);
    if (textLocator) {
      locators.push({ ...textLocator, confidence: Math.min(textLocator.confidence, 0.5) });
    }

    return locators;
  }

  /**
   * 针对 input/textarea 生成基于属性的 CSS 选择器
   */
  static generateInputAttrSelector(el: HTMLInputElement | HTMLTextAreaElement): string | null {
    const tag = el.tagName.toLowerCase();
    const attrs: string[] = [];

    const placeholder = el.getAttribute('placeholder');
    if (placeholder) {
      attrs.push(`[placeholder="${CSS.escape(placeholder)}"]`);
    }

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
      attrs.push(`[aria-label="${CSS.escape(ariaLabel)}"]`);
    }

    const inputType = el.getAttribute('type');
    if (inputType && inputType !== 'text') {
      attrs.push(`[type="${CSS.escape(inputType)}"]`);
    }

    const autoComplete = el.getAttribute('autocomplete');
    if (autoComplete) {
      attrs.push(`[autocomplete="${CSS.escape(autoComplete)}"]`);
    }

    if (attrs.length === 0) return null;
    return tag + attrs.join('');
  }

  /**
   * 生成 CSS 选择器
   */
  static generateCssSelector(el: Element): string | null {
    if (el.id && !el.id.match(/^:r[0-9a-z]+:$/) && !el.id.match(/^(react|radix|headless)/i)) {
      return `#${CSS.escape(el.id)}`;
    }

    const testId = el.getAttribute('data-testid');
    if (testId) {
      return `[data-testid="${CSS.escape(testId)}"]`;
    }

    const parts: string[] = [];
    let current: Element | null = el;

    while (current && current !== document.body && parts.length < 6) {
      const selector = this.buildSelectorPart(current);

      if (selector) {
        parts.unshift(selector);
      } else {
        const tag = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children);
          const index = siblings.indexOf(current) + 1;
          parts.unshift(`${tag}:nth-child(${index})`);
        } else {
          parts.unshift(tag);
        }
      }

      const fullSelector = parts.join(' > ');
      try {
        const matches = document.querySelectorAll(fullSelector);
        if (matches.length === 1) return fullSelector;
      } catch {
        // 选择器语法错误，继续
      }

      current = current.parentElement;
    }

    const result = parts.join(' > ');
    if (!result) {
      return null;
    }

    const hasMeaningfulAttribute = /[.#\[]/.test(result);
    if (!hasMeaningfulAttribute) {
      return null; // 纯标签名 + nth-child 组合，不可靠
    }

    return result;
  }

  /**
   * 为单个元素构建选择器片段
   */
  static buildSelectorPart(current: Element): string | null {
    const tag = current.tagName.toLowerCase();
    const selectorParts: string[] = [];

    const id = current.getAttribute('id');
    const isSvgElement =
      tag === 'svg' ||
      tag === 'path' ||
      tag === 'g' ||
      tag === 'use' ||
      tag === 'symbol' ||
      tag === 'defs' ||
      tag === 'clippath' ||
      tag === 'mask' ||
      current instanceof SVGElement;
    if (
      id &&
      !isSvgElement &&
      !id.match(/^:r[0-9a-z]+:$/) &&
      !id.match(/^(react|radix|headless)/i)
    ) {
      return `#${CSS.escape(id)}`;
    }

    const testId = current.getAttribute('data-testid');
    if (testId) {
      return `[data-testid="${CSS.escape(testId)}"]`;
    }

    const name = current.getAttribute('name');
    if (name) {
      return `[name="${CSS.escape(name)}"]`;
    }

    const meaningfulClasses = Array.from(current.classList).filter(
      (c) =>
        !c.match(/^(active|hover|focus|selected|disabled|hidden|show|open|close)/i) &&
        !c.match(/^(ng-|v-|react-|css-|sc-|tw-)/i) &&
        !c.match(
          /[-_](focused|active|hover|selected|disabled|checked|expanded|collapsed|visible|hidden|opened|closed|loading|dragging|highlight)/i,
        ) &&
        !c.match(/^(is-|t-is-|el-is-|ant-)/i) &&
        !c.match(/--animation-|--enter|--leave|--theme-/i) &&
        c.length < 40 &&
        !this.looksLikeHashClassName(c),
    );

    if (meaningfulClasses.length > 0) {
      const mainClass = meaningfulClasses[0];
      const classSelector = '.' + CSS.escape(mainClass);

      const parent = current.parentElement;
      if (parent) {
        const siblingsWithSameClass = Array.from(parent.children).filter(
          (s) => s.classList.contains(mainClass),
        );
        if (siblingsWithSameClass.length > 1) {
          const allChildren = Array.from(parent.children);
          const index = allChildren.indexOf(current) + 1;
          return `${classSelector}:nth-child(${index})`;
        }
      }
      return classSelector;
    }

    const role = current.getAttribute('role');
    if (role) {
      selectorParts.push(`[role="${role}"]`);
    }

    const type = current.getAttribute('type');
    if (type && (tag === 'input' || tag === 'button')) {
      selectorParts.push(`[type="${type}"]`);
    }

    if (selectorParts.length > 0) {
      const parent = current.parentElement;
      let nthPart = '';
      if (parent) {
        const siblings = Array.from(parent.children).filter((s) => {
          return s.tagName === current.tagName;
        });
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          nthPart = `:nth-of-type(${index})`;
        }
      }
      return selectorParts.join('') + nthPart;
    }

    return null;
  }

  /**
   * 判断类名是否看起来像 CSS Modules 的 hash 类名（构建产物，跨构建不稳定）。
   * hash 特征：数字+大写混合，或含 >=2 个非首字母大写（随机大小写）。
   * 语义类名（如 t-collapse-panel__header、ant-btn）通常为小写 kebab-case，不受影响。
   */
  private static looksLikeHashClassName(className: string): boolean {
    if (/\d/.test(className) && /[A-Z]/.test(className)) return true;
    const nonInitialUppers = (className.slice(1).match(/[A-Z]/g) || []).length;
    return nonInitialUppers >= 2;
  }

  /**
   * 基于祖先元素的稳定属性 + 子元素相对路径生成定位器
   */
  static generateAncestorBasedLocator(el: Element): RpaLocator | null {
    const ancestorInfo = this.findAncestorWithStableAttribute(el);
    if (!ancestorInfo) return null;

    const { ancestor, selector: ancestorSelector } = ancestorInfo;

    const relativePath = this.getRelativePathFromAncestor(ancestor, el);
    if (!relativePath) return null;

    const fullSelector = `${ancestorSelector}${relativePath}`;

    try {
      const result = document.evaluate(
        fullSelector,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null,
      );
      if (result.snapshotLength === 1) {
        return { type: RpaLocatorType.XPath, value: fullSelector, confidence: 0.88 };
      }
    } catch {
      // XPath 执行失败
    }

    return null;
  }

  /**
   * 查找有稳定属性的祖先元素
   */
  static findAncestorWithStableAttribute(
    el: Element,
  ): { ancestor: Element; selector: string } | null {
    let current = el.parentElement;
    let depth = 0;
    const maxDepth = 10;

    while (current && depth < maxDepth) {
      const id = current.getAttribute('id');
      if (id && !id.match(/^:r[0-9a-z]+:$/) && !id.match(/^(react|radix|headless)/i)) {
        return { ancestor: current, selector: `//*[@id='${id}']` };
      }

      const testId = current.getAttribute('data-testid');
      if (testId) {
        return { ancestor: current, selector: `//*[@data-testid='${testId}']` };
      }

      const name = current.getAttribute('name');
      if (name) {
        return { ancestor: current, selector: `//*[@name='${name}']` };
      }

      const semanticClass = this.findSemanticClass(current);
      if (semanticClass) {
        const baseSelector = `//*[contains(concat(' ', normalize-space(@class), ' '), ' ${semanticClass} ')]`;
        // 页面可能存在多个同类元素（如多个折叠面板 header），
        // 需加「第 N 个」序号才能唯一定位目标所在的那一个，否则锚点匹配多个会校验失败。
        const allWithClass = Array.from(document.querySelectorAll(`.${CSS.escape(semanticClass)}`));
        const index = allWithClass.indexOf(current) + 1;
        const selector = allWithClass.length > 1 ? `(${baseSelector})[${index}]` : baseSelector;
        return { ancestor: current, selector };
      }

      current = current.parentElement;
      depth++;
    }

    return null;
  }

  /**
   * 查找元素的语义类名（全小写、含连字符/下划线分隔的多段，非 hash、非状态类）。
   * 用于作为 XPath 稳定锚点。
   */
  private static findSemanticClass(el: Element): string | null {
    for (const c of Array.from(el.classList)) {
      if (c.length < 4 || c.length >= 40) continue;
      if (this.looksLikeHashClassName(c)) continue;
      if (!/^[a-z][a-z0-9]*(?:[-_]+[a-z0-9]+)+$/.test(c)) continue;
      if (/^(active|hover|focus|selected|disabled|hidden|show|open|close)/i.test(c)) continue;
      return c;
    }
    return null;
  }

  /**
   * 计算从祖先元素到目标元素的相对 XPath 路径
   */
  static getRelativePathFromAncestor(ancestor: Element, target: Element): string | null {
    const pathParts: string[] = [];
    let current: Element | null = target;

    while (current && current !== ancestor) {
      const parent: Element | null = current.parentElement;
      if (!parent) break;

      const semanticClass = this.findSemanticClass(current);
      if (semanticClass) {
        // 优先用语义类名 + 同类序号，跨构建更稳定
        const siblingsWithClass = Array.from(parent.children).filter((s) =>
          s.classList.contains(semanticClass),
        );
        const index = siblingsWithClass.indexOf(current) + 1;
        const classPred = `contains(concat(' ', normalize-space(@class), ' '), ' ${semanticClass} ')`;
        pathParts.unshift(`/*[${classPred}][${index}]`);
      } else {
        const siblings = Array.from(parent.children);
        const index = siblings.indexOf(current) + 1;
        pathParts.unshift(`/*[${index}]`);
      }

      current = parent;
    }

    if (current !== ancestor) return null;

    if (pathParts.length > 6) return null;

    return pathParts.join('');
  }

  /**
   * 基于文本内容生成定位器（最低优先级备选）
   */
  static generateTextLocator(el: Element): RpaLocator | null {
    const fullText = el.textContent?.trim() || '';

    if (fullText.length < 2 || fullText.length > 30) return null;

    const clickableTags = ['BUTTON', 'A', 'SPAN', 'DIV', 'LI', 'TD', 'LABEL'];
    const role = el.getAttribute('role');
    const isClickable =
      clickableTags.includes(el.tagName) ||
      role === 'button' ||
      role === 'menuitem' ||
      role === 'option' ||
      role === 'tab' ||
      role === 'link';

    if (!isClickable) return null;

    const escapedText = fullText.replace(/'/g, "\\'");

    try {
      const xpath = `//*[normalize-space(text())='${escapedText}']`;
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null,
      );
      if (result.snapshotLength === 1) {
        return { type: RpaLocatorType.XPath, value: xpath, confidence: 0.5 };
      }
    } catch {
      // XPath 执行失败
    }

    return null;
  }

  /**
   * 获取元素的直接文本内容（不包含子元素）
   */
  static getDirectTextContent(el: Element): string {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent || '';
      }
    }
    return text.trim();
  }

  /** 生成 XPath */
  static generateXPath(el: Element): string {
    if (el.id) return `//*[@id="${el.id}"]`;

    const parts: string[] = [];
    let current: Node | null = el;

    while (current && current !== document.body) {
      if (current.nodeType === Node.ELEMENT_NODE) {
        const element = current as Element;
        let part = element.tagName.toLowerCase();

        const parent = element.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            (s) => s.tagName === element.tagName,
          );
          if (siblings.length > 1) {
            const index = siblings.indexOf(element) + 1;
            part += `[${index}]`;
          }
        }

        parts.unshift(part);
      }
      current = current.parentNode;
    }

    return '//' + parts.join('/');
  }

  /** 根据定位器查找元素 */
  static findElement(type: string, value: string): Element | null {
    try {
      switch (type) {
        case 'id':
          return document.getElementById(value);
        case 'css':
          return document.querySelector(value);
        case 'xpath': {
          const result = document.evaluate(
            value,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null,
          );
          return result.singleNodeValue as Element | null;
        }
        case 'name':
          return document.querySelector(`[name="${value}"]`);
        case 'linkText': {
          const links = document.querySelectorAll('a');
          for (const link of links) {
            if (link.textContent?.trim() === value) return link;
          }
          return null;
        }
        case 'partialLinkText': {
          const allLinks = document.querySelectorAll('a');
          for (const link of allLinks) {
            if (link.textContent?.includes(value)) return link;
          }
          return null;
        }
        case 'tagName':
          return document.querySelector(value);
        default:
          return document.querySelector(value);
      }
    } catch {
      return null;
    }
  }

  /** 查找一个定位器的所有匹配 */
  static findAll(type: string, value: string): Element[] {
    try {
      switch (type) {
        case 'id': {
          // 注意：不能用 getElementById —— 它永远只返回文档中第一个匹配，
          // 而 SVG 图标库（如 t-icon）内部 path 的 id（fill1 等）在多个图标间重复，
          // 会导致重复 id 被误判为「唯一命中」而点错元素。
          // querySelectorAll 会返回全部同 id 元素，交由 findUniqueElement 做唯一性校验。
          return Array.from(document.querySelectorAll(`#${CSS.escape(value)}`));
        }
        case 'css':
          return Array.from(document.querySelectorAll(value));
        case 'xpath': {
          const result = document.evaluate(
            value,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null,
          );
          const nodes: Element[] = [];
          for (let i = 0; i < result.snapshotLength; i++) {
            const node = result.snapshotItem(i);
            if (node instanceof Element) nodes.push(node);
          }
          return nodes;
        }
        case 'name':
          return Array.from(document.getElementsByName(value));
        case 'linkText': {
          const links = document.querySelectorAll('a');
          return Array.from(links).filter((l) => l.textContent?.trim() === value);
        }
        case 'partialLinkText': {
          const links = document.querySelectorAll('a');
          return Array.from(links).filter((l) => l.textContent?.includes(value));
        }
        case 'tagName':
          return Array.from(document.getElementsByTagName(value));
        default:
          return Array.from(document.querySelectorAll(value));
      }
    } catch {
      return [];
    }
  }

  /**
   * 根据 target 字符串查找唯一元素。
   * target 可包含多个定位器（用 ` || ` 分隔），逐个尝试，返回第一个「唯一命中」的元素。
   * 若所有定位器都命中 0 个或多个（不唯一），返回 null（宁可失败也不点错）。
   */
  static findUniqueElement(target: string): Element | null {
    const locators = this.parseTargets(target);
    for (const { type, value } of locators) {
      const matches = this.findAll(type, value);
      if (matches.length === 1) return matches[0];
    }
    return null;
  }

  /** 解析 target 字符串为 type + value */
  static parseTarget(target: string): { type: string; value: string } {
    const match = target.match(/^(id|css|xpath|name|linkText|partialLinkText|tagName)=(.+)$/);
    if (match) {
      return { type: match[1], value: match[2] };
    }
    if (target.startsWith('//') || target.startsWith('(//')) {
      return { type: 'xpath', value: target };
    }
    if (target.startsWith('#')) {
      return { type: 'css', value: target };
    }
    return { type: 'css', value: target };
  }

  /** 解析 target 字符串为多个定位器（用 ` || ` 分隔，向后兼容单一定位器） */
  static parseTargets(target: string): { type: string; value: string }[] {
    if (!target) return [];
    const result: { type: string; value: string }[] = [];
    for (const raw of target.split('||')) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      result.push(this.parseTarget(trimmed));
    }
    return result;
  }
}
