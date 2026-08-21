const fs = require('fs');
const path = require('path');
const pdfModule = require('pdf-parse');
const mammoth = require('mammoth');

/**
 * Robust helper to parse PDF text across different module export formats
 */
async function parsePdfBuffer(dataBuffer) {
  if (typeof pdfModule === 'function') {
    const pdfData = await pdfModule(dataBuffer);
    return { text: pdfData.text || '', pageCount: pdfData.numpages || 1 };
  } else if (typeof pdfModule?.default === 'function') {
    const pdfData = await pdfModule.default(dataBuffer);
    return { text: pdfData.text || '', pageCount: pdfData.numpages || 1 };
  } else if (pdfModule?.PDFParse) {
    const parser = new pdfModule.PDFParse({ data: dataBuffer });
    const textData = await parser.getText();
    const info = await parser.getInfo().catch(() => ({}));
    return { text: textData.text || '', pageCount: textData.total || info?.total || 1 };
  } else {
    // Basic regex stream fallback for text inside PDF streams
    const text = dataBuffer.toString('utf8').replace(/[^\x20-\x7E\n\r\t]/g, ' ');
    return { text, pageCount: 1 };
  }
}

/**
 * Extracts raw text and metadata from a PDF or DOCX file.
 * @param {string} filePath - Absolute path to file on disk
 * @param {string} mimeType - File mime type or extension
 * @returns {Promise<{ text: string, wordCount: number, pageCount?: number }>}
 */
async function extractTextFromDocument(filePath, mimeType) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  let text = '';
  let pageCount = 1;

  if (ext === '.pdf' || mimeType === 'application/pdf') {
    const dataBuffer = fs.readFileSync(filePath);
    const pdfResult = await parsePdfBuffer(dataBuffer);
    text = pdfResult.text || '';
    pageCount = pdfResult.pageCount || 1;
  } else if (ext === '.docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ path: filePath });
    text = result.value || '';
  } else if (ext === '.txt') {
    text = fs.readFileSync(filePath, 'utf8');
  } else {
    throw new Error(`Unsupported file type: ${ext}`);
  }

  // Clean up whitespace
  text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  if (!text || text.length < 20) {
    throw new Error('Extracted text is empty or too short. Please upload a readable document with text content.');
  }

  const words = text.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  return {
    text,
    wordCount,
    pageCount
  };
}

module.exports = {
  extractTextFromDocument
};
