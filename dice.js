// Dice notation parser shared by server and client.
// Supports things like: d20, 2d6+3, 1d8-1, 4d6, 3d10+2d4+1
// Returns { total, breakdown, error }.

export function rollDice(notation) {
  const clean = String(notation).replace(/\s+/g, "").toLowerCase();
  if (!clean) return { error: "Empty roll" };

  // Split into +/- terms while keeping the sign.
  const terms = clean.match(/[+-]?[^+-]+/g);
  if (!terms) return { error: "Could not parse" };

  let total = 0;
  const parts = [];
  const dice = []; // structured per-die results for 3D rendering: { sides, value }

  for (const term of terms) {
    const sign = term.startsWith("-") ? -1 : 1;
    const body = term.replace(/^[+-]/, "");

    const dieMatch = body.match(/^(\d*)d(\d+)$/);
    if (dieMatch) {
      const count = parseInt(dieMatch[1] || "1", 10);
      const sides = parseInt(dieMatch[2], 10);
      if (count < 1 || count > 100 || sides < 2 || sides > 1000) {
        return { error: `Invalid die: ${body}` };
      }
      const rolls = [];
      for (let i = 0; i < count; i++) {
        const r = 1 + Math.floor(Math.random() * sides);
        rolls.push(r);
        total += sign * r;
        dice.push({ sides, value: r });
      }
      parts.push(`${sign < 0 ? "-" : ""}${count}d${sides}[${rolls.join(",")}]`);
    } else if (/^\d+$/.test(body)) {
      const n = parseInt(body, 10);
      total += sign * n;
      parts.push(`${sign < 0 ? "-" : "+"}${n}`);
    } else {
      return { error: `Unrecognized term: ${body}` };
    }
  }

  return { total, breakdown: parts.join(" "), notation: clean, dice };
}
