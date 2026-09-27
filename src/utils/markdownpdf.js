import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import SVGtoPDF from "svg-to-pdfkit";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const mathDocument = mathjax.document("", {
    InputJax: new TeX({ packages: AllPackages }),
    OutputJax: new SVG({ fontCache: "none" })
});

const INLINE_MATH = /\$\$([^$]+?)\$\$|\\\((.+?)\\\)|\$(?=\S)([^$\n]+?)(?<=\S)\$(?!\d)/g;

function renderMath(latex, display, size) {
    try {
        const svg = adaptor.innerHTML(mathDocument.convert(latex, { display }));
        if (svg.includes("data-mjx-error") || svg.includes("merror")) return null;
        const ex = size / 2;
        const width = parseFloat(svg.match(/width="([\d.]+)ex"/)[1]) * ex;
        const height = parseFloat(svg.match(/height="([\d.]+)ex"/)[1]) * ex;
        const depth = -parseFloat(svg.match(/vertical-align:\s*(-?[\d.]+)ex/)?.[1] ?? 0) * ex;
        return { svg, width, height, depth };
    } catch {
        return null;
    }
}

const BOLD_OF = {
    "Helvetica": "Helvetica-Bold",
    "Helvetica-Oblique": "Helvetica-BoldOblique",
    "Helvetica-Bold": "Helvetica-Bold",
    "Helvetica-BoldOblique": "Helvetica-BoldOblique",
    "Courier": "Courier-Bold"
};

const TABLE_SEPARATOR = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

export function stripInlineMarkdown(text) {
    return String(text)
        .replace(/\*\*\*|\*\*|__|`/g, "")
        .replace(/(^|\s)\*(\S[^*]*)\*/g, "$1$2");
}

function inlineRuns(text) {
    const runs = [];
    let last = 0;
    let m;
    INLINE_MATH.lastIndex = 0;
    while ((m = INLINE_MATH.exec(text))) {
        if (m.index > last) runs.push(...formatRuns(text.slice(last, m.index)));
        runs.push({ math: m[1] ?? m[2] ?? m[3], font: "Helvetica" });
        last = m.index + m[0].length;
    }
    if (last < text.length) runs.push(...formatRuns(text.slice(last)));
    return runs;
}

function formatRuns(text) {
    const runs = [];
    const re = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|`[^`]+`)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
        if (m.index > last) runs.push({ text: text.slice(last, m.index), font: "Helvetica" });
        const t = m[0];
        if (t.startsWith("***")) runs.push({ text: t.slice(3, -3), font: "Helvetica-BoldOblique" });
        else if (t.startsWith("**") || t.startsWith("__")) runs.push({ text: t.slice(2, -2), font: "Helvetica-Bold" });
        else if (t.startsWith("`")) runs.push({ text: t.slice(1, -1), font: "Courier" });
        else runs.push({ text: t.slice(1, -1), font: "Helvetica-Oblique" });
        last = m.index + t.length;
    }
    if (last < text.length) runs.push({ text: text.slice(last), font: "Helvetica" });
    return runs.filter(r => r.text);
}

function flowRuns(doc, runs, size, { bold = false, indent = 0 }) {
    const left = doc.page.margins.left + indent;
    const maxWidth = doc.page.width - doc.page.margins.right - left;
    const items = [];

    for (const r of runs) {
        const math = r.math ? renderMath(r.math, false, size) : null;
        if (math) {
            items.push({ math, width: math.width });
            continue;
        }
        const font = r.math ? "Courier" : bold ? BOLD_OF[r.font] : r.font;
        for (const part of (r.math ?? r.text).split(/(\s+)/)) {
            if (!part) continue;
            items.push({ text: part, font, space: /^\s+$/.test(part), width: doc.font(font).fontSize(size).widthOfString(part) });
        }
    }

    const flush = (line) => {
        while (line.length && line[line.length - 1].space) line.pop();
        if (!line.length) return;
        const ascent = Math.max(size * 0.8, ...line.filter(i => i.math).map(i => i.math.height - i.math.depth));
        const descent = Math.max(size * 0.25, ...line.filter(i => i.math).map(i => i.math.depth));
        if (doc.y + ascent + descent > doc.page.height - doc.page.margins.bottom) doc.addPage();
        const baseline = doc.y + ascent;
        let x = left;
        for (const item of line) {
            if (item.math) {
                SVGtoPDF(doc, item.math.svg, x, baseline - (item.math.height - item.math.depth), { width: item.math.width, height: item.math.height });
            } else if (!item.space) {
                doc.font(item.font).fontSize(size);
                doc.text(item.text, x, baseline - (doc._font.ascender / 1000) * size, { lineBreak: false });
            }
            x += item.width;
        }
        doc.x = doc.page.margins.left;
        doc.y = baseline + descent + size * 0.15;
    };

    let line = [];
    let lineWidth = 0;
    for (const item of items) {
        if (item.space && !line.length) continue;
        if (lineWidth + item.width > maxWidth && line.length && !item.space) {
            flush(line);
            line = [];
            lineWidth = 0;
        }
        line.push(item);
        lineWidth += item.width;
    }
    flush(line);
}

function displayMath(doc, latex) {
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const math = renderMath(latex, true, 13);
    if (!math) {
        doc.font("Courier").fontSize(11).text(latex, left, doc.y, { width, align: "center" });
        doc.moveDown(0.5);
        return;
    }
    const scale = Math.min(1, width / math.width);
    const w = math.width * scale;
    const h = math.height * scale;
    if (doc.y + h + 12 > doc.page.height - doc.page.margins.bottom) doc.addPage();
    SVGtoPDF(doc, math.svg, left + (width - w) / 2, doc.y + 6, { width: w, height: h });
    doc.x = left;
    doc.y += h + 12;
}

function writeRuns(doc, runs, size, { bold = false, indent = 0 } = {}) {
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right - indent;
    if (runs.length === 0) return;
    if (runs.some(r => r.math)) return flowRuns(doc, runs, size, { bold, indent });
    runs.forEach((r, i) => {
        doc.font(bold ? BOLD_OF[r.font] : r.font).fontSize(size);
        const continued = i < runs.length - 1;
        if (i === 0) doc.text(r.text, left + indent, doc.y, { width, continued });
        else doc.text(r.text, { continued });
    });
}

function parseRow(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => stripInlineMarkdown(c.trim()));
}

function drawTable(doc, rows) {
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const cols = Math.max(...rows.map(r => r.length));
    const colW = width / cols;
    const pad = 4;

    rows.forEach((row, ri) => {
        doc.font(ri === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(10);
        const cells = Array.from({ length: cols }, (_, c) => row[c] ?? "");
        const h = Math.max(...cells.map(c => doc.heightOfString(c, { width: colW - pad * 2 }))) + pad * 2;
        if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
        const y = doc.y;
        cells.forEach((cell, c) => {
            const x = left + c * colW;
            if (ri === 0) doc.rect(x, y, colW, h).fillAndStroke("#e8e8e8", "#000000").fillColor("#000000");
            else doc.rect(x, y, colW, h).stroke();
            doc.text(cell, x + pad, y + pad, { width: colW - pad * 2 });
        });
        doc.x = left;
        doc.y = y + h;
    });
    doc.moveDown(0.5);
}

export function renderMarkdownToPdf(doc, markdown) {
    const lines = String(markdown || "").replace(/\r/g, "").split("\n");
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();

        if (t.startsWith("```")) {
            const code = [];
            i++;
            while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
            doc.font("Courier").fontSize(10).text(code.join("\n"), left, doc.y, { width });
            doc.moveDown(0.5);
            continue;
        }

        const oneLineDisplay = t.match(/^\$\$(.+)\$\$$/) || t.match(/^\\\[(.+)\\\]$/);
        if (oneLineDisplay) {
            displayMath(doc, oneLineDisplay[1]);
            continue;
        }

        if (t === "$$" || t === "\\[") {
            const closing = t === "$$" ? "$$" : "\\]";
            const block = [];
            i++;
            while (i < lines.length && lines[i].trim() !== closing) block.push(lines[i++]);
            displayMath(doc, block.join("\n"));
            continue;
        }

        if (t.startsWith("|")) {
            const rows = [];
            while (i < lines.length && lines[i].trim().startsWith("|")) {
                if (!TABLE_SEPARATOR.test(lines[i].trim())) rows.push(parseRow(lines[i]));
                i++;
            }
            i--;
            if (rows.length) drawTable(doc, rows);
            continue;
        }

        if (!t) {
            doc.moveDown(0.5);
            continue;
        }

        if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
            const y = doc.y + 4;
            doc.moveTo(left, y).lineTo(left + width, y).stroke();
            doc.y = y + 8;
            continue;
        }

        const heading = t.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            doc.moveDown(0.3);
            writeRuns(doc, inlineRuns(heading[2]), [20, 16, 14, 13, 12, 12][heading[1].length - 1], { bold: true });
            doc.moveDown(0.3);
            continue;
        }

        const bullet = t.match(/^[-*+]\s+(.*)$/);
        if (bullet) {
            writeRuns(doc, [{ text: "•  ", font: "Helvetica" }, ...inlineRuns(bullet[1])], 12, { indent: 12 });
            continue;
        }

        const numbered = t.match(/^(\d+[.)])\s+(.*)$/);
        if (numbered) {
            writeRuns(doc, [{ text: `${numbered[1]}  `, font: "Helvetica" }, ...inlineRuns(numbered[2])], 12, { indent: 12 });
            continue;
        }

        writeRuns(doc, inlineRuns(t), 12);
    }
}
