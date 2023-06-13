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
  const fileName = fileParts[fileParts.length - 1];

  const text = writeAchFile(achFile);
  const blob = new Blob([text], {type: 'octet/stream'});
  const url = window.URL.createObjectURL(blob);

  a.href = url;
  a.download = fileName;
  a.click();
  window.URL.revokeObjectURL(url);
});

const PATTERN = {
  ALPHANUMERIC: /^[A-z0-9 ]*$/,
  NUMERIC: /^[0-9]+$/,
  DATE: /^[0-9]{6}$/,
  TIME: /^[0-9]{4}$/,
};

const ACH_SPEC = {
  '1': [ // file header
    { key: 'priorityCode', name: 'Priority Code', length: 2, pattern: /^01$/, static: true, required: true},
    { key: 'destination', name: 'Immediate Destination', length: 10, pattern: /^ [0-9]{9}$/, required: true },
    { key: 'origin', name: 'Immediate Origin', length: 10, pattern: /^ [0-9]{9}$/, required: true },
    { key: 'creationDate', name: 'File Creation Date', length: 6, pattern: PATTERN.DATE, required: true },
    { key: 'creationTime', name: 'File Creation Time', length: 4, pattern: PATTERN.TIME },
    { key: 'idModifier', name: 'File ID Modifier', length: 1, pattern: PATTERN.ALPHANUMERIC, required: true }, 
    { key: 'recordSize', name: 'Record Size', length: 3, pattern: /^094$/, static: true, required: true },
    { key: 'blockingFactor', name: 'Blocking Factor', length: 2, pattern: /^10$/, static: true, required: true },
    { key: 'formatCode', name: 'Format Code', length: 1, pattern: /^1$/, static: true, required: true },
    { key: 'destinationName', name: 'Immediate Destination Name', length: 23, pattern: PATTERN.ALPHANUMERIC },
    { key: 'originName', name: 'Immediate Origin Name', length: 23, pattern: PATTERN.ALPHANUMERIC },
    { key: 'referenceCode', name: 'Reference Code', length: 8, pattern: PATTERN.ALPHANUMERIC },
  ],
  '9': [ // file trailer
    { key: 'batchCount', name: 'Batch Count', length: 6, pattern: PATTERN.NUMERIC, required: true },
    { key: 'blockCount', name: 'Block Count', length: 6, pattern: PATTERN.NUMERIC, required: true },
    { key: 'entryCount', name: 'Entry/Addenda Count', length: 8, pattern: PATTERN.NUMERIC, required: true },
    { key: 'entryHash', name: 'Entry Hash', length: 10, pattern: PATTERN.NUMERIC, required: true },
    { key: 'totalDebits', name: 'Total Debit Entry Dollar Amount in File', length: 12, pattern: PATTERN.NUMERIC, required: true },
    { key: 'totalCredits', name: 'Total Credit Entry Dollar Amount in File', length: 12, pattern: PATTERN.NUMERIC, required: true },
    { key: 'reserved', name: 'Reserved', length: 39, pattern: /^ {39}$/, static: true, required: true },
  ],
  '5': [ // batch header
    { key: 'serviceClass', name: 'Service Class Code', length: 3, pattern: PATTERN.NUMERIC, required: true },
    { key: 'companyName', name: 'Company Name', length: 16, pattern: PATTERN.ALPHANUMERIC, required: true },
    { key: 'companyDiscData', name: 'Company Discretionary Data', length: 20, pattern: PATTERN.ALPHANUMERIC },
    { key: 'companyId', name: 'Company Identification', length: 10, pattern: PATTERN.ALPHANUMERIC, required: true },
    { key: 'standardEntryClass', name: 'Standard Entry Class Code', length: 3, pattern: PATTERN.ALPHANUMERIC, required: true },
    { key: 'companyEntryDesc', name: 'Company Entry Description', length: 10, pattern: PATTERN.ALPHANUMERIC, required: true },
    { key: 'companyDescDate', name: 'Company Entry Description', length: 6, pattern: PATTERN.ALPHANUMERIC },
    { key: 'effectiveEntryDate', name: 'Effective Entry Date', length: 6, pattern: PATTERN.DATE },
    { key: 'settlementDate', name: 'Settlement Date', length: 3, pattern: PATTERN.NUMERIC },
    { key: 'originatorStatus', name: 'Originator Status Code', length: 1, pattern: PATTERN.ALPHANUMERIC },
    { key: 'originatingDfiId', name: 'Originating DFI Identification', length: 8, pattern: PATTERN.NUMERIC },
    { key: 'batchNumber', name: 'Batch Number', length: 7 },
  ],
  '8': [ // batch trailer
    { key: 'serviceClass', name: 'Service Class Code', length: 3, pattern: PATTERN.NUMERIC, required: true },
    { key: 'entryCount', name: 'Entry/Addenda Count', length: 6, pattern: PATTERN.NUMERIC, required: true },
    { key: 'entryHash', name: 'Entry Hash', length: 10, pattern: PATTERN.NUMERIC, required: true },
    { key: 'totalDebits', name: 'Total Debit Entry Dollar Amount', length: 12, pattern: PATTERN.NUMERIC, required: true },
    { key: 'totalCredits', name: 'Total Credit Entry Dollar Amount', length: 12, pattern: PATTERN.NUMERIC, required: true },
    { key: 'companyId', name: 'Company Identification', length: 10, pattern: PATTERN.ALPHANUMERIC, required: true },
    { key: 'messageAuthCode', name: 'Message Authentication Code', length: 19 , pattern: PATTERN.NUMERIC},
    { key: 'reserved', name: 'Reserved', length: 6, pattern: /$ {6}$/, static: true, required: true },
    { key: 'originatingDfiId', name: 'Originating DFI Identification', length: 8, pattern: PATTERN.NUMERIC, required: true },
    { key: 'batchNumber', name: 'Batch Number', length: 7, pattern: PATTERN.NUMERIC, required: true },
  ],
  '6' : [ // CCD and PPD entries (WEB and TEL are very similar)
    { key: 'transactionCode', name: 'Transaction Code', length: 2, pattern: PATTERN.NUMERIC, required: true },
    { key: 'receivingDfiId', name: 'Receiving DFI Identification', length: 8, pattern: PATTERN.NUMERIC, required: true },
    { key: 'checkDigit', name: 'Check Digit', length: 1, pattern: PATTERN.NUMERIC, required: true },
    { key: 'dfiAcctNumber', name: 'DFI Account Number', length: 17, pattern: PATTERN.ALPHANUMERIC, required: true },
    { key: 'amount', name: 'Amount', length: 10, pattern: PATTERN.NUMERIC, required: true },
    { key: 'idNumber', name: 'Identification Number', length: 15, pattern: PATTERN.ALPHANUMERIC },
    { key: 'receivingName', name: 'Receiving Individual/Company Name', length: 22, pattern: PATTERN.ALPHANUMERIC, required: true },
    { key: 'discData', name: 'Discretionary Data', length: 2, pattern: PATTERN.ALPHANUMERIC }, // could also be payment type code
    { key: 'addendaRecordId', name: 'Addenda Record Indicator', length: 1, pattern: PATTERN.NUMERIC, required: true },
    { key: 'traceNumber', name: 'Trace Number', length: 15, pattern: PATTERN.NUMERIC, required: true },
  ],
  '7' : [
    { key: 'addendaType', name: 'Addenda Type Code', length: 2, pattern: /^05$/, required: true },
    { key: 'paymentRelatedInfo', name: 'Payment Related Information', length: 80, pattern: PATTERN.ALPHANUMERIC },
    { key: 'addendaSeqNumber', name: 'Addenda Sequence Number', length: 4, pattern: PATTERN.NUMERIC, required: true },
    { key: 'entrySeqNumber', name: 'Entry Detail Sequence Number', length: 7, pattern: PATTERN.NUMERIC, required: true },
  ],
  'padding': [
    { key: 'padding', name: 'Padding', length: 93, static: true, pattern: /^9{93}$/, required: true },
  ],
};

function validate(field, value) {
  if (field.required && value.match(/^ *$/)) {
    throw new Error(`"${field.name}" is required.`);
  }
  if (value.length > field.length) {
    throw new Error(`"${field.name}" must be ${field.length} character${field.length == 1 ? '' : 's'} long.`);
  }
  if (field.pattern && !value.match(field.pattern)) {
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
  evt.stopPropagation();
}

function onFieldChange(evt) {
  const input = evt.target;
  const { recordLine, fieldKey } = extractAttributes(input, ['data-record-line', 'data-field-key']);
  const lineNum = parseInt(recordLine);
  const record = achFile.find(rec => rec.line === lineNum);
  if (record) {
    // validate data based on pattern
    const field = getRecordDefinition(record.recordTypeCode, record.padding).find(fld => fld.key === fieldKey);
    try {
      const okValue = validate(field, input.value);
      input.removeAttribute('data-error');
      // now we can save this value
      record[fieldKey] = okValue;
    } catch (ex) {
      console.error(`Error on line ${lineNum + 1}: ${ex.message}`);
      input.setAttribute('data-error', ex.message);
    }
  }
  evt.stopPropagation();
}

function onFieldBlur(evt) {
  const input = evt.target;
  evt.stopPropagation();
}

function onFieldHover(evt) {
  const input = evt.target;
  const tooltip = document.querySelector('div#tooltip');
  const { top, height } = input.getBoundingClientRect();
  const { name, fieldLength, error } = extractAttributes(input, ['data-name', 'data-field-length', 'data-error']);
  if (name) {
    tooltip.style.visibility = 'visible';
    tooltip.style.background = error ? '#fcc' : '#ffb';
    tooltip.style.left = evt.x;
    tooltip.style.top = top + height + 1; // for the outline
    tooltip.innerHTML = `<div>${name} (${fieldLength} char${fieldLength == 1 ? '' : 's'})</div>
      <div>${input.value}</div>
      ${error ? `<div>${error}</div>` : ''}`;
  } else {
    tooltip.style.visibility = 'hidden';
  }
  evt.stopPropagation();
}

function renderAchFile(achFile) {
  document.querySelector('div#contents').innerHTML = '';

  const container = document.createElement('div');
  achFile.forEach((record) => {
    const fields = getRecordDefinition(record.recordTypeCode, record.padding);
    const row = createElementFromHTML('<div class="row"></div>');
    row.appendChild(renderField(record.recordTypeCode, record, { name: 'Record Type Code', length: 1, static: true }));
    fields.forEach((field) => {
      const value = record[field.key];
      const input = renderField(value, record, field);
      row.appendChild(input);
    });
    container.appendChild(row);
  });

  container.addEventListener('change', onFieldChange, true);
  // container.addEventListener('focus', onFieldFocus, true);
  // container.addEventListener('blur', onFieldBlur, true);
  document.body.addEventListener('mousemove', onFieldHover, true);

  document.querySelector('div#contents').appendChild(container);
}
const CHAR_WIDTH = 12;

function renderField(value, record, field) {
  const { length, static, name } = field;
  return createElementFromHTML(`
    <input
      type="text"
      style="width: ${ CHAR_WIDTH * length }px"
      value="${value}" ${static ? 'readonly' : ''}
      data-name="${field.name}"
      data-record-type="${record.recordTypeCode}"
      data-field-length="${field.length}"
      data-record-line="${record.line}"
      data-field-key="${field.key}"
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
      [snakeToCamelCase(attrName)]: element.getAttribute(attribute),
    };
  }, {});
}

function snakeToCamelCase(str) {
  return str.split('-').map((s, i) => i === 0 ? s : s.substring(0, 1).toUpperCase() + s.substring(1)).join('');
}