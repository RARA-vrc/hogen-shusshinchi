// Receiver for play records of "方言で出身地当て".
// Bound to a Google Spreadsheet (Extensions > Apps Script) and deployed as a
// web app. Each accepted POST appends one row to the sheet named SHEET_NAME.
// See gas/README.md for the set-up steps.
//
// Stored per row: day, estimate level, estimate id, correct area, number of
// questions, question ids, answers, comment. No time of day, no address and
// no device information is stored.

var SHEET_NAME = 'plays';
var MAX_BODY = 4000; // characters
var MAX_QUESTIONS = 40;
var MAX_COMMENT = 300;
var MAX_ROWS = 50000; // stop accepting when the sheet is this long
var ID_PATTERN = /^[A-Za-z0-9_-]{0,40}$/;
var DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
var HEADER = ['day', 'estimate_level', 'estimate_id', 'correct', 'count', 'questions', 'answers', 'comment'];

function doPost(e) {
  try {
    var body = e && e.postData ? e.postData.contents : '';
    if (!body || body.length > MAX_BODY) return reply('ignored');
    var row = toRow(JSON.parse(body));
    if (row === null) return reply('ignored');

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var book = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = book.getSheetByName(SHEET_NAME);
      if (sheet === null) {
        sheet = book.insertSheet(SHEET_NAME);
        sheet.appendRow(HEADER);
      }
      if (sheet.getLastRow() >= MAX_ROWS) return reply('full');
      sheet.appendRow(row);
    } finally {
      lock.releaseLock();
    }
    return reply('ok');
  } catch (err) {
    return reply('error');
  }
}

function doGet() {
  return reply('This endpoint only accepts play records.');
}

// Validates a record and turns it into a sheet row, or returns null.
function toRow(d) {
  if (d === null || typeof d !== 'object') return null;
  if (!isIdList(d.questions) || !isIdList(d.answers)) return null;
  if (d.questions.length !== d.answers.length) return null;
  if (d.estimate === null || typeof d.estimate !== 'object') return null;
  if (!isId(d.estimate.level) || !isId(d.estimate.id) || !isId(d.correct)) return null;
  if (typeof d.day !== 'string' || !DAY_PATTERN.test(d.day)) return null;
  var comment = typeof d.comment === 'string' ? d.comment : '';
  comment = comment.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_COMMENT);
  return [
    d.day,
    d.estimate.level,
    asText(d.estimate.id),
    asText(d.correct),
    d.questions.length,
    d.questions.join(' '),
    d.answers.join(' '),
    asText(comment),
  ];
}

function isId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

function isIdList(value) {
  if (!Array.isArray(value) || value.length > MAX_QUESTIONS) return false;
  for (var i = 0; i < value.length; i++) if (!isId(value[i])) return false;
  return true;
}

// A leading apostrophe makes Sheets store the value as plain text, so codes
// such as "0104" keep their zero and a comment can never run as a formula.
function asText(value) {
  return value === '' ? '' : "'" + value;
}

function reply(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.TEXT);
}
