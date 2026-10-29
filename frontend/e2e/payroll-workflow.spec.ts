import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Demo-Password-123';
const NEW_EMAIL = 'tara.nair@example.test';
const NEW_USER_PASSWORD = 'Tara-Password-2026';

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}
/** selectOption does not take a RegExp label, so resolve the option text first. */
async function pick(page: Page, label: string, match: RegExp) {
  const select = page.getByLabel(label, { exact: true });
  const text = await select.locator('option').filter({ hasText: match }).first().textContent();
  await select.selectOption({ label: text!.trim() });
}
const signOut = (page: Page) => page.getByRole('button', { name: 'Sign out' }).click().then(() => expect(page).toHaveURL(/login/));

test.describe.serial('payroll month end-to-end', () => {
  test('1-2. HR creates an employee and assigns a salary structure', async ({ page }) => {
    await signIn(page, 'hr@example.test');
    await page.goto('/employees/new');
    await page.getByLabel('First name').fill('Tara');
    await page.getByLabel('Last name').fill('Nair');
    await page.getByLabel('Work email').fill(NEW_EMAIL);
    await page.getByLabel('Joining date').fill('2026-01-05');
    await page.getByLabel('Department').selectOption({ label: 'Engineering' });
    await page.getByLabel('Designation').selectOption({ label: 'Software Engineer' });
    await page.getByLabel('Work location').fill('Bengaluru');
    await page.getByLabel('Provident Fund applies').check();
    await page.getByLabel('Professional tax applies').check();
    await page.getByLabel('Professional tax state').fill('KA');
    await page.getByRole('button', { name: 'Create employee' }).click();

    await expect(page.getByRole('heading', { name: 'Tara Nair' })).toBeVisible();
    await expect(page.getByText(/EMP000\d\d/).first()).toBeVisible();

    await page.getByRole('button', { name: 'Assign salary' }).click();
    await page.getByLabel('Salary structure', { exact: true }).selectOption({ label: 'Grade B (₹6,00,000.00 CTC)' });
    await page.getByLabel('Effective from').fill('2026-01-05');
    await page.getByLabel('Reason').fill('Joining package');
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(page.getByRole('cell', { name: '₹6,00,000.00' })).toBeVisible();
    await signOut(page);
  });

  test('1b. Administrator creates a login linked to the employee', async ({ page }) => {
    await signIn(page, 'admin@example.test');
    await page.getByRole('link', { name: 'User Management' }).click();
    await page.getByRole('button', { name: 'New user' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Tara Nair');
    await page.getByLabel('Email').fill(NEW_EMAIL);
    await page.getByLabel('Role', { exact: true }).selectOption('employee');
    await pick(page, 'Linked employee record', /Tara Nair/);
    await page.getByLabel('Initial password').fill(NEW_USER_PASSWORD);
    await page.getByRole('button', { name: 'Create user' }).click();
    await expect(page.getByText(NEW_EMAIL)).toBeVisible();
    await signOut(page);
  });

  test('3-4. Payroll period is created and inputs are entered then approved by a second person', async ({ page }) => {
    await signIn(page, 'payroll@example.test');
    await page.getByRole('link', { name: 'Payroll Processing' }).click();
    await page.getByRole('button', { name: 'New payroll period' }).click();
    await page.getByLabel('Year').fill('2026');
    await page.getByLabel('Month').fill('4');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('link', { name: 'April 2026' })).toBeVisible();
    await signOut(page);

    await signIn(page, 'hr@example.test');
    await page.getByRole('link', { name: 'Payroll Inputs' }).click();
    await pick(page, 'Employee', /Tara Nair/);
    await page.getByLabel('Type').selectOption('incentive');
    await page.getByLabel('Amount (₹)').fill('5000');
    await page.getByLabel('Description').fill('Onboarding incentive');
    await page.getByRole('button', { name: 'Add as pending' }).click();
    await expect(page.getByText('Onboarding incentive')).toBeVisible();
    // The person who entered an input cannot approve it.
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await signOut(page);

    await signIn(page, 'payroll@example.test');
    await page.getByRole('link', { name: 'Payroll Inputs' }).click();
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('row', { name: /Onboarding incentive/ }).getByText('Approved')).toBeVisible();
    await signOut(page);
  });

  test('5-6. Payroll is calculated, exceptions reviewed and submitted', async ({ page }) => {
    await signIn(page, 'payroll@example.test');
    await page.getByRole('link', { name: 'Payroll Processing' }).click();
    await page.getByRole('link', { name: 'April 2026' }).click();

    await page.getByRole('button', { name: 'Preview (simulate)' }).click();
    await expect(page.getByText(/Simulation only, nothing saved/)).toBeVisible();
    await expect(page.getByText(/TEST-ONLY/)).toBeVisible();

    await page.getByRole('button', { name: 'Calculate', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Calculate' }).click();
    await expect(page.getByText('Calculated', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Payable employees').locator('..').getByText('9')).toBeVisible();

    await page.getByRole('button', { name: /Tara Nair/ }).click();
    await expect(page.getByText('Professional Tax').first()).toBeVisible();
    await expect(page.getByText('Onboarding incentive').first()).toBeVisible();

    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText('Pending approval').first()).toBeVisible();
    // Preparer has no approval controls.
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await signOut(page);
  });

  test('7. Finance approver reviews and approves', async ({ page }) => {
    await signIn(page, 'finance@example.test');
    await page.getByRole('link', { name: 'Payroll Approvals' }).click();
    await page.getByRole('link', { name: 'April 2026' }).first().click();
    await expect(page.getByText('Net payable')).toBeVisible();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
    await signOut(page);
  });

  test('8-9. Payroll is finalised and the payment reference recorded', async ({ page }) => {
    await signIn(page, 'payroll@example.test');
    await page.getByRole('link', { name: 'Payroll Processing' }).click();
    await page.getByRole('link', { name: 'April 2026' }).click();
    await page.getByRole('button', { name: 'Finalise and generate payslips' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Finalise' }).click();
    await expect(page.getByText('Payment processing').first()).toBeVisible();
    // Finalised payroll offers no edit actions.
    await expect(page.getByRole('button', { name: /Recalculate|Calculate|Cancel batch/ })).toHaveCount(0);
    await signOut(page);

    await signIn(page, 'finance@example.test');
    await page.getByRole('link', { name: 'Payroll Approvals' }).click();
    await page.getByRole('link', { name: 'April 2026' }).first().click();
    await page.getByRole('button', { name: 'Record payment' }).click();
    await page.getByLabel('Payment reference (e.g. UTR)').fill('UTR-E2E-0001');
    await page.getByRole('button', { name: 'Record payment' }).last().click();
    await expect(page.getByText('Reconciliation pending').first()).toBeVisible();
    await signOut(page);
  });

  test('10. The employee signs in and downloads their own payslip; others are not reachable', async ({ page }) => {
    await signIn(page, NEW_EMAIL, NEW_USER_PASSWORD);
    await expect(page).toHaveURL(/my-pay/);
    await expect(page.getByRole('heading', { name: 'My pay' })).toBeVisible();
    await expect(page.getByText('Net pay · April 2026')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Payroll Processing' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Audit Logs' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Payslips' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download April 2026 payslip/ }).click()]);
    expect(download.suggestedFilename()).toMatch(/payslip-April-2026\.pdf/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).subarray(0, 4).toString()).toBe('%PDF');

    await expect(page.getByRole('row')).toHaveCount(2); // header + own payslip only

    // Direct URL access to payroll admin pages shows nothing sensitive.
    const res = await page.request.get('/api/v1/payroll/periods');
    expect(res.status()).toBe(403);
    await page.goto('/payroll');
    await expect(page.getByRole('heading', { name: 'Payroll processing' })).toBeVisible(); // route renders but data is refused
    await expect(page.getByRole('alert')).toBeVisible();
  });
});
