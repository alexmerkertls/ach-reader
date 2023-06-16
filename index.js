let achFile = null;

const loadFile = () => {
  const file = document.querySelector('input#achFile').files[0];
  const fr = new FileReader();
  fr.readAsText(file);
  fr.onload = () => {
    achFile = parseAchFile(fr.result);
    renderAchFile(achFile);
  }
  fr.onerror = () => {
    console.log(fr.error);
  }
}

function createEmptyRecord(recordTypeCode, line, padding) {
  const record = { line, recordTypeCode };
  const fields = getRecordDefinition(recordTypeCode, padding);
  if (!fields) {
    console.warn(`Unknown Record Type ${recordTypeCode}, skipping...`);
    return null;
  }
  for (field of fields) {
    let value = null;
    if (field.defaultValue) value = field.defaultValue;
    if (field.required && !value) {
      const date = new Date();
      if (field.pattern == PATTERN.ALPHANUMERIC) value = camelCaseToDelimiterCase(field.key, ' ').toUpperCase().substring(0, field.length);
      else if (field.pattern == PATTERN.NUMERIC) value = '0';
      else if (field.pattern == PATTERN.DATE) value = `${
        (date.getFullYear() % 100).toString().padStart(2, '0')}${
        (date.getMonth() + 1).toString().padStart(2, '0')}${
        date.getDate().toString().padStart(2, '0')}`;
      else if (field.pattern == PATTERN.TIME) value = `${
        date.getHour().toString().padStart(2, '0')}${
        date.getMinute().toString().padStart(2, '0')}`;
    }
    record[field.key] = validate(field, value || '');
  }
  return record;
}

const newFile = () => {
  achFile = [
    createEmptyRecord(RECORD_TYPE_CODES.FILE_HEADER, 0),
    createEmptyRecord(RECORD_TYPE_CODES.BATCH_HEADER, 1),
    createEmptyRecord(RECORD_TYPE_CODES.BATCH_TRAILER, 2),
    createEmptyRecord(RECORD_TYPE_CODES.FILE_TRAILER, 3),
    ...(new Array(7).fill(0).map((_, line) => createEmptyRecord(RECORD_TYPE_CODES.FILE_TRAILER, line + 4, true))),
  ];
  renderAchFile(achFile);
}

document.querySelector('button#new').addEventListener('click', newFile);
document.querySelector('input#achFile').addEventListener('change', loadFile);
document.querySelector('button#reload').addEventListener('click', loadFile);

document.querySelector('button#reset').addEventListener('click', () => {
  renderAchFile(achFile);
});

document.querySelector('button#save').addEventListener('click', () => {
  const a = document.createElement('a');
  document.body.appendChild(a);
  a.style = 'display: none';
  console.log(document.querySelector('input#achFile'));
  const fileParts = document.querySelector('input#achFile').value.split('\\');
  let fileName = fileParts[fileParts.length - 1];
  if (fileName == '') {
    fileName = 'nacha-file.txt';
  }

  const text = writeAchFile(achFile);
  const blob = new Blob([text], {type: 'octet/stream'});
  const url = window.URL.createObjectURL(blob);

  a.href = url;
  a.download = fileName;
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
});

const PATTERN = {
  ALPHANUMERIC: /^[A-z0-9 ]*$/,
  NUMERIC: /^[0-9]+$/,
  DATE: /^[0-9]{6}$/,
  TIME: /^[0-9]{4}$/,
};

function updateField(recordLine, recordTypeCode, key, value) {
  const input = document.querySelector(`div#record-${recordLine}>input[data-field-key="${key}"]`);
  try {
    const field = ACH_SPEC[recordTypeCode].find(f => f.key == key);
    const okValue = validate(field, value.toString());
    input.removeAttribute('data-error');
    // now we can save this value
    const record = achFile[recordLine];
    record[key] = okValue;
    input.value = okValue; // we don't always have to do this but we should
    if (field.onChange) {
      field.onChange(achFile, record, field);
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
    if (achFile[i].recordTypeCode === RECORD_TYPE_CODES.BATCH_HEADER) {
      batchStart = i;
    }
  }
  // then find the batch end
  let batchEnd = null;
  for (let j = entryLine + 1; !batchEnd && j < achFile.length; j += 1) {
    if (achFile[j].recordTypeCode === RECORD_TYPE_CODES.BATCH_TRAILER) {
      batchEnd = j
    }
  }
  return [batchStart, batchEnd];
}

function recalculateHash(achFile, record) {
  const [batchStart, batchEnd] = findBatchRecords(record.line);

  // collect all of the batch entries in this batch
  const entries = achFile.slice(batchStart + 1, batchEnd).filter(rec => rec.recordTypeCode == RECORD_TYPE_CODES.ENTRY);

  // calculate batch entry hash and set value
  const batchEntryHash = entries.reduce((sum, entry) => sum + parseInt(entry.receivingDfiId), 0);
  updateField(batchEnd, RECORD_TYPE_CODES.BATCH_TRAILER, 'entryHash', batchEntryHash);

  // collect all of the batch trailers
  const batchTrailers = achFile.filter(rec => rec.recordTypeCode == RECORD_TYPE_CODES.BATCH_TRAILER);
  const fileTrailerRecord = achFile.find(rec => rec.recordTypeCode == RECORD_TYPE_CODES.FILE_TRAILER);

  // calculate total file entry hash and set value
  const fileEntryHash = batchTrailers.reduce((sum, trailer) => sum + parseInt(trailer.entryHash), 0);
  updateField(fileTrailerRecord.line, RECORD_TYPE_CODES.FILE_TRAILER, 'entryHash', fileEntryHash);
}

function recalculateTotals(achFile, record) {
  const [batchStart, batchEnd] = findBatchRecords(record.line);

  // collect all of the batch entries in this batch
  const entries = achFile.slice(batchStart + 1, batchEnd).filter(rec => rec.recordTypeCode == RECORD_TYPE_CODES.ENTRY);

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
  const batchTrailers = achFile.filter(rec => rec.recordTypeCode == RECORD_TYPE_CODES.BATCH_TRAILER);
  const fileTrailerRecord = achFile.find(rec => rec.recordTypeCode == RECORD_TYPE_CODES.FILE_TRAILER);

  // calculate total file amounts and set values
  const fileTotalCredits = batchTrailers.reduce((sum, trailer) => sum + parseInt(trailer.totalCredits), 0);
  updateField(fileTrailerRecord.line, RECORD_TYPE_CODES.FILE_TRAILER, 'totalCredits', fileTotalCredits);

  const fileTotalDebits = batchTrailers.reduce((sum, trailer) => sum + parseInt(trailer.totalDebits), 0);
  updateField(fileTrailerRecord.line, RECORD_TYPE_CODES.FILE_TRAILER, 'totalDebits', fileTotalDebits);
}

function recalculateServiceClass(achFile, record) {
  const [batchStart, batchEnd] = findBatchRecords(record.line);
  const entries = achFile.slice(batchStart + 1, batchEnd).filter(rec => rec.recordTypeCode == RECORD_TYPE_CODES.ENTRY);

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

function updateOdfi(achFile, record) {
  // this is the batch header being updated
  const [_, batchEnd] = findBatchRecords(record.line);
  const entries = achFile.slice(record.line + 1, batchEnd).filter(rec => rec.recordTypeCode == RECORD_TYPE_CODES.ENTRY);
  entries.forEach((entry, index) => updateField(entry.line, entry.recordTypeCode, 'traceNumber', record.originatingDfiId + index.toString().padStart(7, '0')));
  updateField(batchEnd, RECORD_TYPE_CODES.BATCH_TRAILER, 'originatingDfiId', record.originatingDfiId);
}

function updateCompanyId(achFile, record) {
  const [_, batchEnd] = findBatchRecords(record.line);
  updateField(batchEnd, RECORD_TYPE_CODES.BATCH_TRAILER, 'companyId', record.companyId);
}

const RECORD_TYPE_CODES = {
  FILE_HEADER: '1',
  FILE_TRAILER: '9',
  BATCH_HEADER: '5',
  BATCH_TRAILER: '8',
  ENTRY: '6',
  ADDENDUM: '7',
};

function isCredit(code) {
  const numCode = parseInt(code);
  // upon review of the below transaction codes, it seems these are the (very) strange rules
  // codes under 80, credits are X0-X4 and debits are X5-X9
  // codes above 80, credits are odd numbers and debits are even numbers
  return (code < 80 && code % 10 < 5) || (code >= 80 && code % 2 == 1);
}

const TRANSACTION_CODES = {
  // Demand Credit Records (for checking, NOW, and share draft accounts)
  '20': 'Reserved',
  '21': 'Return or Notification of Change for original Transaction Code 22, 23, or 24',
  '22': 'Demand Credit',
  '23': 'Prenotification of Demand Credit; Death Notification (non-dollar); Automated Enrollment Entry (non-dollar)',
  '24': 'Zero dollar with remittance data (for CCD, CTX, and IAT Entries only); Acknowledgment Entries (ACK and ATX Entries only)',
  // Demand Debit Records (for checking, NOW, and share draft accounts)
  '25': 'Reserved',
  '26': 'Return or Notification of Change for original Transaction Code 27, 28, or 29',
  '27': 'Demand Debit',
  '28': 'Prenotification of Demand Debit (non-dollar)',
  '29': 'Zero dollar with remittance data (for CCD, CTX, and IAT Entries only)',
  // Savings Account Credit Records
  '30': 'Reserved',
  '31': 'Return or Notification of Change for original Transaction Code 32, 33, or 34',
  '32': 'Savings Credit',
  '33': 'Prenotification of Savings Credit; Death Notification (non-dollar); Automated Enrollment Entry (non-dollar)',
  '34': 'Zero dollar with remittance data (for CCD, CTX, and IAT Entries only); Acknowledgment Entries (ACK and ATX Entries only)',
  // Savings Account Debit Records
  '35': 'Reserved',
  '36': 'Return or Notification of Change for original Transaction Code 37, 38, or 39',
  '37': 'Savings Debit',
  '38': 'Prenotification of Savings Debit (non-dollar)',
  '39': 'Zero dollar with remittance data (for CCD, CTX, and IAT Entries only)',
  // Financial Institution General Ledger Credit Records
  '41': 'Return or Notification of Change for original Transaction Code 42, 43, or 44',
  '42': 'General Ledger Credit',
  '43': 'Prenotification of General Ledger Credit (non-dollar)',
  '44': 'Zero dollar with remittance data (for CCD and CTX Entries only)',
  // Financial Institution General Ledger Debit Records
  '46': 'Return or Notification of Change for original Transaction Code 47, 48, or 49',
  '47': 'General Ledger Debit',
  '48': 'Prenotification of General Ledger Debit (non-dollar)',
  '49': 'Zero dollar with remittance data (for CCD and CTX only)',
  // Loan Account Credit Records
  '51': 'Return or Notification of Change for original Transaction Code 52, 53, or 54',
  '52': 'Loan Account Credit',
  '53': 'Prenotification of Loan Account Credit (non-dollar)',
  '54': 'Zero dollar with remittance data (for CCD and CTX Entries only)',
  // Loan Account Debit Records (for Reversals Only)
  '55': 'Loan Account Debit (Reversals Only)',
  '56': 'Return or Notification of Change for original Transaction Code 55',
  // Accounting Records (for use in ADV Files only)
  // These Transaction Codes represent accounting Entries.
  '81': 'Credit for ACH debits originated',
  '82': 'Debit for ACH credits originated',
  '83': 'Credit for ACH credits received',
  '84': 'Debit for ACH debits received',
  '85': 'Credit for ACH credits in Rejected batches',
  '86': 'Debit for ACH debits in Rejected batches',
  '87': 'Summary credit for respondent ACH activity',
  '88': 'Summary debit for respondent ACH activity',
};

const SERVICE_CLASS_CODES = {
  '200': 'Mixed Credits and Debits',
  '220': 'Credits Only',
  '225': 'Debits Only',
};

const FORMAT = {
  MONEY: (amount) => (`\$${parseInt(amount) / 100}`),
  DATE: (date) => {
    const { groups: { year, month, day } } = date.match(/^(?<year>\d{2})(?<month>\d{2})(?<day>\d{2})$/);
    return `${month}/${day}/20${year}`;
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

const ACH_SPEC = {
  [RECORD_TYPE_CODES.FILE_HEADER]: [
    { key: 'priorityCode', name: 'Priority Code', length: 2, pattern: /^01$/, static: true, defaultValue: '01' },
    { key: 'destinationSpace', name: 'Space prefix for Immediate Destination', length: 1, pattern: /^ $/, static: true, defaultValue: ' ' },
    { key: 'destination', name: 'Immediate Destination', length: 9, pattern: PATTERN.NUMERIC, required: true },
    { key: 'originSpace', name: 'Space prefix for Immediate Origin', length: 1, pattern: /^ $/, static: true, defaultValue: ' ' },
    { key: 'origin', name: 'Immediate Origin', length: 9, pattern: PATTERN.NUMERIC, required: true },
    { key: 'creationDate', name: 'File Creation Date', length: 6, pattern: PATTERN.DATE, required: true, format: FORMAT.DATE },
    { key: 'creationTime', name: 'File Creation Time', length: 4, pattern: PATTERN.TIME, format: FORMAT.TIME },
    { key: 'idModifier', name: 'File ID Modifier', length: 1, pattern: PATTERN.ALPHANUMERIC, required: true, defaultValue: '0' }, 
    { key: 'recordSize', name: 'Record Size', length: 3, pattern: /^094$/, static: true, defaultValue: '094' },
    { key: 'blockingFactor', name: 'Blocking Factor', length: 2, pattern: /^10$/, static: true, defaultValue: '10' },
    { key: 'formatCode', name: 'Format Code', length: 1, pattern: /^1$/, static: true, defaultValue: '1' },
    { key: 'destinationName', name: 'Immediate Destination Name', length: 23, pattern: PATTERN.ALPHANUMERIC },
    { key: 'originName', name: 'Immediate Origin Name', length: 23, pattern: PATTERN.ALPHANUMERIC },
    { key: 'referenceCode', name: 'Reference Code', length: 8, pattern: PATTERN.ALPHANUMERIC },
  ],
  [RECORD_TYPE_CODES.FILE_TRAILER]: [
    { key: 'batchCount', name: 'Batch Count', length: 6, pattern: PATTERN.NUMERIC, static: true, defaultValue: '1' },
    { key: 'blockCount', name: 'Block Count', length: 6, pattern: PATTERN.NUMERIC, static: true, defaultValue: '1' },
    { key: 'entryCount', name: 'Entry/Addenda Count', length: 8, pattern: PATTERN.NUMERIC, static: true, defaultValue: '0' },
    { key: 'entryHash', name: 'Entry Hash', length: 10, pattern: PATTERN.NUMERIC, static: true },
    { key: 'totalDebits', name: 'Total Debit Entry Dollar Amount in File', length: 12, pattern: PATTERN.NUMERIC, static: true, format: FORMAT.MONEY },
    { key: 'totalCredits', name: 'Total Credit Entry Dollar Amount in File', length: 12, pattern: PATTERN.NUMERIC, static: true, format: FORMAT.MONEY },
    { key: 'reserved', name: 'Reserved', length: 39, pattern: /^ {39}$/, static: true, defaultValue: new Array(39).fill(' ').join('') },
  ],
  [RECORD_TYPE_CODES.BATCH_HEADER]: [
    { key: 'serviceClass', name: 'Service Class Code', length: 3, pattern: PATTERN.NUMERIC, static: true, context: SERVICE_CLASS_CODES },
    { key: 'companyName', name: 'Company Name', length: 16, pattern: PATTERN.ALPHANUMERIC, required: true },
    { key: 'companyDiscData', name: 'Company Discretionary Data', length: 20, pattern: PATTERN.ALPHANUMERIC },
    { key: 'companyId', name: 'Company Identification', length: 10, pattern: PATTERN.ALPHANUMERIC, required: true, onChange: updateCompanyId },
    { key: 'standardEntryClass', name: 'Standard Entry Class Code', length: 3, pattern: PATTERN.ALPHANUMERIC, required: true },
    { key: 'companyEntryDesc', name: 'Company Entry Description', length: 10, pattern: PATTERN.ALPHANUMERIC, required: true },
    { key: 'companyDescDate', name: 'Company Entry Description', length: 6, pattern: PATTERN.ALPHANUMERIC },
    { key: 'effectiveEntryDate', name: 'Effective Entry Date', length: 6, pattern: PATTERN.DATE, format: FORMAT.DATE },
    { key: 'settlementDate', name: 'Settlement Date', length: 3, pattern: /^\d{3}$/ },
    { key: 'originatorStatus', name: 'Originator Status Code', length: 1, pattern: PATTERN.ALPHANUMERIC },
    { key: 'originatingDfiId', name: 'Originating DFI Identification', length: 8, pattern: PATTERN.NUMERIC, onChange: updateOdfi },
    { key: 'batchNumber', name: 'Batch Number', length: 7, pattern: PATTERN.NUMERIC, static: true, defaultValue: '1' },
  ],
  [RECORD_TYPE_CODES.BATCH_TRAILER]: [
    { key: 'serviceClass', name: 'Service Class Code', length: 3, pattern: PATTERN.NUMERIC, static: true, context: SERVICE_CLASS_CODES },
    { key: 'entryCount', name: 'Entry/Addenda Count', length: 6, pattern: PATTERN.NUMERIC, static: true },
    { key: 'entryHash', name: 'Entry Hash', length: 10, pattern: PATTERN.NUMERIC, static: true },
    { key: 'totalDebits', name: 'Total Debit Entry Dollar Amount', length: 12, pattern: PATTERN.NUMERIC, static: true, format: FORMAT.MONEY },
    { key: 'totalCredits', name: 'Total Credit Entry Dollar Amount', length: 12, pattern: PATTERN.NUMERIC, static: true, format: FORMAT.MONEY },
    { key: 'companyId', name: 'Company Identification', length: 10, pattern: PATTERN.ALPHANUMERIC, static: true },
    { key: 'messageAuthCode', name: 'Message Authentication Code', length: 19 , pattern: PATTERN.NUMERIC },
    { key: 'reserved', name: 'Reserved', length: 6, pattern: /$ {6}$/, static: true },
    { key: 'originatingDfiId', name: 'Originating DFI Identification', length: 8, pattern: PATTERN.NUMERIC, static: true },
    { key: 'batchNumber', name: 'Batch Number', length: 7, pattern: PATTERN.NUMERIC, static: true, defaultValue: '1' },
  ],
  [RECORD_TYPE_CODES.ENTRY] : [ // CCD and PPD entries (WEB and TEL are very similar)
    { key: 'transactionCode', name: 'Transaction Code', length: 2, pattern: PATTERN.NUMERIC, required: true, context: TRANSACTION_CODES, onChange: recalculateServiceClass },
    { key: 'receivingDfiId', name: 'Receiving DFI Identification', length: 8, pattern: PATTERN.NUMERIC, required: true, onChange: recalculateHash },
    { key: 'checkDigit', name: 'Check Digit', length: 1, pattern: PATTERN.NUMERIC, required: true },
    { key: 'dfiAcctNumber', name: 'DFI Account Number', length: 17, pattern: PATTERN.ALPHANUMERIC, required: true },
    { key: 'amount', name: 'Amount', length: 10, pattern: PATTERN.NUMERIC, required: true, onChange: recalculateTotals, format: FORMAT.MONEY },
    { key: 'idNumber', name: 'Identification Number', length: 15, pattern: PATTERN.ALPHANUMERIC },
    { key: 'receivingName', name: 'Receiving Individual/Company Name', length: 22, pattern: PATTERN.ALPHANUMERIC, required: true },
    { key: 'discData', name: 'Discretionary Data', length: 2, pattern: PATTERN.ALPHANUMERIC }, // could also be payment type code
    { key: 'addendaRecordId', name: 'Addenda Record Indicator', length: 1, pattern: PATTERN.NUMERIC, required: true },
    { key: 'traceNumber', name: 'Trace Number', length: 15, pattern: PATTERN.NUMERIC, static: true, defaultValue: '1' },
  ],
  [RECORD_TYPE_CODES.ADDENDUM] : [
    { key: 'addendaType', name: 'Addenda Type Code', length: 2, pattern: /^05$/, static: true, defaultValue: '05' },
    { key: 'paymentRelatedInfo', name: 'Payment Related Information', length: 80, pattern: PATTERN.ALPHANUMERIC },
    { key: 'addendaSeqNumber', name: 'Addenda Sequence Number', length: 4, pattern: PATTERN.NUMERIC, static: true },
    { key: 'entrySeqNumber', name: 'Entry Detail Sequence Number', length: 7, pattern: PATTERN.NUMERIC, static: true },
  ],
  'padding': [
    { key: 'padding', name: 'Padding', length: 93, static: true, pattern: /^9{93}$/, required: true, defaultValue: new Array(93).fill('9').join('') },
  ],
};

function validate(field, value) {
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
  if (field.pattern == PATTERN.NUMERIC) return value.padStart(field.length, '0');
  return value;
}

function getRecordDefinition(recordTypeCode, padding) {
  let fields = ACH_SPEC[recordTypeCode];
  if (padding) {
    fields = ACH_SPEC['padding'];
  }
  return fields;
}

function parseAchFile(contents) {
  const lines = contents.split('\r').join('').split('\n'); // make sure to remove carriage returns (\r)
  return lines.filter(x => x).map((line, index) => {
    const recordTypeCode = line.substring(0, 1);
    const record = { line: index, recordTypeCode };
    const fields = getRecordDefinition(recordTypeCode, line.match(/^9*$/));
    if (!fields) {
      console.warn(`Unknown Record Type ${recordTypeCode}, skipping...`);
      return null;
    }
    let pos = 1;
    for (field of fields) {
      record[field.key] = line.substring(pos, pos + field.length);
      pos += field.length;
    }
    return record;
  }).filter(x => x); // get rid of null lines
}

function writeAchFile(achFile) {
  return achFile.map((record) => {
    const fields = getRecordDefinition(record.recordTypeCode, record.padding);
    const text = [ 
      record.recordTypeCode,
      ...fields.map((field) => record[field.key])
    ].join('');
  }).join('\n');
}

function onFieldFocus(evt) {
  const input = evt.target;
  if (input.nodeName == 'INPUT') {
    const { recordLine, fieldKey } = extractAttributes(input, ['data-record-line', 'data-field-key']);
    const lineNum = parseInt(recordLine);
    const record = achFile.find(rec => rec.line === lineNum);
    if (record) {
      const field = getRecordDefinition(record.recordTypeCode, record.padding).find(fld => fld.key === fieldKey);
      if (field.pattern == PATTERN.ALPHANUMERIC) input.value = input.value.trim();
      if (field.pattern == PATTERN.NUMERIC) input.value = parseInt(input.value).toString();
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
    const record = achFile.find(rec => rec.line === lineNum);
    if (record) {
      // validate data based on pattern
      const field = getRecordDefinition(record.recordTypeCode, record.padding).find(fld => fld.key === fieldKey);
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
    const record = achFile.find(rec => rec.line === lineNum);
    if (record) {
      const field = getRecordDefinition(record.recordTypeCode, record.padding).find(fld => fld.key === fieldKey);
      if (field.pattern == PATTERN.ALPHANUMERIC) input.value = input.value.padEnd(field.length, ' ');
      if (field.pattern == PATTERN.NUMERIC) input.value = input.value.padStart(field.length, '0');
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
  const fields = ACH_SPEC[RECORD_TYPE_CODES.ENTRY];
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
    const amount = (parseInt(amountText) * 100).toString();
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
      traceNumber: `${receivingDfiId}${(index + 1).toString().padStart(7, '0')}`,
    };
  });
  achFile.splice(batchStartLine + 1, 0, ...transactions);
  // re-number lines
  achFile.forEach((record, index) => record.line = index);
  const batchEnd = batchStartLine + transactions.length + 1;
  renderAchFile(achFile);
  updateField(batchEnd, RECORD_TYPE_CODES.BATCH_TRAILER, 'entryCount', transactions.length.toString());
  updateField(achFile.length - 8, RECORD_TYPE_CODES.FILE_TRAILER, 'blockCount', Math.floor(achFile.length / 10).toString());
}

function loadAchTransactions(batchStartLine) {
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
        loadAchTransactions(parseInt(recordLine));
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
      const field = ACH_SPEC[recordType].find(f => f.key == fieldKey);
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

function renderAchFile(achFile) {
  document.querySelector('div#contents').innerHTML = '';

  const container = document.createElement('div');
  achFile.forEach((record) => {
    const fields = getRecordDefinition(record.recordTypeCode, record.padding);
    const row = createElementFromHTML(`
      <div
        id="record-${record.line}"
        data-record-type="${record.recordTypeCode}"
        class="row"
      >
      </div>
    `);
    row.appendChild(renderField(record, { name: 'Record Type Code', length: 1, static: true, key: 'recordTypeCode' }, { value: record.recordTypeCode }));
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
        case RECORD_TYPE_CODES.BATCH_HEADER:
          button = 'Load Transactions';
          break;
        case RECORD_TYPE_CODES.BATCH_TRAILER:
          // button = '&plus; Entry';
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
  achFile.filter(r => !r.padding).forEach((record) => {
    const fields = getRecordDefinition(record.recordTypeCode, record.padding);
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