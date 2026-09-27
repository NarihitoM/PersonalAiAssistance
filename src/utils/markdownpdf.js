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

function writeRuns(doc, runs, size, { bold = false, indent = 0 } = {}) {
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right - indent;
    if (runs.length === 0) return;
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
