import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";

const origin = (process.argv[2] || "http://127.0.0.1:18080").replace(/\/$/, "");

function pdfWithText(text) {
  const words = text.split(/\s+/);
  const lines = [];
  for (let index = 0; index < words.length; index += 9)
    lines.push(
      words
        .slice(index, index + 9)
        .join(" ")
        .replace(/([\\()])/g, "\\$1"),
    );
  const stream = `BT /F1 10 Tf 40 760 Td ${lines
    .map((line, index) => `${index ? "0 -14 Td " : ""}(${line}) Tj`)
    .join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

const health = await fetch(`${origin}/health`);
assert.equal(health.status, 200);

const description = Array.from(
  { length: 35 },
  () => "international shipping logistics customs clearance supply chain operations",
).join(" ");
const pdf = pdfWithText(
  `Amina Rahman amina.rahman@example.com +971 50 123 4567 8 years of experience ${description}`,
);
const response = await fetch(`${origin}/v1/extract`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    fileName: "Amina_Rahman_CV.pdf",
    mimeType: "application/pdf",
    contentBase64: pdf.toString("base64"),
  }),
});
const responseText = await response.text();
assert.equal(response.status, 200, responseText);
const result = JSON.parse(responseText);
assert.equal(result.documentRoute, "Searchable PDF");
assert.equal(result.fields.email, "amina.rahman@example.com");
assert.equal(result.fields.yearsOfExperience, 8);
assert.ok(result.fields.skills.includes("customs clearance"));
assert.ok(!result.semanticText.toLowerCase().includes("amina.rahman@example.com"));
const wordText = "Sandro Pascolo sandro@example.com 12 years of engineering experience";
const wordDocument = zipSync({
  "[Content_Types].xml": strToU8(
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  ),
  "_rels/.rels": strToU8(
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  ),
  "word/document.xml": strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${wordText}</w:t></w:r></w:p></w:body></w:document>`,
  ),
});
const previewResponse = await fetch(`${origin}/v1/preview`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    fileName: "Sandro_Pascolo_CV.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    contentBase64: Buffer.from(wordDocument).toString("base64"),
  }),
});
const previewBody = await previewResponse.text();
assert.equal(previewResponse.status, 200, previewBody);
assert.ok(JSON.parse(previewBody).text.includes(wordText));
const semanticResponse = await fetch(`${origin}/v1/similarity`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    vacancyText: "Freight forwarding and international logistics operations manager",
    candidateText: "Led global shipping, customs clearance and supply chain operations",
  }),
});
const semantic = await semanticResponse.json();
assert.equal(semanticResponse.status, 200);
assert.ok(semantic.score >= 40 && semantic.score <= 100);
process.stdout.write(
  "CV extraction, Word preview, OCR service health and semantic matching passed.\n",
);
