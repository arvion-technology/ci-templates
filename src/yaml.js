// A YAML reader for GitHub Actions workflows.
//
// Same constraints as the rest of these projects: no runtime dependencies. The
// subset covers block mappings and sequences, flow collections, quoted and
// plain scalars, comments and `|`/`>` block scalars. Workflows are mostly maps
// of strings, so this is enough to validate structure and render the explorer.

function stripComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index++) {
    const ch = value[index];
    if (quote) {
      if (ch === "\\" && quote === '"') index++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#" && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value.trimEnd();
}

function findColon(text) {
  let quote = null;
  for (let index = 0; index < text.length; index++) {
    const ch = text[index];
    if (quote) {
      if (ch === "\\" && quote === '"') index++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ":" && (index + 1 === text.length || /\s/.test(text[index + 1]))) return index;
  }
  return -1;
}

function tokenize(text) {
  const lines = [];
  const raw = String(text).replace(/\r\n?/g, "\n").split("\n");
  for (let lineNumber = 0; lineNumber < raw.length; lineNumber++) {
    const line = raw[lineNumber];
    if (!line.trim()) continue;
    const whitespace = line.match(/^[ \t]*/)[0];
    if (whitespace.includes("\t")) throw new Error(`yaml: tab indentation on line ${lineNumber + 1}`);
    const indent = whitespace.length;
    const rawContent = line.slice(indent).trimEnd();
    const content = stripComment(rawContent);
    if (!content || content === "---") continue;
    lines.push({ indent, content, rawContent, line: lineNumber + 1 });
  }
  return lines;
}

function parseScalar(text) {
  const value = text.trim();
  if (value === "") return null;
  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length > 1) return value.slice(1, -1).replace(/''/g, "'");
  if (value.startsWith("{") || value.startsWith("[")) return parseFlow(value);
  if (/^(null|~)$/i.test(value)) return null;
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function parseFlow(source) {
  let index = 0;
  const skip = () => { while (index < source.length && /\s/.test(source[index])) index++; };
  const quoted = () => {
    const quote = source[index++];
    let out = "";
    while (index < source.length) {
      const ch = source[index++];
      if (ch === "\\" && quote === '"') {
        const escape = source[index++];
        out += escape === "n" ? "\n" : escape === "t" ? "\t" : escape;
      } else if (ch === quote) {
        if (quote === "'" && source[index] === "'") { out += "'"; index++; continue; }
        return out;
      } else out += ch;
    }
    throw new Error("yaml: unterminated string in flow collection");
  };
  function value() {
    skip();
    const ch = source[index];
    if (ch === "{") {
      index++;
      const out = {};
      skip();
      if (source[index] === "}") { index++; return out; }
      for (;;) {
        skip();
        let key;
        if (source[index] === '"' || source[index] === "'") key = quoted();
        else {
          const start = index;
          while (index < source.length && !/[:}\]]/.test(source[index])) index++;
          key = source.slice(start, index).trim();
        }
        skip();
        if (source[index] !== ":") throw new Error("yaml: expected ':' in flow mapping");
        index++;
        out[key] = value();
        skip();
        if (source[index] === ",") { index++; continue; }
        if (source[index] === "}") { index++; return out; }
        throw new Error("yaml: expected ',' or '}' in flow mapping");
      }
    }
    if (ch === "[") {
      index++;
      const out = [];
      skip();
      if (source[index] === "]") { index++; return out; }
      for (;;) {
        out.push(value());
        skip();
        if (source[index] === ",") { index++; continue; }
        if (source[index] === "]") { index++; return out; }
        throw new Error("yaml: expected ',' or ']' in flow sequence");
      }
    }
    if (ch === '"' || ch === "'") return quoted();
    const start = index;
    while (index < source.length && !/[,\]}]/.test(source[index])) index++;
    return parseScalar(source.slice(start, index).trim());
  }
  const result = value();
  skip();
  if (index < source.length) throw new Error("yaml: trailing characters after flow value");
  return result;
}

function readBlock(lines, index, parentIndent, header) {
  const folded = header.startsWith(">");
  const chomp = header.endsWith("-");
  const collected = [];
  let base = null;
  while (index < lines.length && lines[index].indent > parentIndent) {
    const line = lines[index];
    if (base === null) base = line.indent;
    collected.push(" ".repeat(line.indent - base) + line.rawContent);
    index++;
  }
  const text = folded ? collected.join(" ").replace(/\s+/g, " ").trim() : collected.join("\n");
  return { value: chomp ? text : text + "\n", index };
}

function parseKey(text) {
  const key = text.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) return String(parseScalar(key));
  return key;
}

function parseMapping(lines, index, indent, seed) {
  const out = {};
  let current = index;
  let pending = seed;
  for (;;) {
    let content;
    if (pending !== undefined) { content = pending; pending = undefined; }
    else if (current < lines.length && lines[current].indent === indent && !lines[current].content.startsWith("-")) {
      content = lines[current].content;
      current++;
    } else break;

    const colon = findColon(content);
    if (colon < 0) throw new Error(`yaml: expected "key: value", got "${content}"`);
    const key = parseKey(content.slice(0, colon));
    const rest = content.slice(colon + 1).trim();

    if (rest.startsWith("|") || rest.startsWith(">")) {
      const block = readBlock(lines, current, indent, rest);
      out[key] = block.value;
      current = block.index;
    } else if (rest === "") {
      if (current < lines.length && lines[current].indent > indent) {
        const child = parseNode(lines, current, lines[current].indent);
        out[key] = child.value;
        current = child.index;
      } else out[key] = null;
    } else out[key] = parseScalar(rest);
  }
  return { value: out, index: current };
}

function parseSequence(lines, index, indent) {
  const out = [];
  let current = index;
  while (current < lines.length && lines[current].indent === indent && lines[current].content.startsWith("-")) {
    const line = lines[current];
    const rest = line.content.slice(1).trimStart();
    if (!rest) {
      current++;
      if (current < lines.length && lines[current].indent > indent) {
        const child = parseNode(lines, current, lines[current].indent);
        out.push(child.value);
        current = child.index;
      } else out.push(null);
      continue;
    }
    const virtualIndent = line.indent + (line.content.length - rest.length);
    if (rest.startsWith("{") || rest.startsWith("[")) {
      out.push(parseScalar(rest));
      current++;
    } else if (findColon(rest) >= 0) {
      const child = parseMapping(lines, current + 1, virtualIndent, rest);
      out.push(child.value);
      current = child.index;
    } else {
      out.push(parseScalar(rest));
      current++;
    }
  }
  return { value: out, index: current };
}

function parseNode(lines, index, indent) {
  if (index >= lines.length) return { value: null, index };
  return lines[index].content.startsWith("-")
    ? parseSequence(lines, index, indent)
    : parseMapping(lines, index, indent);
}

export function parseYaml(text) {
  const lines = tokenize(text);
  if (!lines.length) return null;
  const result = parseNode(lines, 0, lines[0].indent);
  if (result.index < lines.length) throw new Error(`yaml: unexpected content on line ${lines[result.index].line}`);
  return result.value;
}
