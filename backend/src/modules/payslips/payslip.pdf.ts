import PDFDocument from 'pdfkit';

export const inr = (paise: number) => {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100).toLocaleString('en-IN');
  return `${neg ? '-' : ''}INR ${rupees}.${String(abs % 100).padStart(2, '0')}`;
};

interface Line {
  name: string;
  amount: number;
}

export interface PayslipData {
  organizationName: string;
  logoText?: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  designation: string;
  periodName: string;
  periodStart: Date;
  periodEnd: Date;
  paidDays: number;
  totalDays: number;
  earnings: Line[];
  deductions: Line[];
  employerContributions: Line[];
  gross: number;
  totalDeductions: number;
  net: number;
  paymentDate?: Date;
  paymentReference?: string;
  isDemo: boolean;
}

const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: 'UTC' });

export function renderPayslip(data: PayslipData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Payslip ${data.periodName} ${data.employeeCode}`, Producer: 'Payroll Management System' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 40;
    const right = doc.page.width - 40;
    const mid = doc.page.width / 2;

    if (data.isDemo) {
      doc.save();
      doc.rotate(-35, { origin: [mid, doc.page.height / 2] });
      doc.fillColor('#cccccc').opacity(0.35).fontSize(70).font('Helvetica-Bold').text('SAMPLE - TEST DATA', 0, doc.page.height / 2 - 40, { align: 'center', width: doc.page.width });
      doc.restore();
      doc.opacity(1);
    }

    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(16).text(data.logoText || data.organizationName, left, 40);
    doc.font('Helvetica').fontSize(10).fillColor('#4b5563').text(data.organizationName, left, 60);
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#111827').text(`Payslip - ${data.periodName}`, left, 40, { align: 'right', width: right - left });
    doc.moveTo(left, 85).lineTo(right, 85).strokeColor('#d1d5db').stroke();

    const info: [string, string][] = [
      ['Employee', data.employeeName],
      ['Employee ID', data.employeeCode],
      ['Department', data.department],
      ['Designation', data.designation],
      ['Pay period', `${fmtDate(data.periodStart)} - ${fmtDate(data.periodEnd)}`],
      ['Paid days', `${data.paidDays} of ${data.totalDays}`],
    ];
    let y = 98;
    info.forEach(([k, v], i) => {
      const x = i % 2 === 0 ? left : mid + 10;
      if (i % 2 === 0 && i > 0) y += 18;
      doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(k, x, y);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(v, x + 85, y - 1, { width: mid - left - 95 });
    });
    y += 34;

    const table = (title: string, lines: Line[], total: { label: string; amount: number }, x: number, yy: number, width: number) => {
      doc.rect(x, yy, width, 20).fill('#f3f4f6');
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10).text(title, x + 6, yy + 5);
      let cy = yy + 26;
      doc.font('Helvetica').fontSize(9);
      for (const l of lines) {
        doc.fillColor('#374151').text(l.name, x + 6, cy, { width: width - 110 });
        doc.text(inr(l.amount), x + width - 100, cy, { width: 94, align: 'right' });
        cy += 16;
      }
      doc.moveTo(x, cy).lineTo(x + width, cy).strokeColor('#d1d5db').stroke();
      doc.font('Helvetica-Bold').fillColor('#111827').text(total.label, x + 6, cy + 5, { width: width - 110 });
      doc.text(inr(total.amount), x + width - 100, cy + 5, { width: 94, align: 'right' });
      return cy + 24;
    };

    const colW = (right - left - 20) / 2;
    const y1 = table('Earnings', data.earnings, { label: 'Gross earnings', amount: data.gross }, left, y, colW);
    const y2 = table('Deductions', data.deductions, { label: 'Total deductions', amount: data.totalDeductions }, left + colW + 20, y, colW);
    y = Math.max(y1, y2) + 10;

    doc.rect(left, y, right - left, 30).fill('#111827');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(12).text('Net pay', left + 10, y + 9);
    doc.text(inr(data.net), left, y + 9, { width: right - left - 10, align: 'right' });
    y += 46;

    if (data.employerContributions.length) {
      y = table('Employer contributions (not part of take-home)', data.employerContributions, { label: 'Total employer contributions', amount: data.employerContributions.reduce((a, l) => a + l.amount, 0) }, left, y, right - left);
    }

    doc.font('Helvetica').fontSize(9).fillColor('#4b5563');
    doc.text(data.paymentDate ? `Payment date: ${fmtDate(data.paymentDate)}${data.paymentReference ? `   Reference: ${data.paymentReference}` : ''}` : 'Payment details pending', left, y + 4);
    doc.fontSize(8).fillColor('#9ca3af').text('This is a system-generated payslip.', left, doc.page.height - 60, { align: 'center', width: right - left });
    doc.end();
  });
}
