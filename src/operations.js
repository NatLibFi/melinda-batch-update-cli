/*
 * This module contains the functions that perform the operational logic. These
 * functions should be as pure as possible - no output printing.
 */
import 'babel-polyfill';
import Record from 'marc-record-js';
import path from 'path';
import Serializers from 'marc-record-serializers';
import fs from 'fs';
import util from 'util';
const Transform = require('stream').Transform;

// import * as _ from 'lodash';
import { validate, client } from './config';

const outputDir = './files';

function isValid(id) {
  return Number(id) > 0 && Number(id) < 100000000;
}

/**
 * Fetch and validate a record
 * @param {string} - Record id
 * @returns {Promise} - Resolves with an object containing validation reports, original and validated records
 */
export async function validateRecord(id) {
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
    let revalidationResults = '';
    // If the record has been mutated, revalidate it
    if (!Record.isEqual(originalRec, record)) {
      revalidationResults = await validate(record);
    }
    return {
      originalRecord: originalRec,
      results: results,
      revalidationResults: revalidationResults,
      validatedRecord: record
    };
  } catch(e) {
    return Promise.reject(e);
  }
}

export async function fix(id) {
  try {
    const validationRes = await validateRecord(id);
    const { validatedRecord } = validationRes;
    const response = await client.updateRecord(validatedRecord);
    validationRes['updateResponse'] = response;
    return validationRes;
  } catch(e) {
    return Promise.reject(e);
  }
}

function getTimeStamp() {
  const date = new Date();
  // will display time in 21:00:00 format
  return `${date.getFullYear()}-${1+date.getMonth()}-${date.getDate()}_${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;
}

export async function show(id) {
  if (!isValid(id)) {
    throw new Error(`Invalid record id: ${id}`);
  }
  // console.log(`Fetching record ${id}`);
  try {
    let record = await client.loadRecord(id);
    // console.log(record)
    return record.toString();
  } catch (e) {
    // console.log(`Processing record ${id} failed.`);
    return `Processing record ${id} failed: ${e}`;
  }
}


util.inherits(RecordValidator, Transform);

function RecordValidator(options) {
  options = options || {};
  options.writableObjectMode = true;
	options.readableObjectMode = true;

	Transform.call(this, options);
  console.log("moi")

  this._transform = function(record, encoding, done) {
    let self = this;
    validate(record).then(res => {
      self.push(record);
      console.log(res);
      done();
    }).done();
  }
}

export async function fileFix(file) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }
  const suffix = file.slice(-3).toLowerCase();
  let fromFileStream = fs.createReadStream(file);
  fromFileStream.setEncoding('utf8');
  const outputFile = path.resolve(`${outputDir}/${file.split("/").pop().slice(0,-4)}_validated.xml`);
  let toFileStream = fs.createWriteStream(outputFile);
  let reader;
  if (suffix === 'xml') {
    reader = new Serializers.MARCXML.Reader(fromFileStream);
  } else if (suffix === 'mrc' || file.slice(-4).toLowerCase() === 'marc') {
    reader = new Serializers.ISO2709.ParseStream();
    fromFileStream.pipe(reader);
  } else if (suffix === 'seq') {
    reader = new Serializers.AlephSequential.Reader(fromFileStream);
  } else {
    throw new Error('Unrecognized filetype.');
  }
  const declaration = '<?xml version="1.0" encoding="UTF-8"?><collection xmlns="http://www.loc.gov/MARC21/slim">';
  fs.appendFileSync(outputFile, declaration);
  reader.on('data', (rec) => {
    const report = validate(rec);
    console.log(rec);
    const validatedRecordAsXML = Serializers.MARCXML.toMARCXML(rec);
    fs.appendFileSync(outputFile, validatedRecordAsXML);
  }).on('end', () => {
    fs.appendFileSync(outputFile, '</collection>');
  });
}
