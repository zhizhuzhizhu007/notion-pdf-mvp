import { jsPDF } from 'jspdf';
import type { NotionBlock, NotionPageContent } from './notionTypes';

const MARGIN = 56;
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FONT = 'helvetica';

export function generatePdf(page: NotionPageContent): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = MARGIN;

  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_HEIGHT - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  // Title
  doc.setFont(FONT, 'bold');
  doc.setFontSize(22);
  doc.setTextColor(30, 30, 30);
  const titleLines = doc.splitTextToSize(page.title, CONTENT_WIDTH) as string[];
  titleLines.forEach((line) => {
    ensureSpace(30);
    doc.text(line, MARGIN, y);
    y += 28;
  });

  // Meta line
  doc.setFont(FONT, 'normal');
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 120);
  ensureSpace(18);
  doc.text(`Exported from Notion PDF  ·  Last edited ${page.lastEdited}`, MARGIN, y);
  y += 24;

  // Divider
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.75);
  ensureSpace(12);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y += 28;

  const renderBlock = (block: NotionBlock) => {
    switch (block.type) {
      case 'heading': {
        doc.setFont(FONT, 'bold');
        doc.setFontSize(14);
        doc.setTextColor(20, 20, 20);
        const lines = doc.splitTextToSize(block.text ?? '', CONTENT_WIDTH) as string[];
        lines.forEach((line) => {
          ensureSpace(22);
          doc.text(line, MARGIN, y);
          y += 19;
        });
        y += 6;
        break;
      }
      case 'paragraph': {
        doc.setFont(FONT, 'normal');
        doc.setFontSize(11);
        doc.setTextColor(45, 45, 45);
        const lines = doc.splitTextToSize(block.text ?? '', CONTENT_WIDTH) as string[];
        lines.forEach((line) => {
          ensureSpace(17);
          doc.text(line, MARGIN, y);
          y += 16;
        });
        y += 10;
        break;
      }
      case 'bullets': {
        doc.setFont(FONT, 'normal');
        doc.setFontSize(11);
        doc.setTextColor(45, 45, 45);
        block.items?.forEach((item) => {
          const itemLines = doc.splitTextToSize(item, CONTENT_WIDTH - 18) as string[];
          itemLines.forEach((line, i) => {
            ensureSpace(17);
            if (i === 0) {
              doc.text('•', MARGIN, y);
            }
            doc.text(line, MARGIN + 18, y);
            y += 16;
          });
        });
        y += 10;
        break;
      }
      case 'table': {
        const table = block.table;
        if (!table) break;
        const colCount = table.headers.length;
        const colWidth = CONTENT_WIDTH / colCount;
        const rowHeight = 22;

        const drawRow = (cells: string[], isHeader: boolean, rowIdx: number) => {
          ensureSpace(rowHeight);
          if (isHeader) {
            doc.setFillColor(245, 245, 245);
            doc.rect(MARGIN, y - 15, CONTENT_WIDTH, rowHeight, 'F');
          } else if (rowIdx % 2 === 0) {
            doc.setFillColor(250, 250, 250);
            doc.rect(MARGIN, y - 15, CONTENT_WIDTH, rowHeight, 'F');
          }
          doc.setFont(FONT, isHeader ? 'bold' : 'normal');
          doc.setFontSize(10);
          doc.setTextColor(50, 50, 50);
          cells.forEach((cell, ci) => {
            const cellLines = doc.splitTextToSize(cell, colWidth - 12) as string[];
            doc.text(cellLines[0] ?? '', MARGIN + ci * colWidth + 6, y);
          });
          y += rowHeight;
        };

        drawRow(table.headers, true, 0);
        table.rows.forEach((row, ri) => drawRow(row, false, ri + 1));

        // Table border
        doc.setDrawColor(210, 210, 210);
        doc.setLineWidth(0.5);
        doc.rect(MARGIN, y - rowHeight * (table.rows.length + 1) - 15 + 15, CONTENT_WIDTH, rowHeight * (table.rows.length + 1));
        // Column dividers
        for (let ci = 1; ci < colCount; ci++) {
          doc.line(MARGIN + ci * colWidth, y - rowHeight * (table.rows.length + 1), MARGIN + ci * colWidth, y);
        }
        // Row dividers
        for (let ri = 1; ri <= table.rows.length + 1; ri++) {
          doc.line(MARGIN, y - ri * rowHeight, PAGE_WIDTH - MARGIN, y - ri * rowHeight);
        }
        y += 14;
        break;
      }
    }
  };

  page.blocks.forEach(renderBlock);

  // Page numbers
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(160, 160, 160);
    doc.text(`${i} / ${pageCount}`, PAGE_WIDTH / 2, PAGE_HEIGHT - 28, { align: 'center' });
  }

  doc.save(`${page.title.replace(/\s+/g, '-').toLowerCase()}.pdf`);
}
