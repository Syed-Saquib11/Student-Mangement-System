const assert = require('assert');

const fmtLocalDate = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;

const getBillingStartDate = (admDateStr) => {
  const adm = new Date(admDateStr);
  if (isNaN(adm.getTime())) return new Date();
  return new Date(adm.getFullYear(), adm.getMonth() + 1, 1);
};

const getPeriodsElapsed = (admDateStr, today = new Date()) => {
  if (!admDateStr) return 0;
  const start = getBillingStartDate(admDateStr);
  if (isNaN(start.getTime())) return 0;
  if (today < start) return 0;
  let months = (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth());
  return Math.max(0, months + 1);
};

const calculateTotalOwed = (monthlyFee, periodsElapsed) => Number(monthlyFee || 0) * periodsElapsed;
const calculateBalance = (totalOwed, totalPaid) => Math.max(0, totalOwed - totalPaid);

const calculateMissedPeriods = (balance, monthlyFee) => {
  const fee = Number(monthlyFee);
  if (!fee || fee <= 0) return 0;
  return Math.floor(balance / fee);
};

const getFeeStatus = (missedPeriods, periodsElapsed, balance, monthlyFee) => {
  if (Number(monthlyFee) <= 0) return 'paid';
  if (periodsElapsed === 0) return 'paid';
  if (missedPeriods === 0) return 'paid';
  if (missedPeriods === 1) return 'unpaid';
  return 'overdue';
};

const getCurrentPeriodDueDate = (admDateStr, today = new Date()) => {
  const periods = getPeriodsElapsed(admDateStr, today);
  if (periods === 0) return null;
  const start = getBillingStartDate(admDateStr);
  return new Date(start.getFullYear(), start.getMonth() + (periods - 1), 1);
};

const getNextDueDate = (currentPeriodDueDate) => {
  if (!currentPeriodDueDate) return null;
  return new Date(currentPeriodDueDate.getFullYear(), currentPeriodDueDate.getMonth() + 1, 1);
};

const getNextPaymentDate = (admDateStr, today = new Date()) => {
  const start = getBillingStartDate(admDateStr);
  let nextDate;
  if (today.getDate() === 1) {
    nextDate = new Date(today.getFullYear(), today.getMonth(), 1);
  } else {
    nextDate = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  }
  return nextDate < start ? start : nextDate;
};

// Edge Case 1
let today = new Date('2023-07-20T00:00:00');
assert.strictEqual(getPeriodsElapsed('2023-07-01T00:00:00', today), 0);
assert.strictEqual(getFeeStatus(0, 0, 0, 100), 'paid');
assert.strictEqual(getCurrentPeriodDueDate('2023-07-01T00:00:00', today), null);
assert.strictEqual(fmtLocalDate(getNextPaymentDate('2023-07-01T00:00:00', today)), '2023-08-01');
console.log('Case 1 PASS');

// Edge Case 2
today = new Date('2023-07-31T00:00:00');
assert.strictEqual(getPeriodsElapsed('2023-07-15T00:00:00', today), 0);
console.log('Case 2 PASS');

// Edge Case 3
today = new Date('2023-08-01T00:00:00');
assert.strictEqual(getPeriodsElapsed('2023-07-15T00:00:00', today), 1);
assert.strictEqual(calculateTotalOwed(100, 1), 100);
assert.strictEqual(fmtLocalDate(getCurrentPeriodDueDate('2023-07-15T00:00:00', today)), '2023-08-01');
assert.strictEqual(fmtLocalDate(getNextDueDate(getCurrentPeriodDueDate('2023-07-15T00:00:00', today))), '2023-09-01');
console.log('Case 3 PASS');

// Edge Case 4
today = new Date('2023-08-15T00:00:00');
assert.strictEqual(getPeriodsElapsed('2023-07-15T00:00:00', today), 1);
assert.strictEqual(fmtLocalDate(getCurrentPeriodDueDate('2023-07-15T00:00:00', today)), '2023-08-01');
console.log('Case 4 PASS');

// Edge Case 5
today = new Date('2023-10-05T00:00:00');
assert.strictEqual(getPeriodsElapsed('2023-07-01T00:00:00', today), 3);
assert.strictEqual(calculateTotalOwed(100, 3), 300);
let bal = calculateBalance(300, 0);
let missed = calculateMissedPeriods(bal, 100);
assert.strictEqual(missed, 3);
assert.strictEqual(getFeeStatus(missed, 3, bal, 100), 'overdue');
console.log('Case 5 PASS');

// Edge Case 6
bal = calculateBalance(300, 300);
missed = calculateMissedPeriods(bal, 100);
assert.strictEqual(missed, 0);
assert.strictEqual(getFeeStatus(missed, 3, bal, 100), 'paid');
console.log('Case 6 PASS');

// Edge Case 7
bal = calculateBalance(300, 100);
missed = calculateMissedPeriods(bal, 100);
assert.strictEqual(missed, 2);
assert.strictEqual(getFeeStatus(missed, 3, bal, 100), 'overdue');
console.log('Case 7 PASS');

// Edge Case 8
today = new Date('2023-09-01T00:00:00');
assert.strictEqual(getPeriodsElapsed('2023-07-01T00:00:00', today), 2);
console.log('Case 8 PASS');

// Edge Case 9
today = new Date('2023-03-10T00:00:00');
assert.strictEqual(fmtLocalDate(getBillingStartDate('2023-01-31T00:00:00')), '2023-02-01');
assert.strictEqual(getPeriodsElapsed('2023-01-31T00:00:00', today), 2); // Feb, Mar
console.log('Case 9 PASS');

// Edge Case 10
today = new Date('2023-10-15T00:00:00');
assert.strictEqual(getPeriodsElapsed('2023-10-05T00:00:00', today), 0);
assert.strictEqual(getFeeStatus(0, 0, 0, 100), 'paid');
assert.strictEqual(getCurrentPeriodDueDate('2023-10-05T00:00:00', today), null);
console.log('Case 10 PASS');

// Edge Case 11
bal = calculateBalance(300, 400);
assert.strictEqual(bal, 0);
missed = calculateMissedPeriods(bal, 100);
assert.strictEqual(missed, 0);
console.log('Case 11 PASS');

// Edge Case 12
bal = calculateBalance(0, 0);
missed = calculateMissedPeriods(bal, 0);
assert.strictEqual(missed, 0);
assert.strictEqual(getFeeStatus(missed, 2, bal, 0), 'paid');
console.log('Case 12 PASS');

// Edge Case 13
today = new Date('2023-05-15T00:00:00');
assert.strictEqual(getPeriodsElapsed('2024-01-01T00:00:00', today), 0);
console.log('Case 13 PASS');

// Edge Case 14
today = new Date('2024-02-15T00:00:00');
assert.strictEqual(getPeriodsElapsed('2023-11-10T00:00:00', today), 3); // Dec, Jan, Feb
console.log('Case 14 PASS');

// Edge Case 15
today = new Date('2024-03-10T00:00:00');
assert.strictEqual(getPeriodsElapsed('2024-01-20T00:00:00', today), 2); // Feb, Mar
console.log('Case 15 PASS');

// Edge Case 16
today = new Date('2023-07-31T00:00:00');
assert.strictEqual(fmtLocalDate(getNextPaymentDate('2023-05-01T00:00:00', today)), '2023-08-01');
console.log('Case 16 PASS');

// Edge Case 17
today = new Date('2023-08-01T00:00:00');
assert.strictEqual(fmtLocalDate(getNextPaymentDate('2023-05-01T00:00:00', today)), '2023-08-01');
console.log('Case 17 PASS');

// Edge Case 18
today = new Date('2023-08-15T00:00:00');
assert.strictEqual(fmtLocalDate(getNextPaymentDate('2023-05-01T00:00:00', today)), '2023-09-01');
console.log('Case 18 PASS');

// Edge Case 19
today = new Date('2023-08-15T00:00:00');
assert.strictEqual(fmtLocalDate(getNextPaymentDate('2023-08-01T00:00:00', today)), '2023-09-01');
console.log('Case 19 PASS');
