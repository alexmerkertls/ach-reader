let aftFile = null;

const loadFile = () => {
  const file = document.querySelector('input#aftFile').files[0];
  const fr = new FileReader();
  fr.readAsText(file);
  fr.onload = () => {
    aftFile = parseAftFile(fr.result);
    renderAftFile(aftFile);
  }
  fr.onerror = () => {
    console.log(fr.error);
  }
}

function createEmptyRecord(recordTypeCode, line, padding) {
  const record = { line, recordTypeCode };
  const fields = getRecordDefinition(recordTypeCode);
  if (!fields) {
    console.warn(`Unknown Record Type ${recordTypeCode}, skipping...`);
    return null;
  }
  for (field of fields) {
    let value = null;
    if (field.defaultValue) value = field.defaultValue;
    if (field.required && value === null) {
      const date = new Date();
      if (field.pattern == PATTERN.ALPHANUMERIC) value = camelCaseToDelimiterCase(field.key, ' ').toUpperCase().substring(0, field.length);
      else if (field.pattern == PATTERN.NUMERIC) value = '0';
      else if (field.pattern == PATTERN.DATE) value = `${
        (date.getFullYear() % 100).toString().padStart(2, '0')}${
        (date.getMonth() + 1).toString().padStart(2, '0')}${
        date.getDate().toString().padStart(2, '0')}`;
      else if (field.pattern == PATTERN.TIME) value = `${
        date.getHours().toString().padStart(2, '0')}${
        date.getMinutes().toString().padStart(2, '0')}`;
    }
    record[field.key] = validate(field, value || '');
  }
  return record;
}

const newFile = () => {
  document.querySelector('input#aftFile').value = null;
  aftFile = [
    createEmptyRecord(RECORD_TYPE_CODES.FILE_HEADER, 0),
    createEmptyRecord(RECORD_TYPE_CODES.BATCH_HEADER, 1),
    createEmptyRecord(RECORD_TYPE_CODES.BATCH_TRAILER, 2),
    createEmptyRecord(RECORD_TYPE_CODES.FILE_TRAILER, 3),
    ...(new Array(6).fill(0).map((_, line) => createEmptyRecord(RECORD_TYPE_CODES.FILE_TRAILER, line + 4, true))),
  ];
  renderAftFile(aftFile);
}

document.querySelector('button#new').addEventListener('click', newFile);
document.querySelector('input#aftFile').addEventListener('change', loadFile);
document.querySelector('button#reload').addEventListener('click', loadFile);

document.querySelector('button#reset').addEventListener('click', () => {
  renderAftFile(aftFile);
});

document.querySelector('button#save').addEventListener('click', () => {
  const a = document.createElement('a');
  document.body.appendChild(a);
  a.style = 'display: none';
  console.log(document.querySelector('input#aftFile'));
  const fileParts = document.querySelector('input#aftFile').value.split('\\');
  let fileName = fileParts[fileParts.length - 1];
  if (fileName == '') {
    fileName = 'nafta-file.txt';
  }

  const text = writeAftFile(aftFile);
  const blob = new Blob([text], {type: 'octet/stream'});
  const url = window.URL.createObjectURL(blob);

  a.href = url;
  a.download = fileName;
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
});

const PATTERN = {
  ALPHANUMERIC: /^[A-z0-9 -:]*$/,
  NUMERIC: /^[0-9]+$/,
  DATE: /^[0-9]{6}$/,
  TIME: /^[0-9]{4}$/,
  DATE_CA: /^0[0-9]{5}$/,
};

function updateField(recordLine, recordTypeCode, key, value) {
  const input = document.querySelector(`div#record-${recordLine}>input[data-field-key="${key}"]`);
  try {
    const field = AFT_SPEC[recordTypeCode].find(f => f.key == key);
    const okValue = validate(field, value.toString());
    input.removeAttribute('data-error');
    // now we can save this value
    const record = aftFile[recordLine];
    record[key] = okValue;
    input.value = okValue; // we don't always have to do this but we should
    if (field.onChange) {
      field.onChange(aftFile, record, field);
    }
  } catch (ex) {
    console.error(`Error on line ${parseInt(recordLine) + 1}: ${ex.message}`);
    input.setAttribute('data-error', ex.message);
  }
}

function findBatchRecords(entryLine) {
  // first find the batch start
  let batchStart = null;
  for (let i = entryLine - 1; !batchStart && i > 0; i -= 1) {
    if (aftFile[i].recordTypeCode === RECORD_TYPE_CODES.BATCH_HEADER) {
      batchStart = i;
    }
  }
  // then find the batch end
  let batchEnd = null;
  for (let j = entryLine + 1; !batchEnd && j < aftFile.length; j += 1) {
    if (aftFile[j].recordTypeCode === RECORD_TYPE_CODES.BATCH_TRAILER) {
      batchEnd = j
    }
  }
  return [batchStart, batchEnd];
}

function recalculateHash(aftFile, record) {
  const [batchStart, batchEnd] = findBatchRecords(record.line);

  // collect all of the batch entries in this batch
  const entries = aftFile.slice(batchStart + 1, batchEnd).filter(rec => rec.recordTypeCode == RECORD_TYPE_CODES.ENTRY);

  // calculate batch entry hash and set value
  const batchEntryHash = entries.reduce((sum, entry) => sum + parseInt(entry.receivingDfiId), 0);
  updateField(batchEnd, RECORD_TYPE_CODES.BATCH_TRAILER, 'entryHash', batchEntryHash);

  // collect all of the batch trailers
  const batchTrailers = aftFile.filter(rec => rec.recordTypeCode == RECORD_TYPE_CODES.BATCH_TRAILER);
  const fileTrailerRecord = aftFile.find(rec => rec.recordTypeCode == RECORD_TYPE_CODES.FILE_TRAILER);

  // calculate total file entry hash and set value
  const fileEntryHash = batchTrailers.reduce((sum, trailer) => sum + parseInt(trailer.entryHash), 0);
  updateField(fileTrailerRecord.line, RECORD_TYPE_CODES.FILE_TRAILER, 'entryHash', fileEntryHash);
}

function recalculateTotals(aftFile, record) {
  const [batchStart, batchEnd] = findBatchRecords(record.line);

  // collect all of the batch entries in this batch
  const entries = aftFile.slice(batchStart + 1, batchEnd).filter(rec => rec.recordTypeCode == RECORD_TYPE_CODES.ENTRY);

  // calculate total amounts and set values
  const { c: batchTotalCredits, d: batchTotalDebits } = entries.reduce((obj, entry) => {
    const key = isCredit(entry.transactionCode) ? 'c' : 'd';
    return {
      ...obj,
      [key]: obj[key] + parseInt(entry.amount),
    };
  }, { c: 0, d: 0 });

  updateField(batchEnd, RECORD_TYPE_CODES.BATCH_TRAILER, 'totalCredits', batchTotalCredits);
  updateField(batchEnd, RECORD_TYPE_CODES.BATCH_TRAILER, 'totalDebits', batchTotalDebits);

  // collect all of the batch trailers
  const batchTrailers = aftFile.filter(rec => rec.recordTypeCode == RECORD_TYPE_CODES.BATCH_TRAILER);
  const fileTrailerRecord = aftFile.find(rec => rec.recordTypeCode == RECORD_TYPE_CODES.FILE_TRAILER);

  // calculate total file amounts and set values
  const fileTotalCredits = batchTrailers.reduce((sum, trailer) => sum + parseInt(trailer.totalCredits), 0);
  updateField(fileTrailerRecord.line, RECORD_TYPE_CODES.FILE_TRAILER, 'totalCredits', fileTotalCredits);

  const fileTotalDebits = batchTrailers.reduce((sum, trailer) => sum + parseInt(trailer.totalDebits), 0);
  updateField(fileTrailerRecord.line, RECORD_TYPE_CODES.FILE_TRAILER, 'totalDebits', fileTotalDebits);
}

function recalculateServiceClass(aftFile, record) {
  const [batchStart, batchEnd] = findBatchRecords(record.line);
  const entries = aftFile.slice(batchStart + 1, batchEnd).filter(rec => rec.recordTypeCode == RECORD_TYPE_CODES.ENTRY);

  // calculate total amounts and set values
  const { c: batchTotalCredits, d: batchTotalDebits } = entries.reduce((obj, entry) => {
    const key = isCredit(entry.transactionCode) ? 'c' : 'd';
    return {
      ...obj,
      [key]: obj[key] + 1,
    };
  }, { c: 0, d: 0 });

  let serviceClass = '200';
  if (batchTotalCredits == 0) serviceClass = '225';
  if (batchTotalDebits == 0) serviceClass = '220';

  updateField(batchStart, RECORD_TYPE_CODES.BATCH_HEADER, 'serviceClass', serviceClass);
  updateField(batchEnd, RECORD_TYPE_CODES.BATCH_TRAILER, 'serviceClass', serviceClass);
}

function updateOdfi(aftFile, record) {
  // this is the batch header being updated
  const [_, batchEnd] = findBatchRecords(record.line);
  const entries = aftFile.slice(record.line + 1, batchEnd).filter(rec => rec.recordTypeCode == RECORD_TYPE_CODES.ENTRY);
  entries.forEach((entry, index) => updateField(entry.line, entry.recordTypeCode, 'traceNumber', record.originatingDfiId + (index + 1).toString().padStart(7, '0')));
  updateField(batchEnd, RECORD_TYPE_CODES.BATCH_TRAILER, 'originatingDfiId', record.originatingDfiId);
}

function updateCompanyId(aftFile, record) {
  const [_, batchEnd] = findBatchRecords(record.line);
  updateField(batchEnd, RECORD_TYPE_CODES.BATCH_TRAILER, 'companyId', record.companyId);
}

const RECORD_TYPE_CODES = {
  FILE_HEADER: 'A',
  FILE_TRAILER: 'Z',
  CREDITS: 'C',
  DEBITS: 'D',
};

function isCredit(code) {
  const numCode = parseInt(code);
  // upon review of the below transaction codes, it seems these are the (very) strange rules
  // codes under 80, credits are X0-X4 and debits are X5-X9
  // codes above 80, credits are odd numbers and debits are even numbers
  return (code < 80 && code % 10 < 5) || (code >= 80 && code % 2 == 1);
}

const TRANSACTION_CODES = {
  '450': 'Miscellaneous Payments', // we have been asked to use this _only_ for Canadian AFT
};

const SERVICE_CLASS_CODES = {
  '200': 'Mixed Credits and Debits',
  '220': 'Credits Only',
  '225': 'Debits Only',
};

const addDays = (date, days) => {
  const date2 = new Date();
  date2.setDate(date.getDate() + days);
  date2.setHours(0);
  date2.setMinutes(0);
  date2.setSeconds(0);
  date2.setMilliseconds(0);
  return date2;
}

const FORMAT = {
  MONEY: (amount) => (`\$${parseInt(amount) / 100}`),
  DATE: (date) => {
    const { groups: { year, month, day } } = date.match(/^(?<year>\d{2})(?<month>\d{2})(?<day>\d{2})$/);
    return `${month}/${day}/20${year}`;
  },
  DATE_CA: (date) => {
    const { groups: { year, days } } = date.match(/^0(?<year>\d{2})(?<days>\d{3})$/);
    const dateObj = new Date(2000 + parseInt(year), 0);
    const actualDate = addDays(dateObj, parseInt(days));
    return `${actualDate.getMonth() + 1}/${actualDate.getDate()}/${actualDate.getFullYear()}`;
  },
  TIME: (time) => {
    let { groups: { hour, minute } } = time.match(/^(?<hour>\d{2})(?<minute>\d{2})$/);
    let ampm = 'am';
    let hourNum = parseInt(hour);
    if (hourNum > 11) {
      ampm = 'pm'
      if (hourNum > 12) {
        hour = (hourNum - 12).toString();
      }
    } else if (hourNum == 0) {
      hour = '12';
    }
    return `${hour}:${minute} ${ampm}`;
  }
};

const required = true;
const static = true;
const segment = true;
const filler = true;

const AFT_SPEC = {
  [RECORD_TYPE_CODES.FILE_HEADER]: [ // updated for Canada
    { key: 'logicalRecordCount', name: 'Logical Record Count', length: 9, pattern: /^000000001$/, static, defaultValue: '000000001' },
    { key: 'originatorId', name: 'Originator\'s ID', length: 10, pattern: PATTERN.ALPHANUMERIC, required },
    { key: 'fileCreationNumber', name: 'File Creation No.', length: 4, pattern: PATTERN.NUMERIC, required },
    { key: 'creationDate', name: 'Creation Date', length: 6, pattern: PATTERN.DATE_CA, required, format: FORMAT.DATE_CA },
    { key: 'destinationDataCentre', name: 'Destination Data Centre', length: 5, pattern: PATTERN.NUMERIC, required },
    { key: 'dcCommunicationArea', name: 'Reserved Customer - Direct Clearer Communication Area', length: 20, pattern: PATTERN.ALPHANUMERIC },
    { key: 'currencyCode', name: 'Currency Code Identifier', length: 3, pattern: PATTERN.ALPHANUMERIC, required, defaultValue: 'CAD' },
    { key: 'padding', filler, limit: 1464 },
  ],
  [RECORD_TYPE_CODES.FILE_TRAILER]: [ // updated for Canada
    { key: 'logicalRecordCount', name: 'Logical Record Count', length: 9, pattern: PATTERN.NUMERIC, static },
    { key: 'originationControlData', name: 'Origination Control Data', length: 14, pattern: PATTERN.ALPHANUMERIC, required },
    { key: 'totalDebitAmount', name: 'Total Value of Debit Transactions "D" and "J"', length: 14, pattern: PATTERN.NUMERIC, static, format: FORMAT.MONEY },
    { key: 'totalDebitCount', name: 'Total Number of Debit Transactions "D" and "J"', length: 8, pattern: PATTERN.NUMERIC, static },
    { key: 'totalCreditAmount', name: 'Total Value of Credit Transactions "C" and "I"', length: 14, pattern: PATTERN.NUMERIC, static, format: FORMAT.MONEY },
    { key: 'totalCreditCount', name: 'Total Number of Credit Transactions "C" and "I"', length: 8, pattern: PATTERN.NUMERIC, static },
    { key: 'totalDebitErrorAmount', name: 'Total Value of Error Corrections "E" (debits)', length: 14, pattern: PATTERN.NUMERIC, static, format: FORMAT.MONEY },
    { key: 'totalDebitErrorCount', name: 'Total Number of Error Corrections "E" (debits)', length: 8, pattern: PATTERN.NUMERIC, static },
    { key: 'totalCreditErrorAmount', name: 'Total Value of Error Corrections "F" (credits)', length: 14, pattern: PATTERN.NUMERIC, static, format: FORMAT.MONEY },
    { key: 'totalCreditErrorCount', name: 'Total Number of Error Corrections "F" (credits)', length: 8, pattern: PATTERN.NUMERIC, static },
    { key: 'padding', filler, limit: 1464 },
  ],
  [RECORD_TYPE_CODES.CREDITS]: [
    { key: 'logicalRecordCount', name: 'Logical Record Count', length: 9, pattern: PATTERN.NUMERIC, static },
    { key: 'originationControlData', name: 'Origination Control Data', length: 14, pattern: PATTERN.ALPHANUMERIC, required },
    { segment, limit: 6, definition: [
      { key: 'transactionType', name: 'Transaction Type', length: 3, pattern: PATTERN.NUMERIC, required, context: TRANSACTION_CODES, defaultValue: '450' },
      { key: 'amount', name: 'Amount', length: 10, pattern: PATTERN.NUMERIC, required, format: FORMAT.MONEY },
      { key: 'effectiveDate', name: 'Date Funds to be Availble', length: 6, pattern: PATTERN.DATE_CA, required, format: FORMAT.DATE_CA },
      { key: 'institutionId', name: 'Institutional Identification No.', length: 9, pattern: PATTERN.NUMERIC, required },
      { key: 'payeeAccountNumber', name: 'Payee Account No.', length: 12, pattern: PATTERN.ALPHANUMERIC, required },
      { key: 'itemTraceNumber', name: 'Item Trace No.', length: 22, pattern: PATTERN.NUMERIC, required },
      { key: 'storedTransactionType', name: 'Stored Transaction Type', length: 3, pattern: PATTERN.NUMERIC, required, defaultValue: '000' },
      { key: 'originatorShortname', name: 'Originator\'s Short Name', length: 15, pattern: PATTERN.ALPHANUMERIC, required },
      { key: 'payeeName', name: 'Payee Name', length: 30, pattern: PATTERN.ALPHANUMERIC, required },
      { key: 'originatorLongname', name: 'Originator\'s Long Name', length: 30, pattern: PATTERN.ALPHANUMERIC, required },
      { key: 'originatingDcUserId', name: 'Originating Direct Clearer\'s User\' ID', length: 10, pattern: PATTERN.ALPHANUMERIC, required },
      { key: 'originatorCrossRefNumber', name: 'Originator\'s Cross Reference No.', length: 19, pattern: PATTERN.ALPHANUMERIC, required },
      { key: 'institutionIdForReturns', name: 'Institutional ID Number for Returns', length: 9, pattern: PATTERN.NUMERIC, required },
      { key: 'accountNumberForReturns', name: 'Account Number for Returns', length: 12, pattern: PATTERN.ALPHANUMERIC, required },
      { key: 'originatorSundryInfo', name: 'Originator\'s Sundry Information', length: 15, pattern: PATTERN.ALPHANUMERIC, required },
      { key: 'filler', name: 'Filler', length: 22, static, pattern: /^ {22}$/, required, defaultValue: new Array(22).fill(' ').join('') },
      { key: 'originatorDcSettlementCode', name: 'Originator-Direct Clearer Settlement Code', length: 2, pattern: PATTERN.ALPHANUMERIC, required },
      { key: 'invalidDataElementId', name: 'Invalid Data Element I.D.', length: 2, pattern: PATTERN.NUMERIC, required },
    ]},
    { key: 'padding', filler, limit: 1464 },
  ],
  [RECORD_TYPE_CODES.DEBITS]: [
    { key: 'logicalRecordCount', name: 'Logical Record Count', length: 9, pattern: PATTERN.NUMERIC, static },
    { key: 'originationControlData', name: 'Origination Control Data', length: 14, pattern: PATTERN.ALPHANUMERIC, required },
    { segment, limit: 6, definition: [
      { key: 'transactionType', name: 'Transaction Type', length: 3, pattern: PATTERN.NUMERIC, required, context: TRANSACTION_CODES, defaultValue: '450' },
      { key: 'amount', name: 'Amount', length: 10, pattern: PATTERN.NUMERIC, required, format: FORMAT.MONEY },
      { key: 'dueDate', name: 'Due Date', length: 6, pattern: PATTERN.DATE_CA, required, format: FORMAT.DATE_CA },
      { key: 'institutionId', name: 'Institutional Identification No.', length: 9, pattern: PATTERN.NUMERIC, required },
      { key: 'payorAccountNumber', name: 'Payor Account No.', length: 12, pattern: PATTERN.ALPHANUMERIC, required },
      { key: 'itemTraceNumber', name: 'Item Trace No.', length: 22, pattern: PATTERN.NUMERIC, required },
      { key: 'storedTransactionType', name: 'Stored Transaction Type', length: 3, pattern: PATTERN.NUMERIC, required, defaultValue: '000' },
      { key: 'originatorShortname', name: 'Originator\'s Short Name', length: 15, pattern: PATTERN.ALPHANUMERIC, required },
      { key: 'payorName', name: 'Payor Name', length: 30, pattern: PATTERN.ALPHANUMERIC, required },
      { key: 'originatorLongname', name: 'Originator\'s Long Name', length: 30, pattern: PATTERN.ALPHANUMERIC, required },
      { key: 'originatingDcUserId', name: 'Originating Direct Clearer\'s User\' ID', length: 10, pattern: PATTERN.ALPHANUMERIC, required },
      { key: 'originatorCrossRefNumber', name: 'Originator\'s Cross Reference No.', length: 19, pattern: PATTERN.ALPHANUMERIC, required },
      { key: 'institutionIdForReturns', name: 'Institutional ID Number for Returns', length: 9, pattern: PATTERN.NUMERIC, required },
      { key: 'accountNumberForReturns', name: 'Account Number for Returns', length: 12, pattern: PATTERN.ALPHANUMERIC, required },
      { key: 'originatorSundryInfo', name: 'Originator\'s Sundry Information', length: 15, pattern: PATTERN.ALPHANUMERIC, required },
      { key: 'filler', name: 'Filler', length: 22, static, pattern: /^ {22}$/, required, defaultValue: new Array(22).fill(' ').join('') },
      { key: 'originatorDcSettlementCode', name: 'Originator-Direct Clearer Settlement Code', length: 2, pattern: PATTERN.ALPHANUMERIC, required },
      { key: 'invalidDataElementId', name: 'Invalid Data Element I.D.', length: 2, pattern: PATTERN.NUMERIC, required },
    ]},
    { key: 'padding', filler, limit: 1464 },
  ],
};

function validate(field, value, forcePad = false) {
  if (field.required && value.match(/^ *$/)) {
    throw new Error(`"${field.name}" is required.`);
  }
  if (value.length > field.length) {
    throw new Error(`"${field.name}" must be ${field.length} character${field.length == 1 ? '' : 's'} long.`);
  }
  if (!value.match(/^ *$/) && field.pattern && !value.match(field.pattern)) {
    throw new Error(`"${field.name}" does not match the regex pattern ${field.pattern}`);
  }
  if (field.pattern == PATTERN.ALPHANUMERIC) return value.padEnd(field.length, ' ');
  if ((field.required || field.static || forcePad) && field.pattern == PATTERN.NUMERIC) return value.padStart(field.length, '0');
  if (forcePad) return value.padEnd(field.length, ' ');
  return value;
}

function getRecordDefinition(recordTypeCode) {
  let fields = AFT_SPEC[recordTypeCode];
  return fields;
}

function parseAftFile(contents) {
  const lines = contents.split('\r').join('').split('\n'); // make sure to remove carriage returns (\r)
  return lines.filter(x => x).map((line, index) => {
    const recordTypeCode = line.substring(0, 1);
    const record = { line: index, recordTypeCode };
    const fields = getRecordDefinition(recordTypeCode);
    if (!fields) {
      console.warn(`Unknown Record Type ${recordTypeCode}, skipping...`);
      return null;
    }
    let pos = 1;
    let lineLength = line.length;
    for (field of fields) {
      const { key, length, filler, limit, segment, definition } = field;
      if (segment) {
        record.parts = [];
        while(pos < lineLength && record.parts.length < limit) {
          const subRecord = {};
          for (subfield of definition) {
            subRecord[subfield.key] = line.substring(pos, pos + subfield.length);
            pos += subfield.length;
          }
          record.parts.push(subRecord);
        }
      } else if (filler) {
        record.padding = ' '.repeat(limit - pos);
        pos = limit;
      } else {
        record[key] = line.substring(pos, pos + length);
        pos += length;
      }
    }
    return record;
  }).filter(x => x); // get rid of null lines
}

function writeAftFile(aftFile) {
  return aftFile.map((record) => {
    const fields = getRecordDefinition(record.recordTypeCode);
    return [ 
      record.recordTypeCode,
      ...fields.map((field) => validate(field, record[field.key], true))
    ].join('');
  }).join('\n');
}

function onFieldFocus(evt) {
  const input = evt.target;
  if (input.nodeName == 'INPUT') {
    const { recordLine, fieldKey } = extractAttributes(input, ['data-record-line', 'data-field-key']);
    const lineNum = parseInt(recordLine);
    const record = aftFile.find(rec => rec.line === lineNum);
    if (record) {
      const field = getRecordDefinition(record.recordTypeCode).find(fld => fld.key === fieldKey);
      if (field.pattern == PATTERN.ALPHANUMERIC) input.value = input.value.trim();
      if ((input.value != null && input.value != '') && field.pattern == PATTERN.NUMERIC) input.value = parseInt(input.value).toString();
    }
    evt.stopPropagation();
  }
}

function onFieldChange(evt) {
  const input = evt.target;
  if (input.nodeName == 'INPUT') {
    const previous = input.value;
    const { recordLine, fieldKey } = extractAttributes(input, ['data-record-line', 'data-field-key']);
    const lineNum = parseInt(recordLine);
    const record = aftFile.find(rec => rec.line === lineNum);
    if (record) {
      // validate data based on pattern
      const field = getRecordDefinition(record.recordTypeCode).find(fld => fld.key === fieldKey);
      updateField(record.line, record.recordTypeCode, fieldKey, input.value);
    }
    evt.stopPropagation();
  } 
}

function onFieldBlur(evt) {
  const input = evt.target;
  if (input.nodeName == 'INPUT') {
    const { recordLine, fieldKey } = extractAttributes(input, ['data-record-line', 'data-field-key']);
    const lineNum = parseInt(recordLine);
    const record = aftFile.find(rec => rec.line === lineNum);
    if (record) {
      const field = getRecordDefinition(record.recordTypeCode).find(fld => fld.key === fieldKey);
      if (field.pattern == PATTERN.ALPHANUMERIC) input.value = input.value.padEnd(field.length, ' ');
      if ((input.value != null && input.value != '') && field.pattern == PATTERN.NUMERIC) input.value = input.value.padStart(field.length, '0');
    }
    evt.stopPropagation();
  }
}

const TRANCODE_ACCOUNT = {
  'checking': '2',
  'savings': '3',
  'general ledger': '4',
  'loan account': '5',
};

const getTrancodeType = (type, accountType) => {
  // 'credit': '2',
  // 'debit': '7',
  if (type == 'credit') {
    return '2';
  }
  if (type == 'debit') {
    if (accountType == 'loan account') {
      return '5'; // reversals only
    }
    return '7';
  }
  return '?';
};

function parseAndLoadTransactions(text, batchStartLine) {
  const lines = text.split('\r').join('').split('\n').slice(1); // make sure to remove carriage returns (\r)
  const fields = AFT_SPEC[RECORD_TYPE_CODES.ENTRY];
  const transactions = lines.map((line, index) => {
    const [
      type,
      idNumber,
      amountText,
      routingNumber,
      dfiAcctNumber,
      accountType,
      institutionName,
    ] = line.split(',');
    const transactionCode = `${TRANCODE_ACCOUNT[accountType]}${getTrancodeType(type, accountType)}`
    const receivingDfiId = routingNumber.substring(0, 8);
    const checkDigit = routingNumber.substring(8, 9);
    const receivingName = institutionName.substring(0, 22);
    const amount = Math.round(parseFloat(amountText) * 100).toString();
    const odfi = aftFile[batchStartLine].originatingDfiId;
    return {
      recordTypeCode: RECORD_TYPE_CODES.ENTRY,
      transactionCode,
      receivingDfiId,
      checkDigit,
      dfiAcctNumber,
      amount,
      idNumber,
      receivingName,
      discData: '',
      addendaRecordId: '0',
      traceNumber: `${odfi}${(index + 1).toString().padStart(7, '0')}`,
    };
  });
  aftFile = aftFile.filter(r => !r.padding); // remove padding
  aftFile.splice(batchStartLine + 1, 0, ...transactions);
  // re-number lines
  aftFile.forEach((record, index) => record.line = index);
  const batchEnd = batchStartLine + transactions.length + 1;
  const fileEnd = aftFile.length - 1;
  while (aftFile.length % 10 > 0) {
    // add padding
    aftFile.push(createEmptyRecord(RECORD_TYPE_CODES.FILE_TRAILER, aftFile.length, true));
  }
  renderAftFile(aftFile);
  updateField(batchEnd, RECORD_TYPE_CODES.BATCH_TRAILER, 'entryCount', transactions.length.toString());
  updateField(fileEnd, RECORD_TYPE_CODES.FILE_TRAILER, 'blockCount', Math.ceil(aftFile.length / 10).toString());
  updateField(fileEnd, RECORD_TYPE_CODES.FILE_TRAILER, 'entryCount', transactions.length.toString());
}

function loadAftTransactions(batchStartLine) {
  const fileElement = createElementFromHTML(`<input type="file" style="display: none;" />`);
  document.body.appendChild(fileElement);
  fileElement.addEventListener('change', () => {
    const file = fileElement.files[0];
    const fr = new FileReader();
    fr.readAsText(file);
    fr.onload = () => {
      parseAndLoadTransactions(fr.result, batchStartLine);
    }
    fr.onerror = () => {
      console.log(fr.error);
    }
  });
  fileElement.click();
  document.body.removeChild(fileElement);
}

function onClick(evt) {
  const button = evt.target;
  if (button.nodeName == 'BUTTON') {
    // handle
    const { recordLine, recordType } = extractAttributes(button, ['data-record-line', 'data-record-type']);
    switch(recordType) {
      case RECORD_TYPE_CODES.ENTRY:
        console.log('heyyyy');
        break;
      case RECORD_TYPE_CODES.BATCH_HEADER:
        loadAftTransactions(parseInt(recordLine));
        break;
      case RECORD_TYPE_CODES.BATCH_TRAILER:
        console.log('heyyyy');
        break;
      case RECORD_TYPE_CODES.FILE_TRAILER:
        console.log('heyyyy');
        break;
    }
    console.log(recordLine, recordType);
    evt.stopPropagation();
  }
}

function showTooltip(evt) {
  const input = evt.target;
  if (input.nodeName == 'INPUT') {
    const tooltip = document.querySelector('div#tooltip');
    const { top, height } = input.getBoundingClientRect();
    const { name, fieldLength, error, fieldKey, recordType } = extractAttributes(input, ['data-name', 'data-field-length', 'data-error', 'data-field-key', 'data-record-type']);
    if (name) {
      const field = AFT_SPEC[recordType].find(f => f.key == fieldKey);
      tooltip.style.visibility = 'visible';
      tooltip.style.background = error ? '#fcc' : '#ffb';
      tooltip.style.left = evt.x;
      tooltip.style.top = top + height + 1; // for the outline
      if (fieldKey == 'padding') {
        tooltip.innerHTML = 'FILE PADDING';
      } else if (fieldKey == 'recordTypeCode') {
        tooltip.innerHTML = Object.keys(RECORD_TYPE_CODES).find(k => RECORD_TYPE_CODES[k] == recordType).toString().replace('_', ' ');
      } else {
        tooltip.innerHTML = `
          <div>
            ${name} (${fieldLength} char${fieldLength == 1 ? '' : 's'})
          </div>
          <div>
            ${input.value}
            ${field.context ? `= ${field.context[input.value]}` : ''}
            ${!input.value.trim().match(/^ *$/) && field.format ? `= ${field.format(input.value)}` : ''}
          </div>
          ${error ? `<div>${error}</div>` : ''}
        `;
      }
    } else {
      tooltip.style.visibility = 'hidden';
    }
  } else {
    tooltip.style.visibility = 'hidden';
  }
}

function renderAftFile(aftFile) {
  document.querySelector('div#contents').innerHTML = '';

  const container = document.createElement('div');
  aftFile.forEach((record) => {
    const fields = getRecordDefinition(record.recordTypeCode);
    const row = createElementFromHTML(`
      <div
        id="record-${record.line}"
        data-record-type="${record.recordTypeCode}"
        class="row"
      >
      </div>
    `);
    row.appendChild(renderField(record, { name: 'Record Type Code', length: 1, static, key: 'recordTypeCode' }, { value: record.recordTypeCode }));
    fields.forEach((field) => {
      const value = record[field.key];
      const input = renderField(record, field, { value });
      row.appendChild(input);
    });
    let button = null;
    switch (record.recordTypeCode) {
        case RECORD_TYPE_CODES.ENTRY:
          // button = '&plus; Addendum';
          break;
        case RECORD_TYPE_CODES.FILE_TRAILER:
          // if (!record.padding) button = '&plus; Batch';
          break;
    }
    if (button) {
      const buttonElement = createElementFromHTML(`
        <button 
          id="action-${record.line}"
          data-record-line="${record.line}"
          data-record-type="${record.recordTypeCode}"
        >
         ${button}
        </button>
      `);
      row.appendChild(buttonElement);
    }
    container.appendChild(row);
  });

  container.addEventListener('click', onClick, true);
  container.addEventListener('change', onFieldChange, true);
  container.addEventListener('focus', onFieldFocus, true);
  container.addEventListener('blur', onFieldBlur, true);
  document.body.addEventListener('mousemove', showTooltip, true);

  document.querySelector('div#contents').appendChild(container);

  // validate all fields
  aftFile.filter(r => !r.padding).forEach((record) => {
    const fields = getRecordDefinition(record.recordTypeCode);
    fields.forEach((field) => {
      const value = record[field.key];
      updateField(record.line, record.recordTypeCode, field.key, value);
    });
  });
}
const CHAR_WIDTH = 12;

function renderAttributes(attrs = {}) {
  return Object.entries(attrs).map(([key, value]) => `${camelCaseToDelimiterCase(key)}="${value}"`).join('\n');
}

function renderField(record, field, attrs = {}) {
  const { length, static, name, key, required } = field;
  return createElementFromHTML(`
    <input
      type="text"
      style="width: ${ CHAR_WIDTH * length }px"
      ${static ? 'readonly' : ''}
      ${required ? 'required' : ''}
      data-name="${name}"
      data-record-type="${record.recordTypeCode}"
      data-field-length="${length}"
      data-record-line="${record.line}"
      data-field-key="${key}"
      ${renderAttributes(attrs)}
    />`);
}

function createElementFromHTML(htmlString) {
  var div = document.createElement('div');
  div.innerHTML = htmlString.replace(/ /g, ' ').trim();
  const child = div.childNodes[0];
  div.removeChild(child);
  return child;
}

function extractAttributes(element, attributes, preserveDataPrefix = false) {
  return attributes.reduce((obj, attribute) => {
    const attrName = preserveDataPrefix ? attribute : attribute.replace('data-', '');
    return {
      ...obj,
      [delimiterCaseToCamelCase(attrName)]: element.getAttribute(attribute),
    };
  }, {});
}

function delimiterCaseToCamelCase(str, delimiter = '-') {
  return str.split(delimiter).map((s, i) => i === 0 ? s : s.substring(0, 1).toUpperCase() + s.substring(1)).join('');
}

function camelCaseToDelimiterCase(str, delimiter = '-') {
  return str.replace(/[A-Z]/g, c => `${delimiter}${c.toLowerCase()}`);
}