"use strict";

if (window.__calculatorLoaded) {
  throw new Error("script.js was loaded more than once");
}
window.__calculatorLoaded = true;

function requireEl(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element with id="${id}"`);
  return el;
}

const exprEl = requireEl("expression");
const resultEl = requireEl("result");
const keysEl = requireEl("keys");
const shiftBtn = requireEl("shift");
const modeButtons = document.querySelectorAll("[data-mode]");

const state = {
  expression: "",
  ans: 0,
  mode: "deg",
  shift: false,
  justEvaluated: false,
};

const EPSILON = 1e-12;

const ANGLE = {
  deg:  { toRad: x => (x * Math.PI) / 180, fromRad: x => (x * 180) / Math.PI },
  rad:  { toRad: x => x,                   fromRad: x => x },
  grad: { toRad: x => (x * Math.PI) / 200, fromRad: x => (x * 200) / Math.PI },
};

const FUNCTIONS = {
  sin:  (x, a) => Math.sin(a.toRad(x)),
  cos:  (x, a) => Math.cos(a.toRad(x)),
  tan:  (x, a) => {
    const r = a.toRad(x);
    if (Math.abs(Math.cos(r)) < EPSILON) throw new Error("Math error");
    return Math.tan(r);
  },
  asin: (x, a) => a.fromRad(Math.asin(x)),
  acos: (x, a) => a.fromRad(Math.acos(x)),
  atan: (x, a) => a.fromRad(Math.atan(x)),
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  log:  Math.log10,
  ln:   Math.log,
};

const LABELS = {
  asin: "sin⁻¹",
  acos: "cos⁻¹",
  atan: "tan⁻¹",
  sqrt: "√",
  cbrt: "∛",
};

const SYMBOL_ALIAS = { "-": "−", "*": "×", "/": "÷" };
const NAME_ALIAS = { "π": "pi", "√": "sqrt", "∛": "cbrt" };

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const NAMES = [...Object.keys(FUNCTIONS), "pi", "e", "Ans"]
  .sort((a, b) => b.length - a.length)
  .join("|");

const TOKEN_RE = new RegExp(
  `\\s*(\\d+(?:\\.\\d*)?|\\.\\d+|${NAMES}|[+\\-−×÷*/^%!²³()√∛π])`,
  "y"
);

function tokenize(source) {
  const text = source.trim();
  const tokens = [];
  TOKEN_RE.lastIndex = 0;

  while (TOKEN_RE.lastIndex < text.length) {
    const match = TOKEN_RE.exec(text);
    if (!match) throw new Error("Invalid character");

    const raw = match[1];

    if (/^[\d.]/.test(raw)) {
      tokens.push({ type: "number", value: Number(raw) });
    } else if (/^[a-zA-Z]/.test(raw) || hasOwn(NAME_ALIAS, raw)) {
      tokens.push({ type: "name", value: NAME_ALIAS[raw] || raw });
    } else {
      tokens.push({ type: "symbol", value: SYMBOL_ALIAS[raw] || raw });
    }
  }

  return tokens;
}

function factorial(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error("Factorial needs a whole number >= 0");
  if (n > 170) throw new Error("Result too large");

  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

class Parser {
  constructor(tokens, { angle, constants }) {
    this.tokens = tokens;
    this.angle = angle;
    this.constants = constants;
    this.pos = 0;
  }

  parse() {
    if (this.tokens.length === 0) throw new Error("Enter a calculation");

    const result = this.expression();
    if (this.pos !== this.tokens.length) throw new Error("Check your expression");
    if (!Number.isFinite(result)) throw new Error("Math error");
    return result;
  }

  peek() {
    return this.tokens[this.pos];
  }

  isSymbol(token, symbol) {
    return Boolean(token) && token.type === "symbol" && token.value === symbol;
  }

  eat(symbol) {
    if (this.isSymbol(this.peek(), symbol)) {
      this.pos++;
      return true;
    }
    return false;
  }

  expect(symbol) {
    if (!this.eat(symbol)) throw new Error(`Expected ${symbol}`);
  }

  startsFactor(token) {
    return Boolean(token) && (
      token.type === "number" ||
      token.type === "name" ||
      this.isSymbol(token, "(")
    );
  }

  expression() {
    let value = this.term();
    for (;;) {
      if (this.eat("+")) value += this.term();
      else if (this.eat("−")) value -= this.term();
      else return value;
    }
  }

  term() {
    let value = this.unary();
    for (;;) {
      if (this.eat("×")) value *= this.unary();
      else if (this.eat("÷")) value /= this.unary();
      else if (this.startsFactor(this.peek())) value *= this.unary();
      else return value;
    }
  }

  unary() {
    if (this.eat("−")) return -this.unary();
    if (this.eat("+")) return this.unary();
    return this.power();
  }

  power() {
    const base = this.postfix();
    return this.eat("^") ? Math.pow(base, this.unary()) : base;
  }

  postfix() {
    let value = this.primary();
    for (;;) {
      if (this.eat("!")) value = factorial(value);
      else if (this.eat("%")) value /= 100;
      else if (this.eat("²")) value **= 2;
      else if (this.eat("³")) value **= 3;
      else return value;
    }
  }

  primary() {
    const token = this.tokens[this.pos++];
    if (!token) throw new Error("Incomplete expression");

    if (token.type === "number") return token.value;

    if (token.type === "symbol") {
      if (token.value !== "(") throw new Error("Unexpected symbol");
      const value = this.expression();
      this.expect(")");
      return value;
    }

    if (hasOwn(this.constants, token.value)) return this.constants[token.value];
    if (!hasOwn(FUNCTIONS, token.value)) throw new Error(`Unknown function: ${token.value}`);

    let argument;
    if (this.eat("(")) {
      argument = this.expression();
      this.expect(")");
    } else {
      argument = this.unary();
    }
    return FUNCTIONS[token.value](argument, this.angle);
  }
}

function evaluate(source) {
  const parser = new Parser(tokenize(source), {
    angle: ANGLE[state.mode],
    constants: { pi: Math.PI, e: Math.E, Ans: state.ans },
  });
  return parser.parse();
}

function formatNumber(n) {
  if (!Number.isFinite(n)) throw new Error("Math error");
  if (Math.abs(n) < EPSILON) return "0";

  return String(Number(n.toPrecision(12))).replace(/e\+?(-?\d+)/, "×10^$1");
}

function closeBrackets(text) {
  const open = (text.match(/\(/g) || []).length;
  const close = (text.match(/\)/g) || []).length;
  return text + ")".repeat(Math.max(0, open - close));
}

const compute = () => evaluate(closeBrackets(state.expression));

function render() {
  exprEl.textContent = state.expression;
}

function showResult(text, title = "") {
  resultEl.textContent = text;
  resultEl.title = title;
}

function preview() {
  if (!state.expression.trim()) return showResult("0");

  try {
    showResult(formatNumber(compute()));
  } catch (error) {
    showResult("", error.message);
  }
}

function refresh() {
  render();
  preview();
}

const CONTINUES = /^[+−×÷^%!²³]/;
const TRAILING_TOKEN = new RegExp(
  `(?:${Object.keys(FUNCTIONS).sort((a, b) => b.length - a.length).join("|")})\\($|Ans$`
);

function insert(text) {
  if (state.justEvaluated && !CONTINUES.test(text)) state.expression = "";
  state.justEvaluated = false;

  if (text === "." && /\.\d*$/.test(state.expression)) return;

  state.expression += text;
  refresh();
}

function clearAll() {
  state.expression = "";
  state.ans = 0;
  state.justEvaluated = false;
  refresh();
}

function backspace() {
  const trimmed = state.expression.replace(TRAILING_TOKEN, "");
  state.expression = trimmed !== state.expression
    ? trimmed
    : state.expression.slice(0, -1);
  state.justEvaluated = false;
  refresh();
}

function equals() {
  if (!state.expression.trim()) return;

  const original = state.expression;
  const full = closeBrackets(original);

  try {
    const value = compute();
    const output = formatNumber(value);

    state.ans = value;
    state.expression = output;
    state.justEvaluated = true;

    exprEl.textContent = `${full} =`;
    showResult(output);
  } catch (error) {
    exprEl.textContent = original;
    showResult("Error", error.message);
  }
}

function setShift(on) {
  state.shift = on;
  shiftBtn.classList.toggle("active", on);
  shiftBtn.setAttribute("aria-pressed", String(on));

  keysEl.querySelectorAll("[data-alt]").forEach(button => {
    const name = on ? button.dataset.alt : button.dataset.fn;
    button.textContent = LABELS[name] || name;
  });
}

function setMode(mode, activeButton) {
  state.mode = mode;
  modeButtons.forEach(button => {
    button.classList.toggle("active", button === activeButton);
  });
  preview();
}

const ACTIONS = {
  clear: clearAll,
  back: backspace,
  ans: () => insert("Ans"),
  equals,
};

keysEl.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;

  const { fn, alt, insert: text, action } = button.dataset;

  if (fn) {
    insert(`${state.shift && alt ? alt : fn}(`);
    if (state.shift) setShift(false);
  } else if (text !== undefined) {
    insert(text);
  } else if (action && ACTIONS[action]) {
    ACTIONS[action]();
  }
});

modeButtons.forEach(button => {
  button.addEventListener("click", () => setMode(button.dataset.mode, button));
});

shiftBtn.addEventListener("click", () => setShift(!state.shift));

const KEY_ALIAS = { "-": "−", "*": "×", "/": "÷" };
const PASS_THROUGH_KEYS = new Set(["+", "^", "(", ")", ".", "%", "!"]);

document.addEventListener("keydown", event => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  const { key } = event;

  if (/^\d$/.test(key)) return insert(key);
  if (hasOwn(KEY_ALIAS, key)) return insert(KEY_ALIAS[key]);
  if (PASS_THROUGH_KEYS.has(key)) return insert(key);

  if (key === "Enter" || key === "=") {
    event.preventDefault();
    equals();
  } else if (key === "Backspace") {
    event.preventDefault();
    backspace();
  } else if (key === "Escape") {
    clearAll();
  }
});

refresh();
setShift(false);