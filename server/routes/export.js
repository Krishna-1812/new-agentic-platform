const express = require('express');
const router = express.Router();
const {
  Document, Packer, Table, TableRow, TableCell, Paragraph, TextRun,
  WidthType, HeightRule, ShadingType, AlignmentType, VerticalAlign,
  BorderStyle
} = require('docx');

const NAVY_DARK = '1E3A5F';
const NAVY_MID = '2E5F8A';
const GREY_LIGHT = 'F5F5F5';

function makeCell({ text, bold = false, italic = false, color = '000000', bgColor = 'FFFFFF', width, colspan, verticalAlign = VerticalAlign.CENTER }) {
  const cell = new TableCell({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [
          new TextRun({
            text: text || '',
            bold,
            italics: italic,
            color,
            size: 20
          })
        ]
      })
    ],
    shading: { fill: bgColor, type: ShadingType.SOLID, color: 'auto' },
    margins: { top: 100, bottom: 100, left: 150, right: 150 },
    verticalAlign,
    ...(width ? { width: { size: width, type: WidthType.PERCENTAGE } } : {}),
    ...(colspan ? { columnSpan: colspan } : {})
  });
  return cell;
}

router.post('/docx', async (req, res) => {
  const { keyword, analysis } = req.body;

  if (!keyword || !analysis || !analysis.sections) {
    return res.status(400).json({ error: 'keyword and analysis are required.' });
  }

  try {
    const { sections, wordCountBenchmark, semanticKeywords, contentGaps } = analysis;

    // --- Title row (spans all 3 columns) ---
    const titleRow = new TableRow({
      children: [
        new TableCell({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: `CONTENT ANALYSIS REPORT: ${keyword.toUpperCase()} (Based on Competitor Research)`,
                  bold: true,
                  color: 'FFFFFF',
                  size: 24
                })
              ]
            })
          ],
          columnSpan: 3,
          shading: { fill: NAVY_DARK, type: ShadingType.SOLID, color: 'auto' },
          margins: { top: 160, bottom: 160, left: 200, right: 200 },
          verticalAlign: VerticalAlign.CENTER
        })
      ],
      height: { value: 700, rule: HeightRule.ATLEAST }
    });

    // --- Header row ---
    const headerRow = new TableRow({
      children: [
        makeCell({ text: 'Section', bold: true, color: 'FFFFFF', bgColor: NAVY_MID, width: 20 }),
        makeCell({ text: 'Recommendations', bold: true, color: 'FFFFFF', bgColor: NAVY_MID, width: 30 }),
        makeCell({ text: 'Content', bold: true, color: 'FFFFFF', bgColor: NAVY_MID, width: 50 })
      ],
      height: { value: 500, rule: HeightRule.ATLEAST }
    });

    // --- Data rows ---
    const dataRows = sections.map(section => {
      const bullets = Array.isArray(section.recommendations) ? section.recommendations : [];
      const recCell = new TableCell({
        children: bullets.length > 0
          ? bullets.map(point => new Paragraph({
              bullet: { level: 0 },
              children: [new TextRun({ text: point, size: 20 })]
            }))
          : [new Paragraph({ children: [new TextRun({ text: '—', size: 20 })] })],
        shading: { fill: 'FFFFFF', type: ShadingType.SOLID, color: 'auto' },
        margins: { top: 100, bottom: 100, left: 150, right: 150 },
        verticalAlign: VerticalAlign.TOP,
        width: { size: 30, type: WidthType.PERCENTAGE }
      });

      return new TableRow({
        children: [
          makeCell({ text: `H2: ${section.h2}`, bold: true, bgColor: 'FFFFFF', width: 20, verticalAlign: VerticalAlign.TOP }),
          recCell,
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: '' })] })],
            shading: { fill: GREY_LIGHT, type: ShadingType.SOLID, color: 'auto' },
            margins: { top: 100, bottom: 100, left: 150, right: 150 },
            verticalAlign: VerticalAlign.TOP,
            width: { size: 50, type: WidthType.PERCENTAGE }
          })
        ],
        height: { value: 1400, rule: HeightRule.ATLEAST }
      });
    });

    // --- Metadata section ---
    const metaRows = [
      new TableRow({
        children: [
          new TableCell({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: 'CONTENT METADATA', bold: true, color: 'FFFFFF', size: 22 })]
              })
            ],
            columnSpan: 3,
            shading: { fill: NAVY_DARK, type: ShadingType.SOLID, color: 'auto' },
            margins: { top: 120, bottom: 120, left: 200, right: 200 }
          })
        ],
        height: { value: 600, rule: HeightRule.ATLEAST }
      }),
      new TableRow({
        children: [
          makeCell({ text: `Word Count Benchmark: ${wordCountBenchmark?.toLocaleString() || 'N/A'} words`, bold: true, bgColor: 'FFFFFF', width: 33 }),
          makeCell({ text: `Semantic Keywords: ${(semanticKeywords || []).join(', ')}`, bgColor: 'FFFFFF', width: 33 }),
          makeCell({ text: `Content Gaps: ${(contentGaps || []).map((g, i) => `${i + 1}. ${g}`).join('  |  ')}`, bgColor: GREY_LIGHT, italic: true, width: 34 })
        ],
        height: { value: 800, rule: HeightRule.ATLEAST }
      })
    ];

    const table = new Table({
      rows: [titleRow, headerRow, ...dataRows, ...metaRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
        left: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
        right: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
        insideH: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
        insideV: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' }
      }
    });

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: { top: 720, bottom: 720, left: 720, right: 720 }
            }
          },
          children: [table]
        }
      ]
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `${keyword.replace(/[^a-zA-Z0-9]/g, '_')}_content_analysis.docx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[export/docx] Error:', err.message);
    res.status(500).json({ error: `Failed to generate Word document: ${err.message}` });
  }
});

module.exports = router;
