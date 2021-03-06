import 'babel-polyfill';
import * as yargs from 'yargs';
import * as _ from 'lodash';
import * as winston from 'winston';
import fs from 'fs';
import { saveToDb, revertToPrevious, wipeDatabase, revertSingle } from './db.js';
import { show,
  validateRecord,
  fix,
  fileFix,
  saveLocally,
  isValid,
  formatResults,
  generateBatchId,
  isWithinTimeinterval,
  sleep } from './operations.js';

/**
 * Initialize logging
 */
export const logger = new winston.Logger({
  transports: [
    new (winston.transports.Console)(),
    new (winston.transports.File)({
      timestamp: () => new Date().toLocaleString(),
      filename: 'logfile.log',
      json: false
    })
  ]
});

/**
 * Parse the command-line arguments.
 */
const argv = yargs
  .usage('Usage: node ./build/cli.js <options>')
  .help('h')
  .alias('h', 'help')
  .alias('s', 'show')
  .describe('s', 'Show a single record')
  .alias('v', 'validate')
  .describe('v', 'Validate a single record')
  .alias('f', 'fix')
  .describe('f', 'Fix a single record')
  .alias('l', 'localfix')
  .describe('l', 'Fix a single record from the API, save the result locally')
  .alias('x', 'filefix')
  .describe('x', 'Validate and fix a set of records from local file, save results locally')
  .alias('m', 'fixmultiple')
  .describe('m', 'Read record ids from file, fix all')
  .option('c', {
    alias: 'chunksize',
    demandOption: false,
    default: 5,
    describe: 'OPTIONAL: The size of the chunks to process with fixmultiple',
    type: 'number'
  })
  .option('t', {
    alias: 'timeinterval',
    demandOption: false,
    describe: 'OPTIONAL: The timeframe in a day in which long-running fixmultiple jobs are run (e.g. 17-06)',
    type: 'string'
  })
  .alias('u', 'undo')
  .describe('u', 'Revert a single record to its previous version')
  .alias('b', 'undobatch')
  .describe('b', 'Revert a batch of records into their previous state')
  .alias('r', 'reset')
  .describe('r', 'Reset the local database, wipe all backup data.')
  .argv;

export async function afterSuccessfulUpdate(res, batchId = '') {
  const { originalRecord, updateResponse, validatedRecord, results } = res;
  const message = _.map(updateResponse.messages, 'message').join('\n');
  const id = originalRecord.get('001')[0].value;
  console.log(`${message}
  ==============
  Record ${id} after validation:

  ${validatedRecord.toString()}

  ${formatResults(results)}
  `);
  const activeValidators = res.results.validators
    .filter(validator => validator.validate.length > 0)
    .map(validator => validator.name)
    .join(', ');
  let action = argv.m ? 'fixmultiple' : 'fix';
  logger.info(`id: ${id}, action: ${action}${argv.m ? ' (chunksize: ' + argv.c + ', batchId: ' + batchId + '),' : ''} active validators: ${activeValidators}`);
}

/**
 * Process command-line arguments.
 */
if (argv.x) {
  const file = argv.x;
  console.log(`Validating records from file ${file}.`);
  fileFix(file)
    .then(res => {
      logger.info(`action: fileFix, inputfile: ${argv.x}, outputfile: ${res.outputFile}, processed recs: ${res.processedRecs}`);
    })
    .catch(err => {
      logger.error(err);
    });
}

/*
 * Check whether the enviroment variables necessary for the operation are set.
 * @param {boolean} - creds
 * @returns {boolean}
 */
export function checkEnvVars(creds = 'false') {

  if (!process.env.VALIDATE_API) {
    throw new Error('The environment variable VALIDATE_API is not set.');
  }

  if (creds && !process.env.VALIDATE_USER || !process.env.VALIDATE_PASS) {
    throw new Error('Environment variable(s) VALIDATE_USER and/or VALIDATE_PASS are not set.');
  }
  return true;
}

if (argv.s) {
  // Show a single record.
  checkEnvVars();
  show(argv.s)
    .then(rec => console.log(rec))
    .catch(err => {
      logger.log({
        level: 'error',
        message: err
      });
    });
}

if (argv.v || argv.l) {
  checkEnvVars(true);
  // Validate a single record without updating the db.
  const id = argv.v ? argv.v : argv.l;
  console.log(`Validating record ${id}`);
  validateRecord(id).then(res => {
    const revalidation = res.revalidationResults.validators.filter(result => result.validate.length > 0);
    if (revalidation.length > 0) {
      console.log('The record was revalidated after changes, the validator output was:');
      console.log(formatResults(res.revalidationResults));
    }
    console.log('Validated record:');
    console.log(res.validatedRecord.toString());
    console.log('\n' + formatResults(res.results));
    if (argv.l) {
      saveLocally(res.validatedRecord, '_validated').then(res => {
        logger.info(res);
      });
      saveLocally(res.originalRecord, '_original').then(res => {
        logger.info(res);
      });
    }
  }).catch(err => {
    console.log(err);
    logger.error(JSON.stringify(err));
  });
} else if (argv.f) {
  checkEnvVars(true);
  let id = argv.f.toString();
  const parsedId = '0'.repeat(9 - id.length) + id; // Yargs removes the leading zeros from number arguments
  fix(parsedId)
    .then(res => {
      afterSuccessfulUpdate(res);
      const batchId = generateBatchId();
      logger.info(`Saving update results of record ${parsedId} to db with batchId '${batchId}'...`);
      return saveToDb([res], batchId);
    })
    .then(res => {
      logger.info('Success.');
    })
    .catch(err => {
      logger.error(`Updating record ${id} failed: '${err.errors ? err.errors.map(e => e.message).join(', ') : err}'`);
    });
} else if (argv.m) {
  checkEnvVars(true);
  // Read multiple record ids from file, validate and fix.
  const file = argv.m;
  if (!fs.existsSync(file)) {
    throw new Error(`File ${file} does not exist.`);
  }
  const ids = fs.readFileSync(file, 'utf8')
    .split('\n')
    .map(id => id.trim())
    .filter(id => isValid(id));

  if (ids.length < 1) {
    throw new Error('File does not contain valid record ids.');
  }

  const chunk = argv.c || 5;

  logger.info(`Read ${ids.length} record ids from file ${argv.m}, fixing them in chunks of ${chunk}.`);

  const idSets = _.chunk(ids, chunk);
  const batchId = generateBatchId();

  fixAll(idSets, ids.length, batchId);
} else if (argv.b) {
  checkEnvVars();
  logger.info(`Performing a rollback from batch with id '${argv.b}'...`);
  revertToPrevious(argv.b).then(results => {
    logger.info('Success.');
  });
} else if (argv.u) {
  checkEnvVars();
  let id = argv.u.toString();
  const parsedId = '0'.repeat(9 - id.length) + id; // Yargs removes the leading zeros from number arguments
  if (!isValid(parsedId)) {
    throw new Error(`'${parsedId} is not a valid record id.'`);
  }
  revertSingle(parsedId)
    .then(res => {
      if (res) {
        logger.info('Success.');
        process.exit();
      } else {
        logger.warn(`Record ${parsedId} was not found in the backup database.`);
        process.exit();
      }
    })
    .catch(err => logger.error(err));
} else if (argv.r) {
  wipeDatabase()
    .then(res => {
      if (res) {
        logger.info('Success.');
      }
      process.exit();
    })
    .catch(err => {
      logger.error(err);
    });
}

/**
 * Fix a batch of records. Calls itself recursively until all chunks are processed.
 * @param {array} - idChunks - A list of lists of ids. E.g. [[1, 2, 3], [4, 5, 6]].
 * @param {number} - total - The total number of records to process.
 * @returns {Promise} - Resolves with true when everything is processed. Logs errors in the process.
 */
export async function fixAll(idChunks, total, batchId) {

  if (!isWithinTimeinterval(argv.t)) {
    const date = new Date();
    const currTime = `${date.getHours()}:${date.getMinutes() < 10 ? '0' + date.getMinutes() : date.getMinutes()}`;
    logger.info(`Current time (${currTime}) is not within the time limits (${argv.t}) to run. Sleeping for 20 minutes...`);
    await sleep(60000 * 20); // Sleep for 20 minutes and recur
    fixAll(idChunks, total, batchId);
  } else {

    const [head, ...tail] = idChunks;

    if (!head) {
      logger.info('Done.');
      return 'Done';
    }

    const results = await Promise.all(head.map(async (id) => {
      try {
        let res = await fix(id);
        res.results['id'] = id;
        afterSuccessfulUpdate(res, batchId);
        return res;
      } catch (err) {
        const errorMessage = `Updating record ${id} failed: '${err}'`;
        logger.error(errorMessage);
      }
    }));

    saveToDb(results, batchId)
      .then(dbResults => {
        logger.info(`Saved ${dbResults.insertedCount} records to database: ${Object.values(dbResults.insertedIds).join(', ')} with batchId '${batchId}.'`);
      })
      .catch(err => logger.error(err));

    const done = total - head.length * tail.length;

    logger.info(`${done}/${total} (${Math.round(done / total * 100)} %) records processed.`);
    fixAll(tail, total, batchId);
  }
}
