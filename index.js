document.querySelector('input#achFile').addEventListener('change', (evt) => {
  const file = evt.target.files[0];
  console.log(file);
  const fr = new FileReader();
  fr.readAsText(file);
  fr.onload = () => {
    console.log(fr.result);
    const achFile = parseAchFile(fr.result);
    renderAchFile(achFile);
  }
  fr.onerror = () => {
    console.log(fr.error);
  }
});

const ACH_SPEC = {
  '1': [ // file header
    { key: 'priorityCode', name: 'Priority Code', length: 2, pattern: /^01$/, static: true },
    { key: 'destination', name: 'Immediate Destination', length: 10, pattern: /^\s[0-9]{9}$/, static: true },
    { key: 'origin', name: 'Immediate Origin', length: 10 },
    { key: 'creationDate', name: 'File Creation Date', length: 6 },
    { key: 'creationTime', name: 'File Creation Time', length: 4 },
    { key: 'idModifier', name: 'File ID Modifier', length: 1 }, 
    { key: 'recordSize', name: 'Record Size', length: 3, pattern: /^094$/, static: true },
    { key: 'blockingFactor', name: 'Blocking Factor', length: 2, pattern: /^10$/, static: true },
    { key: 'formatCode', name: 'Format Code', length: 1, pattern: /^1$/, static: true },
    { key: 'destinationName', name: 'Immediate Destination Name', length: 23, pattern: /[A-z0-9]*/ },
    { key: 'originName', name: 'Immediate Origin Name', length: 23, pattern: /[A-z0-9]*/ },
    { key: 'referenceCode', name: 'Reference Code', length: 8 },
  ],
  '9': [ // file trailer
    { key: 'batchCount', name: 'Batch Count', length: 6 },
    { key: 'blockCount', name: 'Block Count', length: 6 },
    { key: 'entryCount', name: 'Entry/Addenda Count', length: 8 },
    { key: 'entryHash', name: 'Entry Hash', length: 10 },
    { key: 'totalDebits', name: 'Total Debit Entry Dollar Amount in File', length: 12 },
    { key: 'totalCredits', name: 'Total Credit Entry Dollar Amount in File', length: 12 },
    { key: 'reserved', name: 'Reserved', length: 39, pattern: /^\s{39}$/, static: true },
  ],
  '5': [ // batch header
    { key: 'serviceClass', name: 'Service Class Code', length: 3 },
    { key: 'companyName', name: 'Company Name', length: 16 },
    { key: 'companyDiscData', name: 'Company Discretionary Data', length: 20 },
    { key: 'companyId', name: 'Company Identification', length: 10 },
    { key: 'standardEntryClass', name: 'Standard Entry Class Code', length: 3 },
    { key: 'companyEntryDesc', name: 'Company Entry Description', length: 10 },
    { key: 'companyDescDate', name: 'Company Entry Description', length: 6 },
    { key: 'effectiveEntryDate', name: 'Effective Entry Date', length: 6 },
    { key: 'settlementDate', name: 'Settlement Date', length: 3 },
    { key: 'originatorStatus', name: 'Originator Status Code', length: 1 },
    { key: 'originatingDfiId', name: 'Originating DFI Identification', length: 8 },
    { key: 'batchNumber', name: 'Batch Number', length: 7 },
  ],
  '8': [ // batch trailer
    { key: 'serviceClass', name: 'Service Class Code', length: 3 },
    { key: 'entryCount', name: 'Entry/Addenda Count', length: 6 },
    { key: 'entryHash', name: 'Entry Hash', length: 10 },
    { key: 'totalDebits', name: 'Total Debit Entry Dollar Amount', length: 12 },
    { key: 'totalCredits', name: 'Total Credit Entry Dollar Amount', length: 12 },
    { key: 'companyId', name: 'Company Identification', length: 10 },
    { key: 'messageAuthCode', name: 'Message Authentication Code', length: 19 },
    { key: 'reserved', name: 'Reserved', length: 6, pattern: /$\s{6}$/, static: true },
    { key: 'originatingDfiId', name: 'Originating DFI Identification', length: 8 },
    { key: 'batchNumber', name: 'Batch Number', length: 7 },
  ],
  '6' : [ // CCD and PPD entries (WEB and TEL are very similar)
    { key: 'transactionCode', name: 'Transaction Code', length: 2 },
    { key: 'receivingDfiId', name: 'Receiving DFI Identification', length: 8 },
    { key: 'checkDigit', name: 'Check Digit', length: 1 },
    { key: 'dfiAcctNumber', name: 'DFI Account Number', length: 17 },
    { key: 'amount', name: 'Amount', length: 10 },
    { key: 'idNumber', name: 'Identification Number', length: 15 },
    { key: 'receivingName', name: 'Receiving Individual/Company Name', length: 22 },
    { key: 'discData', name: 'Discretionary Data', length: 2 }, // could also be payment type code
    { key: 'addendaRecordId', name: 'Addenda Record Indicator', length: 1 },
    { key: 'traceNumber', name: 'Trace Number', length: 15 },
  ],
  '7' : [
    { key: 'addendaType', name: 'Addenda Type Code', length: 2 },
    { key: 'paymentRelatedInfo', name: 'Payment Related Information', length: 80 },
    { key: 'addendaSeqNumber', name: 'Addenda Sequence Number', length: 4 },
    { key: 'entrySeqNumber', name: 'Entry Detail Sequence Number', length: 7 },
  ],
  'padding': [
    { key: 'padding', name: 'Padding', length: 93, static: true },
  ],
};

function getRecordDefinition(recordTypeCode, padding) {
  let fields = ACH_SPEC[recordTypeCode];
  if (padding) {
    fields = ACH_SPEC['padding'];
  }
  return fields;
}

function parseAchFile(contents) {
  const lines = contents.split('\r').join('').split('\n'); // make sure to remove carriage returns (\r)
  return lines.filter(x => x).map((line) => {
    const recordTypeCode = line.substring(0, 1);
    const record = { recordTypeCode };
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

function renderAchFile(achFile) {
  console.log(achFile);
  const contents = achFile.map((record) => {
    const fields = getRecordDefinition(record.recordTypeCode, record.padding);
    console.log(record.recordTypeCode, record.padding, fields);
    const line = fields.map((field) => {
      const value = record[field.key];
      return renderField(value, record, field);
    });
    return `<div>${renderField(record.recordTypeCode, record, { name: 'Record Type Code', length: 1, static: true })}${line.join('')}</div>`;
  }).join('');
  document.querySelector('div#contents').innerHTML = contents;
}

function renderField(value, record, field) {
  const { length, static, name } = field;
  return `<input type="text" style="width: ${ 8 * length }px" value="${value}" ${static ? 'readonly' : ''} />`;
}