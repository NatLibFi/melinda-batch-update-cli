import 'babel-polyfill';
import Record from 'marc-record-js';
import * as yargs from 'yargs';
import { validate, client } from './config';

if (!process.env.VALIDATE_USER || !process.env.VALIDATE_PASS) {
  throw new Error('Environment variable(s) VALIDATE_USER and/or VALIDATE_PASS not set');
}

/**
 * Parse the command-line arguments.
 */
const argv = yargs
  .usage('Usage: $0 <command> [options]')
  .help('h')
  .alias('h', 'help')
  .alias('v', 'validate')
  .describe('v', 'Validate a single record')
  .alias('l', 'localfix')
  .describe('l', 'Fix a single record, save the result locally')
  .alias('f', 'fix')
  .describe('f', 'Fix a single record')
  .alias('x', 'fixfile')
  .describe('x', 'Read record ids from file, fix all')
  .argv;

function isValid(id) {
  return Number(id) > 0 && Number(id) < 100000000;
}

/**
 * Fetch and validate a record
 * @param {string} - Record id
 * @returns {Promise} - Resolves with the validated record.
 */
export async function fix(id) {
  if (!isValid(id)) {
    throw new Error(`Invalid record id: ${id}`);
  }
  try {
    let record = await client.loadRecord(id);
    if (!record) {
      return null;
    }
    const originalRec = Record.clone(record);
    let results = await validate(record);
    // If the record has been mutated, revalidate it
    if (!Record.isEqual(originalRec, record)) {
      results = await validate(record);
    }
    return record;
  } catch(e) {
    return Promise.reject(e);
  }
}

export async function save(record) {
  const response = await client.updateRecord(record);
  console.log(response);
  return response;
}

export async function validateAndFix(id) {
  const record = await fix(id);
  const response = await save(record);
  return response;
}
