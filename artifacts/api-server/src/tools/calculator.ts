export type CalculationResult = {
  tool: "safe-calculator";
  kind: "arithmetic" | "percentage" | "unit-conversion";
  expression: string;
  result: number;
  resultText: string;
  breakdown?: {
    regularHours: number;
    regularRate: number;
    regularPay: number;
    overtimeHours: number;
    overtimeRate: number;
    overtimePay: number;
  };
};

type UnitDefinition = {
  dimension: "length" | "mass" | "time" | "volume";
  factor: number;
  label: string;
};

const UNITS: Record<string, UnitDefinition> = {
  mm: { dimension: "length", factor: 0.001, label: "millimeters" },
  millimeter: { dimension: "length", factor: 0.001, label: "millimeters" },
  millimeters: { dimension: "length", factor: 0.001, label: "millimeters" },
  cm: { dimension: "length", factor: 0.01, label: "centimeters" },
  centimeter: { dimension: "length", factor: 0.01, label: "centimeters" },
  centimeters: { dimension: "length", factor: 0.01, label: "centimeters" },
  m: { dimension: "length", factor: 1, label: "meters" },
  meter: { dimension: "length", factor: 1, label: "meters" },
  meters: { dimension: "length", factor: 1, label: "meters" },
  km: { dimension: "length", factor: 1_000, label: "kilometers" },
  kilometer: { dimension: "length", factor: 1_000, label: "kilometers" },
  kilometers: { dimension: "length", factor: 1_000, label: "kilometers" },
  in: { dimension: "length", factor: 0.0254, label: "inches" },
  inch: { dimension: "length", factor: 0.0254, label: "inches" },
  inches: { dimension: "length", factor: 0.0254, label: "inches" },
  ft: { dimension: "length", factor: 0.3048, label: "feet" },
  foot: { dimension: "length", factor: 0.3048, label: "feet" },
  feet: { dimension: "length", factor: 0.3048, label: "feet" },
  yd: { dimension: "length", factor: 0.9144, label: "yards" },
  yard: { dimension: "length", factor: 0.9144, label: "yards" },
  yards: { dimension: "length", factor: 0.9144, label: "yards" },
  mi: { dimension: "length", factor: 1_609.344, label: "miles" },
  mile: { dimension: "length", factor: 1_609.344, label: "miles" },
  miles: { dimension: "length", factor: 1_609.344, label: "miles" },
  mg: { dimension: "mass", factor: 0.000001, label: "milligrams" },
  milligram: { dimension: "mass", factor: 0.000001, label: "milligrams" },
  milligrams: { dimension: "mass", factor: 0.000001, label: "milligrams" },
  g: { dimension: "mass", factor: 0.001, label: "grams" },
  gram: { dimension: "mass", factor: 0.001, label: "grams" },
  grams: { dimension: "mass", factor: 0.001, label: "grams" },
  kg: { dimension: "mass", factor: 1, label: "kilograms" },
  kilogram: { dimension: "mass", factor: 1, label: "kilograms" },
  kilograms: { dimension: "mass", factor: 1, label: "kilograms" },
  oz: { dimension: "mass", factor: 0.028349523125, label: "ounces" },
  ounce: { dimension: "mass", factor: 0.028349523125, label: "ounces" },
  ounces: { dimension: "mass", factor: 0.028349523125, label: "ounces" },
  lb: { dimension: "mass", factor: 0.45359237, label: "pounds" },
  lbs: { dimension: "mass", factor: 0.45359237, label: "pounds" },
  pound: { dimension: "mass", factor: 0.45359237, label: "pounds" },
  pounds: { dimension: "mass", factor: 0.45359237, label: "pounds" },
  second: { dimension: "time", factor: 1, label: "seconds" },
  seconds: { dimension: "time", factor: 1, label: "seconds" },
  minute: { dimension: "time", factor: 60, label: "minutes" },
  minutes: { dimension: "time", factor: 60, label: "minutes" },
  hour: { dimension: "time", factor: 3_600, label: "hours" },
  hours: { dimension: "time", factor: 3_600, label: "hours" },
  day: { dimension: "time", factor: 86_400, label: "days" },
  days: { dimension: "time", factor: 86_400, label: "days" },
  ml: { dimension: "volume", factor: 0.001, label: "milliliters" },
  milliliter: { dimension: "volume", factor: 0.001, label: "milliliters" },
  milliliters: { dimension: "volume", factor: 0.001, label: "milliliters" },
  l: { dimension: "volume", factor: 1, label: "liters" },
  liter: { dimension: "volume", factor: 1, label: "liters" },
  liters: { dimension: "volume", factor: 1, label: "liters" },
  cup: { dimension: "volume", factor: 0.2365882365, label: "US cups" },
  cups: { dimension: "volume", factor: 0.2365882365, label: "US cups" },
  gallon: { dimension: "volume", factor: 3.785411784, label: "US gallons" },
  gallons: { dimension: "volume", factor: 3.785411784, label: "US gallons" },
};

const CALCULATION_INTENT =
  /\b(calculate|compute|convert|equals?|gross pay|how much|how many|percent|percentage|plus|minus|times|multiplied|divided|total)\b|[0-9]\s*[+\-*/×÷]\s*[0-9]|\$\s*[0-9]/i;

function formatNumber(value: number): string {
  return Number(value.toPrecision(12)).toLocaleString("en-US", {
    maximumFractionDigits: 10,
    useGrouping: false,
  });
}

function checkedResult(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function calculateHourlyPay(message: string): CalculationResult | null {
  const match = message.match(
    /(?:make|earn|paid)\s*\$?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:an|per|\/)\s*hour[\s\S]*?(?:work|working|for)\s*([0-9]+(?:\.[0-9]+)?)\s*hours?/i,
  );
  if (!match) return null;
  const hourlyRate = Number(match[1]);
  const hours = Number(match[2]);
  const result = checkedResult(hourlyRate * hours);
  if (result === null) return null;
  return {
    tool: "safe-calculator",
    kind: "arithmetic",
    expression: `$${hourlyRate.toFixed(2)} per hour × ${formatNumber(hours)} hours`,
    result,
    resultText: `$${result.toFixed(2)}`,
  };
}

function calculatePercentage(message: string): CalculationResult | null {
  const percentOf = message.match(/([0-9]+(?:\.[0-9]+)?)\s*%\s+of\s+\$?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (percentOf) {
    const percentage = Number(percentOf[1]);
    const amount = Number(percentOf[2]);
    const result = checkedResult((percentage / 100) * amount);
    if (result === null) return null;
    return {
      tool: "safe-calculator",
      kind: "percentage",
      expression: `${formatNumber(percentage)}% × ${formatNumber(amount)}`,
      result,
      resultText: formatNumber(result),
    };
  }

  const change = message.match(
    /\$?\s*([0-9]+(?:\.[0-9]+)?)\s+(?:increased|decreased)\s+by\s+([0-9]+(?:\.[0-9]+)?)\s*%/i,
  );
  if (!change) return null;
  const amount = Number(change[1]);
  const percentage = Number(change[2]);
  const decreasing = /\bdecreased\b/i.test(change[0]);
  const result = checkedResult(amount * (1 + (decreasing ? -1 : 1) * percentage / 100));
  if (result === null) return null;
  return {
    tool: "safe-calculator",
    kind: "percentage",
    expression: `${formatNumber(amount)} ${decreasing ? "−" : "+"} ${formatNumber(percentage)}%`,
    result,
    resultText: formatNumber(result),
  };
}

function calculateTemperature(value: number, from: string, to: string): number | null {
  const normalizedFrom = from.toLowerCase()[0];
  const normalizedTo = to.toLowerCase()[0];
  if (normalizedFrom === normalizedTo) return value;
  const celsius =
    normalizedFrom === "c" ? value :
    normalizedFrom === "f" ? (value - 32) * 5 / 9 :
    normalizedFrom === "k" ? value - 273.15 :
    null;
  if (celsius === null) return null;
  return normalizedTo === "c" ? celsius :
    normalizedTo === "f" ? celsius * 9 / 5 + 32 :
    normalizedTo === "k" ? celsius + 273.15 :
    null;
}

function calculateConversion(message: string): CalculationResult | null {
  const temperature = message.match(
    /(-?[0-9]+(?:\.[0-9]+)?)\s*(?:degrees?\s*)?(celsius|fahrenheit|kelvin|°c|°f|k)\s+(?:to|in)\s+(celsius|fahrenheit|kelvin|°c|°f|k)/i,
  );
  if (temperature) {
    const value = Number(temperature[1]);
    const result = checkedResult(calculateTemperature(value, temperature[2].replace("°", ""), temperature[3].replace("°", "")) ?? Number.NaN);
    if (result === null) return null;
    return {
      tool: "safe-calculator",
      kind: "unit-conversion",
      expression: `${formatNumber(value)} ${temperature[2]} to ${temperature[3]}`,
      result,
      resultText: `${formatNumber(result)} ${temperature[3]}`,
    };
  }

  const conversion = message.match(
    /(-?[0-9]+(?:\.[0-9]+)?)\s*([a-z]+)\s+(?:to|in|into)\s+([a-z]+)/i,
  );
  if (!conversion) return null;
  const value = Number(conversion[1]);
  const from = UNITS[conversion[2].toLowerCase()];
  const to = UNITS[conversion[3].toLowerCase()];
  if (!from || !to || from.dimension !== to.dimension) return null;
  const result = checkedResult(value * from.factor / to.factor);
  if (result === null) return null;
  return {
    tool: "safe-calculator",
    kind: "unit-conversion",
    expression: `${formatNumber(value)} ${from.label} to ${to.label}`,
    result,
    resultText: `${formatNumber(result)} ${to.label}`,
  };
}

class ArithmeticParser {
  private index = 0;

  constructor(private readonly input: string) {}

  parse(): number | null {
    const value = this.parseExpression();
    this.skipWhitespace();
    return value !== null && this.index === this.input.length ? checkedResult(value) : null;
  }

  private parseExpression(): number | null {
    let value = this.parseTerm();
    if (value === null) return null;
    while (true) {
      this.skipWhitespace();
      const operator = this.input[this.index];
      if (operator !== "+" && operator !== "-") break;
      this.index += 1;
      const right = this.parseTerm();
      if (right === null) return null;
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  private parseTerm(): number | null {
    let value = this.parseFactor();
    if (value === null) return null;
    while (true) {
      this.skipWhitespace();
      const operator = this.input[this.index];
      if (operator !== "*" && operator !== "/") break;
      this.index += 1;
      const right = this.parseFactor();
      if (right === null || (operator === "/" && right === 0)) return null;
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }

  private parseFactor(): number | null {
    this.skipWhitespace();
    if (this.input[this.index] === "+" || this.input[this.index] === "-") {
      const negative = this.input[this.index] === "-";
      this.index += 1;
      const value = this.parseFactor();
      return value === null ? null : negative ? -value : value;
    }
    if (this.input[this.index] === "(") {
      this.index += 1;
      const value = this.parseExpression();
      this.skipWhitespace();
      if (value === null || this.input[this.index] !== ")") return null;
      this.index += 1;
      return value;
    }
    const match = this.input.slice(this.index).match(/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)/);
    if (!match) return null;
    this.index += match[0].length;
    return Number(match[0]);
  }

  private skipWhitespace() {
    while (/\s/.test(this.input[this.index] ?? "")) this.index += 1;
  }
}

function calculateArithmetic(message: string): CalculationResult | null {
  const normalized = message
    .toLowerCase()
    .replace(/\bmultiplied\s+by\b|\btimes\b/g, "*")
    .replace(/\bdivided\s+by\b/g, "/")
    .replace(/\bplus\b/g, "+")
    .replace(/\bminus\b/g, "-")
    .replace(/[×]/g, "*")
    .replace(/[÷]/g, "/");
  const candidates = normalized.match(/[-+*/().\d\s]{3,}/g) ?? [];
  const expression = candidates
    .map((candidate) => candidate.trim())
    .filter((candidate) => /\d/.test(candidate) && /[+*/-]/.test(candidate))
    .sort((left, right) => right.length - left.length)[0];
  if (!expression || expression.length > 200 || !/^[\d\s+\-*/().]+$/.test(expression)) return null;
  const result = new ArithmeticParser(expression).parse();
  if (result === null) return null;
  return {
    tool: "safe-calculator",
    kind: "arithmetic",
    expression,
    result,
    resultText: formatNumber(result),
  };
}

export function calculateForMessage(message: string): CalculationResult | null {
  if (!CALCULATION_INTENT.test(message)) return null;
  return (
    calculateHourlyPay(message) ??
    calculatePercentage(message) ??
    calculateConversion(message) ??
    calculateArithmetic(message)
  );
}

export function extractHourlyRate(message: string): number | null {
  const match = message.match(
    /\$\s*([0-9]+(?:\.[0-9]+)?)\s*(?:an|per|\/)\s*hour\b|\b([0-9]+(?:\.[0-9]+)?)\s+dollars?\s*(?:an|per|\/)\s*hour\b/i,
  );
  const rate = Number(match?.[1] ?? match?.[2]);
  return Number.isFinite(rate) && rate >= 0 ? rate : null;
}

export function calculateWeeklyGrossPay(
  scheduledHours: number,
  hourlyRate: number,
): CalculationResult | null {
  if (
    !Number.isFinite(scheduledHours) ||
    !Number.isFinite(hourlyRate) ||
    scheduledHours < 0 ||
    hourlyRate < 0
  ) {
    return null;
  }
  const regularHours = Math.min(scheduledHours, 40);
  const overtimeHours = Math.max(scheduledHours - 40, 0);
  const overtimeRate = hourlyRate * 1.5;
  const regularPay = checkedResult(regularHours * hourlyRate);
  const overtimePay = checkedResult(overtimeHours * overtimeRate);
  if (regularPay === null || overtimePay === null) return null;
  const result = checkedResult(regularPay + overtimePay);
  if (result === null) return null;
  return {
    tool: "safe-calculator",
    kind: "arithmetic",
    expression:
      `${formatNumber(regularHours)} regular hours × $${hourlyRate.toFixed(2)} per hour` +
      ` + ${formatNumber(overtimeHours)} overtime hours × $${overtimeRate.toFixed(2)} per hour`,
    result,
    resultText: `$${result.toFixed(2)}`,
    breakdown: {
      regularHours,
      regularRate: hourlyRate,
      regularPay,
      overtimeHours,
      overtimeRate,
      overtimePay,
    },
  };
}

export function buildCalculationContext(message: string, calculation: CalculationResult): string {
  const breakdown = calculation.breakdown
    ? `
Regular hours: ${formatNumber(calculation.breakdown.regularHours)}
Regular rate: $${calculation.breakdown.regularRate.toFixed(2)} per hour
Regular pay: $${calculation.breakdown.regularPay.toFixed(2)}
Overtime hours: ${formatNumber(calculation.breakdown.overtimeHours)}
Overtime rate: $${calculation.breakdown.overtimeRate.toFixed(2)} per hour
Overtime pay: $${calculation.breakdown.overtimePay.toFixed(2)}
`
    : "";
  return `[Lumen deterministic calculation]
Tool: Safe calculator
Type: ${calculation.kind}
Calculation: ${calculation.expression}
Result: ${calculation.resultText}
${breakdown}

The calculation above was produced deterministically by Lumen using a restricted numeric parser and fixed conversion tables. Use this result as factual context for the final response. Do not redo or contradict the arithmetic.

[User request]
${message}`;
}