/**
 * Deterministic synthetic layouts for the eval. Each function returns SVG
 * text. The seeded bugs are listed in evals/layout-keys.md.
 */

const W = 1280;
const H = 800;
const FONT = 'font-family="DejaVu Sans, Arial, sans-serif"';

function svg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>${body}</svg>`;
}

function text(x, y, size, value, fill = "#111111") {
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${FONT}>${value}</text>`;
}

function field(y, label, value, labelY = y - 14) {
  return (
    text(120, labelY, 24, label) +
    `<rect x="120" y="${y}" width="640" height="64" fill="#f2f2f2" stroke="#555555" stroke-width="2"/>` +
    text(140, y + 42, 26, value, "#333333")
  );
}

export function formSvg() {
  const body =
    text(120, 90, 40, "Account settings") +
    field(150, "Full name", "Jan Kowalski") +
    field(270, "Email", "jan@example.com", 318) +
    field(390, "City", "Gdansk") +
    `<rect x="120" y="510" width="28" height="28" fill="#ffffff" stroke="#555555" stroke-width="2"/>` +
    text(164, 534, 28, "Receive product updates by email and in the app") +
    `<rect x="120" y="600" width="220" height="70" fill="#1a1a1a"/>` +
    text(168, 646, 28, "Svae", "#ffffff");
  return svg(clipCard(body));
}

function clipCard(body) {
  return `<clipPath id="card"><rect x="0" y="0" width="860" height="${H}"/></clipPath><g clip-path="url(#card)">${body}</g>`;
}

const ROWS = [
  ["INV-1001", "2026-03-02", "Acme", "1 200.00"],
  ["INV-1002", "2026-03-09", "Borealis", "840.50"],
  ["INV-1003", "2026-03-16", "Cedar", "2 310.00"],
  ["INV-1003", "2026-03-16", "Cedar", "2 310.00"],
  ["INV-1004", "2026-13-45", "Delta", "99.99"],
  ["INV-1005", "2026-03-30", "Evergreen", "4 005.25"],
];

export function tableSvg() {
  const cols = [60, 300, 520, 1000];
  const head = ["Invoice", "Date", "Customer", "Total"]
    .map((label, i) => text(cols[i], 110, 28, label, "#000000"))
    .join("");
  const rows = ROWS.map((row, r) => {
    const y = 190 + r * 90;
    const cells = row.map((cell, i) => text(cols[i], y, 26, cell)).join("");
    return `<line x1="40" y1="${y + 30}" x2="1240" y2="${y + 30}" stroke="#bbbbbb" stroke-width="2"/>${cells}`;
  }).join("");
  const clip = `<clipPath id="t"><rect x="0" y="0" width="1100" height="${H}"/></clipPath>`;
  return svg(
    `${clip}<g clip-path="url(#t)">${text(60, 60, 38, "Invoices")}${head}${rows}</g>`,
  );
}

function bubble(x, y, w, who, message, time) {
  return (
    `<circle cx="${x - 40}" cy="${y + 40}" r="30" fill="#999999"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="80" rx="16" fill="#e6e6e6"/>` +
    text(x + 20, y + 32, 20, who, "#444444") +
    text(x + 20, y + 62, 24, message) +
    text(x + w - 110, y + 32, 20, time, "#444444")
  );
}

export function chatSvg() {
  const overlap =
    `<circle cx="100" cy="470" r="30" fill="#777777"/>` +
    `<circle cx="126" cy="490" r="30" fill="#bbbbbb"/>`;
  const body =
    text(60, 70, 38, "Messages") +
    bubble(120, 110, 700, "Anna", "Are we still meeting today?", "09:12") +
    bubble(120, 230, 700, "Piotr", "Yes, at the usual place.", "09:15") +
    bubble(120, 350, 700, "Anna", "Great, I will bring the plans.", "27:15") +
    overlap +
    `<rect x="160" y="450" width="700" height="80" rx="16" fill="#e6e6e6"/>` +
    text(180, 490, 24, "Two of us will join later.") +
    `<rect x="800" y="590" width="700" height="80" rx="16" fill="#cfcfcf"/>` +
    text(820, 640, 24, "Sent from my phone, see you there soon");
  return svg(body);
}

export const LAYOUTS = { form: formSvg, table: tableSvg, chat: chatSvg };
