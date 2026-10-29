import { Router, type Request, type Response } from 'express';
import PDFDocument from 'pdfkit';
import { stringify } from 'csv-stringify/sync';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authenticate, orgId, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, objectId, validate } from '../../middleware/common.js';
import { audit } from '../audit/audit.service.js';
import { Employee } from '../employees/employee.model.js';
import { Organization } from '../organizations/organization.model.js';
import { PayrollEntry, PayrollPeriod } from '../payroll/payroll.model.js';
import { LOCKED } from '../payroll/state-machine.js';
import { financialYearOf } from '../payslips/self.routes.js';
import { inr } from '../payslips/payslip.pdf.js';

export const reportsRouter = Router();
reportsRouter.use(authenticate, requirePermission('report:view'));

const filters = z.object({
  fy: z.coerce.number().int().min(2000).max(2100).optional(),
  periodId: objectId.optional(),
  departmentId: objectId.optional(),
  location: z.string().max(100).optional(),
  format: z.enum(['json', 'csv', 'pdf']).default('json'),
});
type Filters = z.infer<typeof filters>;

/** Approved-or-later periods matching the financial-year / period filter. */
async function periodsFor(req: Request, f: Filters) {
  const org = await Organization.findById(orgId(req), { financialYearStartMonth: 1 }).lean();
  const start = org?.financialYearStartMonth ?? 4;
  const q: Record<string, unknown> = { organizationId: orgId(req), status: { $in: LOCKED } };
  if (f.periodId) q._id = new Types.ObjectId(f.periodId);
  const all = await PayrollPeriod.find(q).sort({ year: 1, month: 1 }).lean();
  return all.filter((p) => f.fy == null || financialYearOf(p.year, p.month, start) === f.fy);
}

const entryMatch = (req: Request, f: Filters, periodIds: Types.ObjectId[]) => ({
  organizationId: orgId(req),
  periodId: { $in: periodIds },
  payable: true,
  ...(f.departmentId ? { 'snapshot.departmentId': new Types.ObjectId(f.departmentId) } : {}),
  ...(f.location ? { 'snapshot.workLocation': f.location } : {}),
});

async function respond(req: Request, res: Response, name: string, f: Filters, rows: Record<string, string | number>[]) {
  if (f.format === 'json') return void res.json({ data: rows });
  await audit(req, { action: 'report.export', entityType: 'Report', entityId: name, summary: { format: f.format, rows: rows.length, filters: { fy: f.fy, periodId: f.periodId, departmentId: f.departmentId, location: f.location } } });
  if (f.format === 'csv') return void res.type('text/csv').attachment(`${name}.csv`).send(stringify(rows, { header: true }));
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
  res.type('application/pdf').attachment(`${name}.pdf`);
  doc.pipe(res);
  doc.font('Helvetica-Bold').fontSize(14).text(name.replace(/-/g, ' ').toUpperCase());
  doc.moveDown(0.5).font('Helvetica').fontSize(8);
  const cols = Object.keys(rows[0] ?? { note: '' });
  const w = (doc.page.width - 72) / cols.length;
  const line = (cells: string[], bold = false) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
    cells.forEach((c, i) => doc.text(c, 36 + i * w, y, { width: w - 4, lineBreak: false, ellipsis: true }));
    doc.y = y + 14;
    if (doc.y > doc.page.height - 50) doc.addPage();
  };
  line(cols, true);
  for (const r of rows) line(cols.map((c) => (String(c).toLowerCase().includes('paise') ? inr(Number(r[c])) : String(r[c] ?? ''))));
  doc.end();
}

reportsRouter.get('/payroll-summary', validate({ query: filters }), asyncHandler(async (req, res) => {
  const f = req.query as unknown as Filters;
  const periods = await periodsFor(req, f);
  const agg = await PayrollEntry.aggregate([
    { $match: entryMatch(req, f, periods.map((p) => p._id)) },
    { $group: { _id: '$periodId', headcount: { $sum: 1 }, gross: { $sum: '$grossEarnings' }, deductions: { $sum: '$totalEmployeeDeductions' }, net: { $sum: '$netPay' }, employerContributions: { $sum: '$totalEmployerContributions' }, employerCost: { $sum: '$employerCost' } } },
  ]);
  const byId = new Map(agg.map((a) => [a._id.toString(), a]));
  const rows = periods.map((p, i) => {
    const a = byId.get(p._id.toString());
    const prev = i > 0 ? byId.get(periods[i - 1]!._id.toString()) : undefined;
    const cost = a?.employerCost ?? 0;
    return { period: p.name, status: p.status, headcount: a?.headcount ?? 0, grossPaise: a?.gross ?? 0, deductionsPaise: a?.deductions ?? 0, netPaise: a?.net ?? 0, employerContributionsPaise: a?.employerContributions ?? 0, employerCostPaise: cost, momChangePaise: prev ? cost - prev.employerCost : 0 };
  });
  await respond(req, res, 'payroll-summary', f, rows);
}));

reportsRouter.get('/department-costs', validate({ query: filters }), asyncHandler(async (req, res) => {
  const f = req.query as unknown as Filters;
  const periods = await periodsFor(req, f);
  const agg = await PayrollEntry.aggregate([
    { $match: entryMatch(req, f, periods.map((p) => p._id)) },
    { $group: { _id: '$snapshot.departmentName', headcount: { $addToSet: '$employeeId' }, gross: { $sum: '$grossEarnings' }, net: { $sum: '$netPay' }, employerCost: { $sum: '$employerCost' }, minNet: { $min: '$netPay' }, maxNet: { $max: '$netPay' }, avgNet: { $avg: '$netPay' } } },
    { $sort: { _id: 1 } },
  ]);
  await respond(req, res, 'department-costs', f, agg.map((a) => ({ department: a._id ?? 'Unassigned', headcount: a.headcount.length, grossPaise: a.gross, netPaise: a.net, employerCostPaise: a.employerCost, minNetPaise: a.minNet, avgNetPaise: Math.round(a.avgNet), maxNetPaise: a.maxNet })));
}));

reportsRouter.get('/deductions', validate({ query: filters }), asyncHandler(async (req, res) => {
  const f = req.query as unknown as Filters;
  const periods = await periodsFor(req, f);
  const agg = await PayrollEntry.aggregate([
    { $match: entryMatch(req, f, periods.map((p) => p._id)) },
    { $unwind: '$employeeDeductions' },
    { $group: { _id: '$employeeDeductions.code', name: { $first: '$employeeDeductions.name' }, total: { $sum: '$employeeDeductions.amount' }, employees: { $addToSet: '$employeeId' } } },
    { $sort: { total: -1 } },
  ]);
  await respond(req, res, 'deductions', f, agg.map((a) => ({ code: a._id, name: a.name, employees: a.employees.length, totalPaise: a.total })));
}));

reportsRouter.get('/headcount', validate({ query: filters.pick({ departmentId: true, location: true, format: true }) }), asyncHandler(async (req, res) => {
  const f = req.query as unknown as Filters;
  const match: Record<string, unknown> = { organizationId: orgId(req), ...(f.departmentId ? { departmentId: new Types.ObjectId(f.departmentId) } : {}), ...(f.location ? { workLocation: f.location } : {}) };
  const agg = await Employee.aggregate([
    { $match: match },
    { $lookup: { from: 'departments', localField: 'departmentId', foreignField: '_id', as: 'd' } },
    { $group: { _id: { department: { $first: '$d.name' }, status: '$status' }, count: { $sum: 1 } } },
    { $sort: { '_id.department': 1 } },
  ]);
  await respond(req, res, 'headcount', f, agg.map((a) => ({ department: a._id.department ?? 'Unassigned', status: a._id.status, headcount: a.count })));
}));

/** Dashboard cards: status mix, pending approvals and exception counts. */
reportsRouter.get('/dashboard', validate({ query: filters.pick({ fy: true }) }), asyncHandler(async (req, res) => {
  const [statusMix, pending, exceptions, headcount] = await Promise.all([
    PayrollPeriod.aggregate([{ $match: { organizationId: orgId(req) } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    PayrollPeriod.find({ organizationId: orgId(req), status: 'pending_approval' }, { name: 1, totals: 1 }).lean(),
    PayrollPeriod.aggregate([{ $match: { organizationId: orgId(req), status: { $in: ['calculated', 'pending_approval', 'rejected'] } } }, { $group: { _id: null, n: { $sum: '$totals.exceptionCount' } } }]),
    Employee.countDocuments({ organizationId: orgId(req), status: { $ne: 'inactive' } }),
  ]);
  res.json({ data: { statusMix: statusMix.map((s) => ({ status: s._id, count: s.count })), pendingApprovals: pending, openExceptions: exceptions[0]?.n ?? 0, headcount } });
}));
